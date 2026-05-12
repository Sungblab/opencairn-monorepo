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
import wave
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from temporalio import activity

from llm import get_provider
from llm.base import ProviderConfig, TranscriptionResult
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


def _segment_payload(
    *,
    index: int,
    start_sec: float,
    end_sec: float,
    text: str,
    speaker: str | None = None,
    language: str | None = None,
    confidence: float | None = None,
) -> dict:
    return {
        "index": index,
        "startSec": float(start_sec),
        "endSec": float(end_sec),
        "text": text.strip(),
        "speaker": speaker,
        "language": language,
        "confidence": confidence,
    }


def _local_whisper(wav_path: Path) -> dict:
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
    payload_segments = [
        _segment_payload(
            index=index,
            start_sec=float(getattr(seg, "start", 0.0) or 0.0),
            end_sec=float(getattr(seg, "end", 0.0) or 0.0),
            text=str(getattr(seg, "text", "") or ""),
        )
        for index, seg in enumerate(segments)
        if str(getattr(seg, "text", "") or "").strip()
    ]
    return {
        "text": " ".join(segment["text"] for segment in payload_segments),
        "provider": "local_faster_whisper",
        "model": os.environ.get("WHISPER_MODEL", "base"),
        "segments": payload_segments,
    }


def _wav_duration_sec(wav_path: Path) -> float:
    try:
        with wave.open(str(wav_path), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            return float(frames) / float(rate) if rate > 0 else 0.0
    except Exception:
        return 0.0


def _normalize_segment(raw: Any, index: int) -> dict | None:
    if is_dataclass(raw):
        raw = asdict(raw)
    if not isinstance(raw, dict):
        return None
    text = str(raw.get("text") or "").strip()
    if not text:
        return None
    return _segment_payload(
        index=int(raw.get("index", index)),
        start_sec=float(raw.get("startSec", raw.get("start_sec", 0.0)) or 0.0),
        end_sec=float(raw.get("endSec", raw.get("end_sec", 0.0)) or 0.0),
        text=text,
        speaker=raw.get("speaker"),
        language=raw.get("language"),
        confidence=raw.get("confidence"),
    )


def _normalize_transcription_result(
    raw: str | dict | TranscriptionResult | None,
    *,
    provider: str,
    model: str,
    duration_sec: float,
) -> dict:
    if raw is None:
        raw_dict: dict[str, Any] = {}
    elif isinstance(raw, str):
        raw_dict = {"text": raw}
    elif is_dataclass(raw):
        raw_dict = asdict(raw)
    else:
        raw_dict = dict(raw)

    text = str(raw_dict.get("text") or raw_dict.get("transcript") or "").strip()
    result_provider = str(raw_dict.get("provider") or provider)
    result_model = str(raw_dict.get("model") or model)
    segments = [
        segment
        for index, segment_raw in enumerate(raw_dict.get("segments") or [])
        if (segment := _normalize_segment(segment_raw, index)) is not None
    ]
    if not segments and text:
        segments = [
            _segment_payload(
                index=0,
                start_sec=0.0,
                end_sec=max(0.0, float(duration_sec or 0.0)),
                text=text,
            )
        ]
    if not text:
        text = " ".join(segment["text"] for segment in segments)

    return {
        "text": text,
        "transcript": text,
        "provider": result_provider,
        "model": result_model,
        "segments": segments,
    }


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
    # `tempfile.mktemp` returns a name that may be created by another process
    # before we open it (CodeQL py/insecure-temporary-file). `mkstemp` opens
    # the file atomically with O_EXCL+0600; ffmpeg overwrites the path via
    # `-y`, which is fine because the inode we just created is owned by us.
    _wav_fd, _wav_name = tempfile.mkstemp(suffix=".wav")
    os.close(_wav_fd)
    wav_path = Path(_wav_name)

    try:
        if workflow_id:
            await publish_safe(workflow_id, "stage_changed", {"stage": "parsing", "pct": None})
        activity.heartbeat("extracting audio via ffmpeg")
        await asyncio.to_thread(_extract_audio, media_path, wav_path)

        audio_bytes = wav_path.read_bytes()

        config = _provider_config()
        activity.heartbeat("calling provider.transcribe")
        provider = get_provider(config)
        transcript_result: str | dict | TranscriptionResult | None
        try:
            transcript_result = await provider.transcribe(audio_bytes)
        except NotImplementedError:
            # Some future provider might raise instead of returning None.
            transcript_result = None

        if transcript_result is None:
            # Base class default returns None (e.g. OllamaProvider inherits
            # it). Fall back to a local faster-whisper model.
            activity.logger.info(
                "Provider returned None; falling back to local faster-whisper"
            )
            activity.heartbeat("running faster-whisper fallback")
            transcript_result = await asyncio.to_thread(_local_whisper, wav_path)

        result = _normalize_transcription_result(
            transcript_result,
            provider=config.provider,
            model=config.model,
            duration_sec=_wav_duration_sec(wav_path),
        )
        activity.logger.info(
            "Transcription complete: %d chars", len(result["text"])
        )
        return result
    finally:
        media_path.unlink(missing_ok=True)
        wav_path.unlink(missing_ok=True)
