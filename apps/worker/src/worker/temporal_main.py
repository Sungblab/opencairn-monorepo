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

from worker.activities.enhance_activity import enhance_with_gemini
from worker.activities.image_activity import analyze_image
from worker.activities.pdf_activity import parse_pdf
from worker.activities.stt_activity import transcribe_audio
from worker.activities.web_activity import scrape_web_url
from worker.activities.youtube_activity import ingest_youtube
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
        activities=[
            parse_pdf,
            transcribe_audio,
            analyze_image,
            ingest_youtube,
            scrape_web_url,
            enhance_with_gemini,
        ],  # remaining activities land in Plan 3 Tasks 9-10
    )
    print(f"[worker] Starting Temporal worker on task queue: {task_queue}")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
