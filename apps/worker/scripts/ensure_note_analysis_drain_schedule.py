"""Ensure the Temporal Schedule that drains due note analysis jobs.

Run from inside the worker container:

    python -m scripts.ensure_note_analysis_drain_schedule

The script is idempotent. A missing schedule is created, and an existing one is
updated in place with the current cron, workflow args, and task queue.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from dataclasses import dataclass
from typing import Any

from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleSpec,
    ScheduleState,
)
from temporalio.service import RPCError, RPCStatusCode

DEFAULT_CRON = "*/5 * * * *"
DEFAULT_SCHEDULE_ID = "note-analysis-drain"
DEFAULT_TASK_QUEUE = "ingest"


@dataclass(frozen=True)
class NoteAnalysisDrainScheduleRequest:
    schedule_id: str
    workflow_name: str
    cron: str
    task_queue: str
    batch_size: int
    note: str

    def to_schedule(self) -> Schedule:
        return Schedule(
            action=ScheduleActionStartWorkflow(
                self.workflow_name,
                args=[{"batchSize": self.batch_size}],
                id=f"{self.schedule_id}-{{.ScheduledStartTime}}",
                task_queue=self.task_queue,
            ),
            spec=ScheduleSpec(cron_expressions=[self.cron]),
            state=ScheduleState(note=self.note),
        )


def build_schedule_request(args: argparse.Namespace) -> NoteAnalysisDrainScheduleRequest:
    schedule_id = args.schedule_id or os.environ.get(
        "NOTE_ANALYSIS_DRAIN_SCHEDULE_ID",
        DEFAULT_SCHEDULE_ID,
    )
    cron = args.cron or os.environ.get("NOTE_ANALYSIS_DRAIN_CRON", DEFAULT_CRON)
    task_queue = args.task_queue or os.environ.get(
        "TEMPORAL_TASK_QUEUE",
        DEFAULT_TASK_QUEUE,
    )
    batch_size = _bounded_batch_size(
        args.batch_size or os.environ.get("NOTE_ANALYSIS_DRAIN_BATCH_SIZE", "25")
    )
    return NoteAnalysisDrainScheduleRequest(
        schedule_id=_non_empty("NOTE_ANALYSIS_DRAIN_SCHEDULE_ID", schedule_id),
        workflow_name="NoteAnalysisDrainWorkflow",
        cron=_validate_cron("NOTE_ANALYSIS_DRAIN_CRON", cron),
        task_queue=_non_empty("TEMPORAL_TASK_QUEUE", task_queue),
        batch_size=batch_size,
        note=(
            "OpenCairn note analysis due-job drain; "
            f"batch_size={batch_size}"
        ),
    )


async def ensure_schedule(
    client: Client,
    request: NoteAnalysisDrainScheduleRequest,
) -> str:
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schedule-id")
    parser.add_argument("--cron")
    parser.add_argument("--batch-size")
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
        help="Delete the schedule instead of creating/updating it.",
    )
    return parser


async def main() -> None:
    args = build_parser().parse_args()
    request = build_schedule_request(args)
    client = await Client.connect(args.temporal_address, namespace=args.namespace)
    if args.delete:
        result = await delete_schedule(client, request.schedule_id)
        print(f"[schedule] {result} {request.schedule_id}")
        return
    result = await ensure_schedule(client, request)
    print(
        f"[schedule] {result} {request.schedule_id} "
        f"workflow={request.workflow_name} cron={request.cron}"
    )


def _validate_cron(name: str, value: str) -> str:
    cron = str(value).strip()
    if not cron:
        raise SystemExit(f"{name} must not be empty")
    if len(cron.split()) != 5:
        raise SystemExit(f"{name} must be a 5-field cron expression")
    return cron


def _bounded_batch_size(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise SystemExit("NOTE_ANALYSIS_DRAIN_BATCH_SIZE must be an integer") from exc
    return max(1, min(parsed, 100))


def _non_empty(name: str, value: str) -> str:
    text = str(value).strip()
    if not text:
        raise SystemExit(f"{name} must not be empty")
    return text


if __name__ == "__main__":
    asyncio.run(main())
