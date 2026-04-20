"""CLI helper to register / update a Temporal Schedule that fires
``LibrarianWorkflow`` nightly for one project.

Run from inside the worker container (has access to the Temporal address):

    python -m scripts.ensure_librarian_schedule --project-id <uuid> \\
        --workspace-id <uuid> --user-id <user-id> --cron "0 3 * * *"

The script is idempotent — calling it twice with the same ``--project-id``
replaces the existing schedule. Schedules live in Temporal itself, so the
worker process doesn't need to be up continuously for them to fire
(Temporal dispatches to whichever worker is available at trigger time).
"""
from __future__ import annotations

import argparse
import asyncio
import os

from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleSpec,
    ScheduleState,
)


def _schedule_id(project_id: str) -> str:
    return f"librarian-{project_id}"


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--cron", default="0 3 * * *", help="5-field cron string")
    parser.add_argument(
        "--task-queue",
        default=os.environ.get("TEMPORAL_TASK_QUEUE", "ingest"),
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Delete the schedule instead of creating/updating it.",
    )
    args = parser.parse_args()

    client = await Client.connect(
        os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
        namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )

    schedule_id = _schedule_id(args.project_id)
    handle = client.get_schedule_handle(schedule_id)

    if args.delete:
        try:
            await handle.delete()
            print(f"[schedule] deleted {schedule_id}")
        except Exception as exc:  # noqa: BLE001
            print(f"[schedule] delete failed (maybe not present): {exc}")
        return

    workflow_args = [
        {
            "project_id": args.project_id,
            "workspace_id": args.workspace_id,
            "user_id": args.user_id,
        }
    ]

    spec = ScheduleSpec(cron_expressions=[args.cron])
    action = ScheduleActionStartWorkflow(
        "LibrarianWorkflow",
        args=workflow_args,
        id=f"{schedule_id}-{{.ScheduledStartTime}}",
        task_queue=args.task_queue,
    )
    state = ScheduleState(note=f"OpenCairn Librarian for {args.project_id}")

    try:
        await client.create_schedule(
            schedule_id,
            Schedule(action=action, spec=spec, state=state),
        )
        print(f"[schedule] created {schedule_id} cron={args.cron}")
    except Exception:  # schedule likely exists — update in place
        await handle.update(
            lambda desc: desc.update(  # type: ignore[attr-defined]
                schedule=Schedule(action=action, spec=spec, state=state)
            )
        )
        print(f"[schedule] updated {schedule_id} cron={args.cron}")


if __name__ == "__main__":
    asyncio.run(main())
