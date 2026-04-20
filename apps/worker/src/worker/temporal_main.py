"""Temporal worker entrypoint.

Starts a Temporal worker that polls the ``ingest`` task queue and executes
:class:`worker.workflows.ingest_workflow.IngestWorkflow`. Activity registrations
land in Plan 3 Tasks 3-10; the worker is allowed to start with an empty
activities list.
"""
from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from temporalio.client import Client
from temporalio.worker import Worker

from worker.activities.pdf_activity import parse_pdf
from worker.workflows.ingest_workflow import IngestWorkflow

load_dotenv()


async def main() -> None:
    client = await Client.connect(
        os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
        namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )
    task_queue = os.environ.get("TEMPORAL_TASK_QUEUE", "ingest")
    worker = Worker(
        client,
        task_queue=task_queue,
        workflows=[IngestWorkflow],
        activities=[parse_pdf],  # remaining activities land in Plan 3 Tasks 4-10
    )
    print(f"[worker] Starting Temporal worker on task queue: {task_queue}")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
