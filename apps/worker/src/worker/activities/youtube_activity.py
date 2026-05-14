"""YouTube URL ingest activity.

Plan 3 Task 6. Called by :class:`worker.workflows.ingest_workflow.IngestWorkflow`
by name (``ingest_youtube``) when the source mime is ``x-opencairn/youtube``.

Flow:
    1. ``yt-dlp`` downloads audio from the URL and ffmpeg re-encodes to
       16kHz mono WAV (same canonical format the STT activity uses).
    2. Call :meth:`llm.base.LLMProvider.transcribe` with the audio bytes.
    3. If the provider returns ``None`` (OllamaProvider inherits the base
       default) or raises :class:`NotImplementedError`, fall back to a local
       ``faster-whisper`` model. The Whisper model is module-cached so we
       don't reload it between invocations.
    4. Prepend the video title + description to the transcript so downstream
       indexing has discoverable metadata.

Follow-up (out of scope for Task 6):
    Gemini 3 can ingest YouTube URLs directly via multimodal URI attachment.
    That would skip the audio download entirely for the happy path, but the
    current provider interface doesn't expose a ``generate_multimodal(url=)``
    hook. Adding one is a follow-up rather than a Task-6 extension so the
    universal yt-dlp path stays identical across providers.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yt_dlp
from llm import get_provider
from llm.base import ProviderConfig
from temporalio import activity

from worker.lib.ingest_events import publish_safe

# Hostnames that the API's isYoutubeUrl() allows. Mirrored here so the
# worker does not blindly trust the dispatch payload: if a later code path
# ever smuggled a non-YouTube URL with mime=x-opencairn/youtube, yt-dlp's
# generic extractor would happily download arbitrary sites (SSRF-ish +
# unbounded bandwidth) and pass the audio to the LLM pipeline.
# [Tier 1 item 1-4 / Plan 3 C-2]
_ALLOWED_YOUTUBE_HOSTS = frozenset(
    {
        "youtube.com",
        "youtu.be",
        "m.youtube.com",
        "www.youtube.com",
        "music.youtube.com",
    }
)


def _assert_youtube_url(url: str) -> None:
    """Raise if `url` is not a YouTube host. Called before yt-dlp fetches.

    Acceptable hostnames match the exact allowlist or any `*.youtube.com`
    subdomain (mirrors the API-side regex in apps/api/src/routes/ingest.ts).
    Any URL that fails here would otherwise be handed to yt-dlp's generic
    extractor, which will cheerfully download from arbitrary sites.
    """
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        raise ValueError(f"youtube_activity: unparseable URL: {url!r}") from exc

    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"youtube_activity: non-http(s) scheme: {parsed.scheme!r}")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("youtube_activity: missing hostname")

    if hostname in _ALLOWED_YOUTUBE_HOSTS or hostname.endswith(".youtube.com"):
        return

    raise ValueError(
        f"youtube_activity: hostname {hostname!r} is not a YouTube host; "
        "refusing to dispatch to yt-dlp"
    )


def _provider_config() -> ProviderConfig:
    """Build a :class:`ProviderConfig` from worker env vars (mirrors
    :mod:`worker.activities.stt_activity`)."""
    return ProviderConfig(
        provider=os.environ.get("LLM_PROVIDER", "gemini"),
        api_key=os.environ.get("LLM_API_KEY"),
        model=os.environ.get("LLM_MODEL", "gemini-3-flash-preview"),
        embed_model=os.environ.get("EMBED_MODEL", ""),
    )


def _download_youtube_audio(url: str, out_dir: Path) -> tuple[Path, str, str]:
    """Download YouTube audio as 16kHz mono WAV via yt-dlp + ffmpeg.

    Returns ``(wav_path, title, description)``. The postprocessor chain asks
    yt-dlp to extract audio and hand it to ffmpeg with ``-ar 16000 -ac 1`` so
    the output matches the canonical STT format (identical to what
    :func:`stt_activity._extract_audio` produces).
    """
    audio_tmpl = str(out_dir / "audio.%(ext)s")
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": audio_tmpl,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "0",
            }
        ],
        "postprocessor_args": ["-ar", "16000", "-ac", "1"],
        "quiet": True,
        "no_warnings": True,
    }
    # Re-validate the hostname immediately before yt-dlp touches it so a
    # malformed dispatch payload cannot bypass the API-side check.
    _assert_youtube_url(url)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title") or "YouTube Video"
        description = info.get("description") or ""

    wav_files = list(out_dir.glob("*.wav"))
    if not wav_files:
        raise FileNotFoundError("yt-dlp did not produce a WAV file")
    return wav_files[0], title, description


# Module-level Whisper cache — only instantiated when the fallback path runs.
# Kept separate from :mod:`stt_activity`'s cache since they're loaded in
# different module namespaces; a shared helper is a plausible follow-up refactor.
_whisper_model: Any = None


def _local_whisper(wav_path: Path) -> str:
    """faster-whisper fallback for providers without native transcribe."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel

        _whisper_model = WhisperModel(
            os.environ.get("WHISPER_MODEL", "base"),
            device=os.environ.get("WHISPER_DEVICE", "cpu"),
            compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
        )
    segments, _info = _whisper_model.transcribe(str(wav_path), beam_size=5)
    return " ".join(seg.text.strip() for seg in segments)


@activity.defn(name="ingest_youtube")
async def ingest_youtube(inp: dict) -> dict:
    """Download a YouTube video's audio and transcribe it.

    Returns ``{"transcript": str, "title": str}``. The transcript field is a
    markdown document prefixed with the video title and description so the
    downstream source-note writer gets a self-describing artefact.
    """
    url: str = inp["url"]
    workflow_id: str | None = inp.get("workflow_id")
    # Fail fast before creating temp dirs or logging the URL body if it is
    # not actually a YouTube URL. [Tier 1 item 1-4]
    _assert_youtube_url(url)
    activity.logger.info("Ingesting YouTube URL: %s", url)

    tmp_dir = Path(tempfile.mkdtemp())
    try:
        if workflow_id:
            await publish_safe(workflow_id, "stage_changed", {"stage": "downloading", "pct": None})
        activity.heartbeat("downloading youtube audio")
        wav_path, title, description = await asyncio.to_thread(
            _download_youtube_audio, url, tmp_dir
        )

        if workflow_id:
            await publish_safe(workflow_id, "stage_changed", {"stage": "parsing", "pct": None})
        activity.heartbeat("calling provider.transcribe")
        audio_bytes = wav_path.read_bytes()
        provider = get_provider(_provider_config())

        transcript: str | None
        try:
            transcript = await provider.transcribe(audio_bytes)
        except NotImplementedError:
            transcript = None

        if transcript is None:
            activity.logger.info(
                "Provider returned None; falling back to local faster-whisper"
            )
            activity.heartbeat("running faster-whisper fallback")
            transcript = await asyncio.to_thread(_local_whisper, wav_path)

        transcript = transcript or ""
        full_text = f"# {title}\n\n{description}\n\n## Transcript\n\n{transcript}"

        activity.logger.info(
            "YouTube ingest complete: '%s' -> %d chars", title, len(full_text)
        )
        return {"transcript": full_text, "title": title}
    finally:
        for f in tmp_dir.glob("*"):
            f.unlink(missing_ok=True)
        tmp_dir.rmdir()
