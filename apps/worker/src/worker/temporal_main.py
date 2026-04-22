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

from worker.activities.batch_embed_activities import (
    cancel_batch_embed,
    fetch_batch_embed_results,
    poll_batch_embed,
    submit_batch_embed,
)
from worker.activities.compiler_activity import compile_note
from worker.activities.drive_activities import (
    discover_drive_tree,
    upload_drive_file_to_minio,
)
from worker.activities.enhance_activity import enhance_with_gemini
from worker.activities.image_activity import analyze_image
from worker.activities.import_activities import (
    finalize_import_job,
    materialize_page_tree,
    resolve_target,
)
from worker.activities.librarian_activity import run_librarian
from worker.activities.note_activity import create_source_note, report_ingest_failure
from worker.activities.notion_activities import (
    convert_notion_md_to_plate,
    unzip_notion_export,
    upload_staging_to_minio,
)
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
from worker.workflows.batch_embed_workflow import BatchEmbedWorkflow
from worker.workflows.compiler_workflow import CompilerWorkflow
from worker.workflows.import_workflow import ImportWorkflow
from worker.workflows.ingest_workflow import IngestWorkflow
from worker.workflows.librarian_workflow import LibrarianWorkflow
from worker.workflows.research_workflow import ResearchWorkflow

# Deep Research (Spec 2026-04-22) — registered only when FEATURE_DEEP_RESEARCH
# is on. Importing here is cheap and keeps the conditional small below.
from worker.activities.deep_research import (
    create_deep_research_plan,
    execute_deep_research,
    iterate_deep_research_plan,
    persist_deep_research_report,
)
from worker.workflows.deep_research_workflow import DeepResearchWorkflow

load_dotenv()


async def main() -> None:
    client = await Client.connect(
        os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
        namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )
    task_queue = os.environ.get("TEMPORAL_TASK_QUEUE", "ingest")
    workflows: list = [
        IngestWorkflow,
        CompilerWorkflow,
        ResearchWorkflow,
        LibrarianWorkflow,
        BatchEmbedWorkflow,
        ImportWorkflow,
    ]
    activities: list = [
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
        submit_batch_embed,
        poll_batch_embed,
        fetch_batch_embed_results,
        cancel_batch_embed,
        # Ingest Source Expansion — Drive + Notion one-shot import.
        discover_drive_tree,
        upload_drive_file_to_minio,
        unzip_notion_export,
        convert_notion_md_to_plate,
        upload_staging_to_minio,
        resolve_target,
        materialize_page_tree,
        finalize_import_job,
    ]

    # Deep Research Phase B — feature-flag gated so the worker boots cleanly
    # when the flag is off without warning about activities that never fire.
    if os.environ.get("FEATURE_DEEP_RESEARCH", "false").lower() == "true":
        workflows.append(DeepResearchWorkflow)
        activities.extend([
            create_deep_research_plan,
            iterate_deep_research_plan,
            execute_deep_research,
            persist_deep_research_report,
        ])

    worker = Worker(
        client,
        task_queue=task_queue,
        workflows=workflows,
        activities=activities,
    )
    print(f"[worker] Starting Temporal worker on task queue: {task_queue}")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
