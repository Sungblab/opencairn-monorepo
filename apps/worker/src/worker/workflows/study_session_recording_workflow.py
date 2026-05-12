"""Temporal workflow for Study Session recording transcription."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy


def _segments(result: dict[str, Any]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for index, raw in enumerate(result.get("segments") or []):
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()
        if not text:
            continue
        start = float(raw.get("startSec", raw.get("start_sec", 0.0)) or 0.0)
        end = float(raw.get("endSec", raw.get("end_sec", start)) or start)
        segment: dict[str, Any] = {
            "index": int(raw.get("index", index)),
            "startSec": max(0.0, start),
            "endSec": max(0.0, end),
            "text": text,
        }
        for key in ("speaker", "language", "confidence"):
            if raw.get(key) is not None:
                segment[key] = raw.get(key)
        segments.append(segment)
    return segments


def _duration_sec(segments: list[dict[str, Any]]) -> float | None:
    if not segments:
        return None
    return max(float(segment["endSec"]) for segment in segments)


@workflow.defn(name="StudySessionRecordingWorkflow")
class StudySessionRecordingWorkflow:
    @workflow.run
    async def run(self, inp: dict[str, Any]) -> dict[str, Any]:
        workflow_id = workflow.info().workflow_id
        retry = RetryPolicy(maximum_attempts=2)
        common = {
            "recordingId": inp["recording_id"],
            "sessionId": inp["session_id"],
            "workspaceId": inp["workspace_id"],
            "projectId": inp["project_id"],
        }

        try:
            result: dict[str, Any] = await workflow.execute_activity(
                "transcribe_audio",
                {
                    "object_key": inp["object_key"],
                    "mime_type": inp["mime_type"],
                    "user_id": inp["user_id"],
                    "project_id": inp["project_id"],
                    "workspace_id": inp["workspace_id"],
                    "workflow_id": workflow_id,
                },
                start_to_close_timeout=timedelta(minutes=30),
                heartbeat_timeout=timedelta(minutes=1),
                retry_policy=retry,
            )
            segments = _segments(result)
            await workflow.execute_activity(
                "register_study_session_transcript",
                {
                    **common,
                    "status": "ready",
                    "durationSec": _duration_sec(segments),
                    "segments": segments,
                },
                start_to_close_timeout=timedelta(minutes=2),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return {"ok": True, "recordingId": inp["recording_id"]}
        except Exception as exc:
            workflow.logger.exception("study session recording failed: %s", exc)
            await workflow.execute_activity(
                "register_study_session_transcript",
                {
                    **common,
                    "status": "failed",
                    "error": str(exc)[:1000],
                    "segments": [],
                },
                start_to_close_timeout=timedelta(minutes=2),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            return {
                "ok": False,
                "recordingId": inp["recording_id"],
                "errorCode": "study_session_recording_failed",
            }
