from __future__ import annotations

import json
from argparse import Namespace
from typing import Any

import pytest
from temporalio.service import RPCError, RPCStatusCode

from scripts.ensure_plan8_schedules import (
    Plan8ScheduleOptions,
    Plan8ScheduleRequest,
    Plan8Target,
    build_parser,
    build_schedule_requests,
    delete_schedule,
    ensure_schedule,
    load_targets,
    options_from_env_and_args,
    parse_kinds,
)


def _options() -> Plan8ScheduleOptions:
    return Plan8ScheduleOptions(
        task_queue="ingest",
        curator_cron="0 3 * * *",
        staleness_cron="15 3 * * *",
        connector_cron="0 4 * * 0",
        stale_days=90,
        max_notes=20,
        score_threshold=0.5,
        max_orphans=50,
        max_duplicate_pairs=20,
        max_contradiction_pairs=5,
        connector_threshold=0.75,
        connector_top_k=10,
    )


def test_options_read_plan8_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CURATOR_CRON", "5 3 * * *")
    monkeypatch.setenv("CONNECTOR_CRON", "10 4 * * 0")
    monkeypatch.setenv("STALENESS_CRON", "20 5 * * *")
    monkeypatch.setenv("STALE_DAYS", "120")
    monkeypatch.setenv("TEMPORAL_TASK_QUEUE", "worker-main")

    args = build_parser().parse_args([])
    opts = options_from_env_and_args(args)

    assert opts.curator_cron == "5 3 * * *"
    assert opts.connector_cron == "10 4 * * 0"
    assert opts.staleness_cron == "20 5 * * *"
    assert opts.stale_days == 120
    assert opts.task_queue == "worker-main"


def test_staleness_cron_defaults_to_curator_cron(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CURATOR_CRON", "7 2 * * *")
    monkeypatch.delenv("STALENESS_CRON", raising=False)

    args = build_parser().parse_args([])
    opts = options_from_env_and_args(args)

    assert opts.staleness_cron == "7 2 * * *"


def test_build_schedule_requests_for_all_plan8_agents() -> None:
    target = Plan8Target(
        workspace_id="ws-1",
        project_id="project-1",
        user_id="owner-1",
        connector_concept_ids=("concept-1", "concept-2"),
    )

    requests = build_schedule_requests(
        targets=[target],
        kinds={"curator", "staleness", "connector"},
        options=_options(),
    )

    assert [request.kind for request in requests] == [
        "curator",
        "staleness",
        "connector",
        "connector",
    ]
    assert [request.schedule_id for request in requests] == [
        "curator-project-1",
        "staleness-project-1",
        "connector-concept-1",
        "connector-concept-2",
    ]
    staleness = requests[1]
    assert staleness.workflow_name == "StalenessWorkflow"
    assert staleness.workflow_args["stale_days"] == 90
    assert staleness.workflow_args["score_threshold"] == 0.5

    connector = requests[2]
    assert connector.workflow_name == "ConnectorWorkflow"
    assert connector.workflow_args["concept_id"] == "concept-1"
    assert connector.workflow_args["threshold"] == 0.75


def test_load_targets_from_json_file(tmp_path: Any) -> None:
    path = tmp_path / "targets.json"
    path.write_text(
        json.dumps(
            [
                {
                    "workspace_id": "workspace-a",
                    "project_id": "project-a",
                    "user_id": "owner-a",
                    "connector_concept_ids": ["concept-a"],
                }
            ]
        ),
        encoding="utf-8",
    )

    args = Namespace(
        targets_file=str(path),
        workspace_id=None,
        project_id=None,
        user_id=None,
        connector_concept_id=[],
    )

    assert load_targets(args) == [
        Plan8Target(
            workspace_id="workspace-a",
            project_id="project-a",
            user_id="owner-a",
            connector_concept_ids=("concept-a",),
        )
    ]


def test_parse_kinds_defaults_to_all_agents() -> None:
    kinds, explicit = parse_kinds(Namespace(target=None))

    assert kinds == {"curator", "staleness", "connector"}
    assert explicit is False


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
        assert schedule_id == "curator-project-1"
        return self.handle

    async def create_schedule(self, schedule_id: str, schedule: Any) -> None:
        if self.fail_create:
            raise RPCError(
                "already exists",
                RPCStatusCode.ALREADY_EXISTS,
                b"",
            )
        self.created.append((schedule_id, schedule))


def _request() -> Plan8ScheduleRequest:
    return Plan8ScheduleRequest(
        kind="curator",
        schedule_id="curator-project-1",
        workflow_name="CuratorWorkflow",
        cron="0 3 * * *",
        task_queue="ingest",
        workflow_args={
            "workspace_id": "ws-1",
            "project_id": "project-1",
            "user_id": "owner-1",
        },
        note="test schedule",
    )


@pytest.mark.asyncio
async def test_ensure_schedule_creates_missing_schedule() -> None:
    client = _FakeClient()

    result = await ensure_schedule(client, _request())  # type: ignore[arg-type]

    assert result == "created"
    assert client.created[0][0] == "curator-project-1"


@pytest.mark.asyncio
async def test_ensure_schedule_updates_existing_schedule() -> None:
    client = _FakeClient(fail_create=True)

    result = await ensure_schedule(client, _request())  # type: ignore[arg-type]

    assert result == "updated"
    assert client.handle.updated_schedule is not None


@pytest.mark.asyncio
async def test_delete_schedule_deletes_handle() -> None:
    client = _FakeClient()

    result = await delete_schedule(client, "curator-project-1")  # type: ignore[arg-type]

    assert result == "deleted"
    assert client.handle.deleted is True


@pytest.mark.asyncio
async def test_delete_schedule_treats_not_found_as_missing() -> None:
    client = _FakeClient()
    client.handle.delete_error = RPCError("not found", RPCStatusCode.NOT_FOUND, b"")

    result = await delete_schedule(client, "curator-project-1")  # type: ignore[arg-type]

    assert result == "missing"
