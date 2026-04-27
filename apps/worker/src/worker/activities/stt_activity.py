"""Audio/Video speech-to-text activity.

Plan 3 Task 4. Called by :class:`worker.workflows.ingest_workflow.IngestWorkflow`
by name (``transcribe_audio``) for any ``audio/*`` or ``video/*`` mime type.

Flow:
    1. Download the uploaded object from MinIO/R2 to a temp file.
    2. Normalise to 16kHz mono WAV via ``ffmpeg`` (best STT quality, works
       uniformly across mp3/mp4/m4a/mov/...).
    3. Call :meth:`llm.base.LLMProvider.transcribe` with the audio bytes.
    4. If the provider returns ``None`` (e.g. OllamaProvider inherits the base
       default) or raises :class:`NotImplementedError`, fall back to a local
       ``faster-whisper`` model. The Whisper model is module-cached so we
       don't reload (~hundreds of MB) on every invocation.

Heartbeats:
    We heartbeat before the two long-running sub-steps (ffmpeg, transcribe).
    ``asyncio.to_thread`` releases the event loop, so Temporal's SDK-internal
    heartbeats continue firing while faster-whisper crunches. Per-segment
    heartbeats from inside the Whisper loop are a follow-up — acceptable for
    v1 since the schedule_to_close timeout is 30 minutes.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from temporalio import activity

from llm import get_provider
from llm.base import ProviderConfig
from worker.lib.ingest_events import publish_safe
from worker.lib.s3_client import download_to_tempfile


def _provider_config() -> ProviderConfig:
    """Build a :class:`ProviderConfig` from worker env vars (same shape as
    the rest of Plan 13's provider wiring)."""
    return ProviderConfig(
        provider=os.environ.get("LLM_PROVIDER", "gemini"),
        api_key=os.environ.get("LLM_API_KEY"),
        model=os.environ.get("LLM_MODEL", "gemini-3-flash-preview"),
        embed_model=os.environ.get("EMBED_MODEL", ""),
    )


def _extract_audio(input_path: Path, output_path: Path) -> None:
    """Re-encode arbitrary media to 16kHz mono WAV via ffmpeg.

    ffmpeg is installed in the worker Docker image (Plan 3 Task 2). The
    ``-y`` flag overwrites the output, ``-ar 16000 -ac 1`` targets the sample
    rate and channel count both Gemini and Whisper expect for best accuracy.
    """
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-ar", "16000",
            "-ac", "1",
            "-f", "wav",
            str(output_path),
        ],
        capture_output=True,
        check=True,
        timeout=600,
    )


# Module-level Whisper cache — only instantiated when the fallback path runs
# (i.e. LLM_PROVIDER=ollama, or any provider that returns None from
# ``transcribe``). Loading a Whisper model is expensive (~GB download the
# first time, hundreds of MB into RAM thereafter) so we hang onto it for the
# worker's lifetime.
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


@activity.defn(name="transcribe_audio")
async def transcribe_audio(inp: dict) -> dict:
    """Transcribe an uploaded audio or video file to text.

    Returns a dict with key ``transcript`` (possibly empty string). The
    workflow writes this into a source note downstream.
    """
    object_key: str = inp["object_key"]
    workflow_id: str | None = inp.get("workflow_id")
    activity.logger.info("Transcribing audio/video: %s", object_key)

    if workflow_id:
        await publish_safe(workflow_id, "stage_changed", {"stage": "downloading", "pct": None})

    media_path = download_to_tempfile(object_key)
    wav_path = Path(tempfile.mktemp(suffix=".wav"))

    try:
        if workflow_id:
            await publish_safe(workflow_id, "stage_changed", {"stage": "parsing", "pct": None})
        activity.heartbeat("extracting audio via ffmpeg")
        await asyncio.to_thread(_extract_audio, media_path, wav_path)

        audio_bytes = wav_path.read_bytes()

        activity.heartbeat("calling provider.transcribe")
        provider = get_provider(_provider_config())

        transcript: str | None
        try:
            transcript = await provider.transcribe(audio_bytes)
        except NotImplementedError:
            # Some future provider might raise instead of returning None.
            transcript = None

        if transcript is None:
            # Base class default returns None (e.g. OllamaProvider inherits
            # it). Fall back to a local faster-whisper model.
            activity.logger.info(
                "Provider returned None; falling back to local faster-whisper"
            )
            activity.heartbeat("running faster-whisper fallback")
            transcript = await asyncio.to_thread(_local_whisper, wav_path)

        activity.logger.info(
            "Transcription complete: %d chars", len(transcript or "")
        )
        return {"transcript": transcript or ""}
    finally:
        media_path.unlink(missing_ok=True)
        wav_path.unlink(missing_ok=True)
