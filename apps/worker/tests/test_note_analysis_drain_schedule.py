from __future__ import annotations

from typing import Any

import pytest
from temporalio.service import RPCError, RPCStatusCode

from scripts.ensure_note_analysis_drain_schedule import (
    NoteAnalysisDrainScheduleRequest,
    build_parser,
    build_schedule_request,
    delete_schedule,
    ensure_schedule,
)


def test_build_schedule_request_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOTE_ANALYSIS_DRAIN_SCHEDULE_ID", "note-drain-dev")
    monkeypatch.setenv("NOTE_ANALYSIS_DRAIN_CRON", "*/2 * * * *")
    monkeypatch.setenv("NOTE_ANALYSIS_DRAIN_BATCH_SIZE", "75")
    monkeypatch.setenv("TEMPORAL_TASK_QUEUE", "worker-main")

    request = build_schedule_request(build_parser().parse_args([]))

    assert request.schedule_id == "note-drain-dev"
    assert request.workflow_name == "NoteAnalysisDrainWorkflow"
    assert request.cron == "*/2 * * * *"
    assert request.task_queue == "worker-main"
    assert request.batch_size == 75


def test_build_schedule_request_bounds_batch_size() -> None:
    args = build_parser().parse_args(["--batch-size", "1000"])

    assert build_schedule_request(args).batch_size == 100


def test_schedule_starts_drain_workflow_with_batch_size() -> None:
    schedule = _request().to_schedule()

    assert schedule.action.workflow == "NoteAnalysisDrainWorkflow"
    assert schedule.action.args == [{"batchSize": 25}]
    assert schedule.spec.cron_expressions == ["*/5 * * * *"]


class _FakeScheduleDescription:
    def __init__(self) -> None:
        self.schedule = None

    def update(self, *, schedule: Any) -> _FakeScheduleDescription:
        self.schedule = schedule
        return self


class _FakeScheduleHandle:
    def __init__(self) -> None:
        self.deleted = False
        self.updated_schedule = None
        self.delete_error: RPCError | None = None

    async def update(self, fn: Any) -> None:
        desc = _FakeScheduleDescription()
        fn(desc)
        self.updated_schedule = desc.schedule

    async def delete(self) -> None:
        if self.delete_error is not None:
            raise self.delete_error
        self.deleted = True


class _FakeClient:
    def __init__(self, *, fail_create: bool = False) -> None:
        self.fail_create = fail_create
        self.created: list[tuple[str, Any]] = []
        self.handle = _FakeScheduleHandle()

    def get_schedule_handle(self, schedule_id: str) -> _FakeScheduleHandle:
        assert schedule_id == "note-analysis-drain"
        return self.handle

    async def create_schedule(self, schedule_id: str, schedule: Any) -> None:
        if self.fail_create:
            raise RPCError("already exists", RPCStatusCode.ALREADY_EXISTS, b"")
        self.created.append((schedule_id, schedule))


def _request() -> NoteAnalysisDrainScheduleRequest:
    return NoteAnalysisDrainScheduleRequest(
        schedule_id="note-analysis-drain",
        workflow_name="NoteAnalysisDrainWorkflow",
        cron="*/5 * * * *",
        task_queue="ingest",
        batch_size=25,
        note="test schedule",
    )


@pytest.mark.asyncio
async def test_ensure_schedule_creates_missing_schedule() -> None:
    client = _FakeClient()

    result = await ensure_schedule(client, _request())  # type: ignore[arg-type]

    assert result == "created"
    assert client.created[0][0] == "note-analysis-drain"


@pytest.mark.asyncio
async def test_ensure_schedule_updates_existing_schedule() -> None:
    client = _FakeClient(fail_create=True)

    result = await ensure_schedule(client, _request())  # type: ignore[arg-type]

    assert result == "updated"
    assert client.handle.updated_schedule is not None


@pytest.mark.asyncio
async def test_delete_schedule_treats_not_found_as_missing() -> None:
    client = _FakeClient()
    client.handle.delete_error = RPCError("not found", RPCStatusCode.NOT_FOUND, b"")

    result = await delete_schedule(client, "note-analysis-drain")  # type: ignore[arg-type]

    assert result == "missing"
