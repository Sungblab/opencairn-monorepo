from __future__ import annotations

import pytest
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from worker.workflows.study_session_recording_workflow import StudySessionRecordingWorkflow


def _input() -> dict:
    return {
        "recording_id": "00000000-0000-4000-8000-000000000011",
        "session_id": "00000000-0000-4000-8000-000000000012",
        "workspace_id": "00000000-0000-4000-8000-000000000001",
        "project_id": "00000000-0000-4000-8000-000000000002",
        "user_id": "user-1",
        "object_key": "study-sessions/session/recordings/user/lecture.webm",
        "mime_type": "audio/webm",
    }


@activity.defn(name="transcribe_audio")
async def fake_transcribe(inp: dict) -> dict:
    assert inp["object_key"].endswith("lecture.webm")
    assert inp["workflow_id"].startswith("study-session-recording/")
    return {
        "text": "first second",
        "transcript": "first second",
        "segments": [
            {"index": 0, "startSec": 0.0, "endSec": 2.25, "text": "first"},
            {"index": 1, "startSec": 2.25, "endSec": 4.5, "text": "second"},
        ],
    }


registered: list[dict] = []


@activity.defn(name="register_study_session_transcript")
async def fake_register(payload: dict) -> dict:
    registered.append(payload)
    return {"ok": True}


@pytest.mark.asyncio
async def test_study_session_recording_workflow_registers_transcript_segments() -> None:
    registered.clear()
    async with (
        await WorkflowEnvironment.start_time_skipping() as env,
        Worker(
            env.client,
            task_queue="study-session-test-q",
            workflows=[StudySessionRecordingWorkflow],
            activities=[fake_transcribe, fake_register],
        ),
    ):
        result = await env.client.execute_workflow(
            StudySessionRecordingWorkflow.run,
            _input(),
            id="study-session-recording/00000000-0000-4000-8000-000000000011",
            task_queue="study-session-test-q",
        )

    assert result == {"ok": True, "recordingId": _input()["recording_id"]}
    assert registered == [
        {
            "recordingId": _input()["recording_id"],
            "sessionId": _input()["session_id"],
            "workspaceId": _input()["workspace_id"],
            "projectId": _input()["project_id"],
            "status": "ready",
            "durationSec": 4.5,
            "segments": [
                {"index": 0, "startSec": 0.0, "endSec": 2.25, "text": "first"},
                {"index": 1, "startSec": 2.25, "endSec": 4.5, "text": "second"},
            ],
        }
    ]
