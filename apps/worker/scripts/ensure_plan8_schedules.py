"""Ensure Temporal Schedules for Plan 8 maintenance agents.

This script wires Plan 8 operational environment variables to real Temporal
Schedules:

* ``CURATOR_CRON`` starts ``CuratorWorkflow`` for each target project.
* ``CONNECTOR_CRON`` starts ``ConnectorWorkflow`` for each target concept.
* ``STALE_DAYS`` is passed into ``StalenessWorkflow`` inputs.

Run from inside the worker container:

    python -m scripts.ensure_plan8_schedules --workspace-id <uuid> \\
        --project-id <uuid> --user-id <workspace-owner-user-id> \\
        --connector-concept-id <uuid>

For multiple projects, pass a JSON targets file:

    python -m scripts.ensure_plan8_schedules --targets-file plan8-targets.json

The script is idempotent: a missing schedule is created, and an existing one
is updated in place with the current cron, workflow args, and task queue.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleSpec,
    ScheduleState,
)
from temporalio.service import RPCError, RPCStatusCode

Plan8Kind = Literal["curator", "staleness", "connector"]

DEFAULT_CURATOR_CRON = "0 3 * * *"
DEFAULT_CONNECTOR_CRON = "0 4 * * 0"
DEFAULT_TASK_QUEUE = "ingest"
DEFAULT_KINDS: tuple[Plan8Kind, ...] = ("curator", "staleness", "connector")


@dataclass(frozen=True)
class Plan8Target:
    """One ops target for Plan 8 scheduled agents."""

    workspace_id: str
    project_id: str
    user_id: str
    connector_concept_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Plan8ScheduleRequest:
    """Resolved Temporal Schedule definition before SDK conversion."""

    kind: Plan8Kind
    schedule_id: str
    workflow_name: str
    cron: str
    task_queue: str
    workflow_args: dict[str, Any]
    note: str

    def to_schedule(self) -> Schedule:
        action = ScheduleActionStartWorkflow(
            self.workflow_name,
            args=[self.workflow_args],
            id=f"{self.schedule_id}-{{.ScheduledStartTime}}",
            task_queue=self.task_queue,
        )
        return Schedule(
            action=action,
            spec=ScheduleSpec(cron_expressions=[self.cron]),
            state=ScheduleState(note=self.note),
        )


@dataclass(frozen=True)
class Plan8ScheduleOptions:
    """Runtime knobs for schedule generation."""

    task_queue: str
    curator_cron: str
    staleness_cron: str
    connector_cron: str
    stale_days: int
    max_notes: int
    score_threshold: float
    max_orphans: int
    max_duplicate_pairs: int
    max_contradiction_pairs: int
    connector_threshold: float
    connector_top_k: int


def options_from_env_and_args(args: argparse.Namespace) -> Plan8ScheduleOptions:
    curator_cron = args.curator_cron or os.environ.get(
        "CURATOR_CRON", DEFAULT_CURATOR_CRON
    )
    staleness_cron = args.staleness_cron or os.environ.get(
        "STALENESS_CRON", curator_cron
    )
    connector_cron = args.connector_cron or os.environ.get(
        "CONNECTOR_CRON", DEFAULT_CONNECTOR_CRON
    )
    stale_days_raw = args.stale_days or os.environ.get("STALE_DAYS", "90")

    return Plan8ScheduleOptions(
        task_queue=args.task_queue
        or os.environ.get("TEMPORAL_TASK_QUEUE", DEFAULT_TASK_QUEUE),
        curator_cron=_validate_cron("CURATOR_CRON", curator_cron),
        staleness_cron=_validate_cron("STALENESS_CRON", staleness_cron),
        connector_cron=_validate_cron("CONNECTOR_CRON", connector_cron),
        stale_days=_positive_int("STALE_DAYS", stale_days_raw),
        max_notes=args.max_notes,
        score_threshold=args.score_threshold,
        max_orphans=args.max_orphans,
        max_duplicate_pairs=args.max_duplicate_pairs,
        max_contradiction_pairs=args.max_contradiction_pairs,
        connector_threshold=args.connector_threshold,
        connector_top_k=args.connector_top_k,
    )


def build_schedule_requests(
    *,
    targets: list[Plan8Target],
    kinds: set[Plan8Kind],
    options: Plan8ScheduleOptions,
) -> list[Plan8ScheduleRequest]:
    requests: list[Plan8ScheduleRequest] = []

    for target in targets:
        if "curator" in kinds:
            requests.append(
                Plan8ScheduleRequest(
                    kind="curator",
                    schedule_id=f"curator-{target.project_id}",
                    workflow_name="CuratorWorkflow",
                    cron=options.curator_cron,
                    task_queue=options.task_queue,
                    workflow_args={
                        "workspace_id": target.workspace_id,
                        "project_id": target.project_id,
                        "user_id": target.user_id,
                        "max_orphans": options.max_orphans,
                        "max_duplicate_pairs": options.max_duplicate_pairs,
                        "max_contradiction_pairs": options.max_contradiction_pairs,
                    },
                    note=f"OpenCairn Plan 8 Curator for project {target.project_id}",
                )
            )

        if "staleness" in kinds:
            requests.append(
                Plan8ScheduleRequest(
                    kind="staleness",
                    schedule_id=f"staleness-{target.project_id}",
                    workflow_name="StalenessWorkflow",
                    cron=options.staleness_cron,
                    task_queue=options.task_queue,
                    workflow_args={
                        "workspace_id": target.workspace_id,
                        "project_id": target.project_id,
                        "user_id": target.user_id,
                        "stale_days": options.stale_days,
                        "max_notes": options.max_notes,
                        "score_threshold": options.score_threshold,
                    },
                    note=(
                        "OpenCairn Plan 8 Staleness for project "
                        f"{target.project_id}; stale_days={options.stale_days}"
                    ),
                )
            )

        if "connector" in kinds:
            for concept_id in target.connector_concept_ids:
                requests.append(
                    Plan8ScheduleRequest(
                        kind="connector",
                        schedule_id=f"connector-{concept_id}",
                        workflow_name="ConnectorWorkflow",
                        cron=options.connector_cron,
                        task_queue=options.task_queue,
                        workflow_args={
                            "workspace_id": target.workspace_id,
                            "project_id": target.project_id,
                            "user_id": target.user_id,
                            "concept_id": concept_id,
                            "threshold": options.connector_threshold,
                            "top_k": options.connector_top_k,
                        },
                        note=(
                            "OpenCairn Plan 8 Connector for concept "
                            f"{concept_id} in project {target.project_id}"
                        ),
                    )
                )

    return requests


async def ensure_schedule(client: Client, request: Plan8ScheduleRequest) -> str:
    schedule = request.to_schedule()
    handle = client.get_schedule_handle(request.schedule_id)

    try:
        await client.create_schedule(request.schedule_id, schedule)
        return "created"
    except RPCError as exc:
        if exc.status != RPCStatusCode.ALREADY_EXISTS:
            raise
        await handle.update(
            lambda desc: desc.update(  # type: ignore[attr-defined]
                schedule=schedule
            )
        )
        return "updated"


async def delete_schedule(client: Client, schedule_id: str) -> str:
    handle = client.get_schedule_handle(schedule_id)
    try:
        await handle.delete()
        return "deleted"
    except RPCError as exc:
        if exc.status != RPCStatusCode.NOT_FOUND:
            raise
        return "missing"


def load_targets(args: argparse.Namespace) -> list[Plan8Target]:
    targets: list[Plan8Target] = []

    if args.targets_file:
        raw = json.loads(Path(args.targets_file).read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            raise SystemExit("--targets-file must contain a JSON array")
        targets.extend(_target_from_mapping(item) for item in raw)

    if args.workspace_id or args.project_id or args.user_id:
        missing = [
            name
            for name, value in (
                ("--workspace-id", args.workspace_id),
                ("--project-id", args.project_id),
                ("--user-id", args.user_id),
            )
            if not value
        ]
        if missing:
            raise SystemExit(f"missing required arguments: {', '.join(missing)}")
        targets.append(
            Plan8Target(
                workspace_id=args.workspace_id,
                project_id=args.project_id,
                user_id=args.user_id,
                connector_concept_ids=tuple(args.connector_concept_id or ()),
            )
        )

    if not targets:
        raise SystemExit(
            "provide --targets-file or --workspace-id/--project-id/--user-id"
        )

    return targets


def parse_kinds(args: argparse.Namespace) -> tuple[set[Plan8Kind], bool]:
    explicit = bool(args.target)
    raw_kinds = args.target or DEFAULT_KINDS
    kinds: set[Plan8Kind] = set()
    for kind in raw_kinds:
        kinds.add(_as_plan8_kind(kind))
    return kinds, explicit


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-id")
    parser.add_argument("--project-id")
    parser.add_argument("--user-id")
    parser.add_argument(
        "--connector-concept-id",
        action="append",
        default=[],
        help="Concept id to schedule ConnectorWorkflow for; repeatable.",
    )
    parser.add_argument(
        "--targets-file",
        help=(
            "JSON array of {workspace_id, project_id, user_id, "
            "connector_concept_ids?} objects."
        ),
    )
    parser.add_argument(
        "--target",
        action="append",
        choices=["curator", "staleness", "connector"],
        help="Limit schedule ensure/delete to one target kind; repeatable.",
    )
    parser.add_argument("--curator-cron")
    parser.add_argument("--staleness-cron")
    parser.add_argument("--connector-cron")
    parser.add_argument("--stale-days")
    parser.add_argument("--max-notes", type=int, default=20)
    parser.add_argument("--score-threshold", type=float, default=0.5)
    parser.add_argument("--max-orphans", type=int, default=50)
    parser.add_argument("--max-duplicate-pairs", type=int, default=20)
    parser.add_argument("--max-contradiction-pairs", type=int, default=5)
    parser.add_argument("--connector-threshold", type=float, default=0.75)
    parser.add_argument("--connector-top-k", type=int, default=10)
    parser.add_argument(
        "--task-queue",
        default=os.environ.get("TEMPORAL_TASK_QUEUE", DEFAULT_TASK_QUEUE),
    )
    parser.add_argument(
        "--temporal-address",
        default=os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
    )
    parser.add_argument(
        "--namespace",
        default=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Delete matching schedules instead of creating/updating them.",
    )
    return parser


async def main() -> None:
    args = build_parser().parse_args()
    targets = load_targets(args)
    kinds, explicit_kinds = parse_kinds(args)
    options = options_from_env_and_args(args)
    requests = build_schedule_requests(
        targets=targets,
        kinds=kinds,
        options=options,
    )

    if "connector" in kinds and not any(
        target.connector_concept_ids for target in targets
    ):
        message = (
            "connector target selected but no --connector-concept-id or "
            "connector_concept_ids were supplied"
        )
        if explicit_kinds:
            raise SystemExit(message)
        print(f"[schedule] skipped connector: {message}")

    client = await Client.connect(args.temporal_address, namespace=args.namespace)

    if args.delete:
        schedule_ids = [request.schedule_id for request in requests]
        for schedule_id in schedule_ids:
            result = await delete_schedule(client, schedule_id)
            print(f"[schedule] {result} {schedule_id}")
        return

    for request in requests:
        result = await ensure_schedule(client, request)
        print(
            f"[schedule] {result} {request.schedule_id} "
            f"workflow={request.workflow_name} cron={request.cron}"
        )


def _as_plan8_kind(value: str) -> Plan8Kind:
    if value == "curator":
        return "curator"
    if value == "staleness":
        return "staleness"
    if value == "connector":
        return "connector"
    raise SystemExit(f"unknown Plan 8 target kind: {value}")


def _target_from_mapping(item: Any) -> Plan8Target:
    if not isinstance(item, dict):
        raise SystemExit("--targets-file entries must be JSON objects")
    try:
        workspace_id = str(item["workspace_id"])
        project_id = str(item["project_id"])
        user_id = str(item["user_id"])
    except KeyError as exc:
        raise SystemExit(f"targets-file entry missing {exc.args[0]!r}") from exc

    raw_concepts = item.get("connector_concept_ids", [])
    if raw_concepts is None:
        raw_concepts = []
    if not isinstance(raw_concepts, list):
        raise SystemExit("connector_concept_ids must be an array")
    return Plan8Target(
        workspace_id=workspace_id,
        project_id=project_id,
        user_id=user_id,
        connector_concept_ids=tuple(str(v) for v in raw_concepts),
    )


def _validate_cron(name: str, value: str) -> str:
    cron = str(value).strip()
    if not cron:
        raise SystemExit(f"{name} must not be empty")
    if len(cron.split()) != 5:
        raise SystemExit(f"{name} must be a 5-field cron expression")
    return cron


def _positive_int(name: str, value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise SystemExit(f"{name} must be an integer") from exc
    if parsed <= 0:
        raise SystemExit(f"{name} must be positive")
    return parsed


if __name__ == "__main__":
    asyncio.run(main())
