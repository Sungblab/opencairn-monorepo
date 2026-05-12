"""Study Session recording worker callbacks."""

from __future__ import annotations

from typing import Any

from temporalio import activity

from worker.lib.api_client import post_internal


@activity.defn(name="register_study_session_transcript")
async def register_study_session_transcript(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist STT output for one Study Session recording through the API."""
    recording_id = str(payload["recordingId"])
    return await post_internal(
        f"/api/internal/study-sessions/recordings/{recording_id}/transcript",
        payload,
    )
