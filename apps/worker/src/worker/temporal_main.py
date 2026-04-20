"""Temporal worker entrypoint.

Starts a Temporal worker that polls the ``ingest`` task queue (Plan 3) and
executes both the ingest and Compiler workflows (Plan 4). Separating the
Compiler onto its own queue can happen later if throughput becomes an issue
— for now a single worker keeps the dev story simple (one process, one
queue).
"""
from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from temporalio.client import Client
from temporalio.worker import Worker

from worker.activities.compiler_activity import compile_note
from worker.activities.enhance_activity import enhance_with_gemini
from worker.activities.image_activity import analyze_image
from worker.activities.librarian_activity import run_librarian
from worker.activities.note_activity import create_source_note, report_ingest_failure
from worker.activities.pdf_activity import parse_pdf
from worker.activities.quarantine_activity import quarantine_source
from worker.activities.research_activity import run_research
from worker.activities.semaphore_activity import (
    acquire_project_semaphore,
    release_project_semaphore,
)
from worker.activities.stt_activity import transcribe_audio
from worker.activities.web_activity import scrape_web_url
from worker.activities.youtube_activity import ingest_youtube
from worker.workflows.compiler_workflow import CompilerWorkflow
from worker.workflows.ingest_workflow import IngestWorkflow
from worker.workflows.librarian_workflow import LibrarianWorkflow
from worker.workflows.research_workflow import ResearchWorkflow

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
        workflows=[
            IngestWorkflow,
            CompilerWorkflow,
            ResearchWorkflow,
            LibrarianWorkflow,
        ],
        activities=[
            parse_pdf,
            transcribe_audio,
            analyze_image,
            ingest_youtube,
            scrape_web_url,
            enhance_with_gemini,
            create_source_note,
            quarantine_source,
            report_ingest_failure,
            compile_note,
            run_research,
            run_librarian,
            acquire_project_semaphore,
            release_project_semaphore,
        ],
    )
    print(f"[worker] Starting Temporal worker on task queue: {task_queue}")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
