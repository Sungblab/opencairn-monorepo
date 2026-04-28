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
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv
from temporalio.client import Client
from temporalio.worker import Worker

from worker.activities.batch_embed_activities import (
    cancel_batch_embed,
    fetch_batch_embed_results,
    poll_batch_embed,
    submit_batch_embed,
)
from worker.activities.code_activity import (
    analyze_feedback_activity,
    generate_code_activity,
)
from worker.activities.compiler_activity import compile_note
from worker.activities.connector_activity import run_connector as run_connector_activity
from worker.activities.curator_activity import run_curator

# Deep Research (Spec 2026-04-22) — registered only when FEATURE_DEEP_RESEARCH
# is on. Importing here is cheap and keeps the conditional small below.
from worker.activities.deep_research import (
    create_deep_research_plan,
    execute_deep_research,
    finalize_deep_research,
    iterate_deep_research_plan,
    persist_deep_research_report,
)
from worker.activities.drive_activities import (
    discover_drive_tree,
    upload_drive_file_to_minio,
)
from worker.activities.emit_event import emit_started
from worker.activities.enhance_activity import enhance_with_gemini
from worker.activities.hwp_activity import parse_hwp
from worker.activities.image_activity import analyze_image
from worker.activities.import_activities import (
    finalize_import_job,
    materialize_page_tree,
    resolve_target,
)
from worker.activities.librarian_activity import run_librarian

# Plan: Literature Search & Auto-Import. Registered unconditionally — the
# UI-side feature gate lives at the Hono route layer (Task 3/7), so the
# worker is always ready to drain a LitImportWorkflow if the route writes
# a job. Imports kept as a contiguous block at the END of the imports list
# to minimise merge surface against parallel sessions adding their own
# workflows here (e.g. content-aware-enrichment).
from worker.activities.lit_import_activities import (
    create_metadata_note,
    fetch_and_upload_oa_pdf,
    fetch_paper_metadata,
    lit_dedupe_check,
)
from worker.activities.narrator_activity import run_narrator
from worker.activities.note_activity import create_source_note, report_ingest_failure
from worker.activities.notion_activities import (
    convert_notion_md_to_plate,
    unzip_notion_export,
    upload_staging_to_minio,
)
from worker.activities.office_activity import parse_office
from worker.activities.pdf_activity import parse_pdf
from worker.activities.quarantine_activity import quarantine_source
from worker.activities.research_activity import run_research
from worker.activities.semaphore_activity import (
    acquire_project_semaphore,
    release_project_semaphore,
)
from worker.activities.socratic_activity import evaluate_answer, generate_questions
from worker.activities.staleness_activity import run_staleness as run_staleness_activity
from worker.activities.stt_activity import transcribe_audio
from worker.activities.synthesis_activity import run_synthesis
from worker.activities.visualize_activity import build_view
from worker.activities.web_activity import scrape_web_url
from worker.activities.youtube_activity import ingest_youtube
from worker.workflows.batch_embed_workflow import BatchEmbedWorkflow
from worker.workflows.code_workflow import CodeAgentWorkflow
from worker.workflows.compiler_workflow import CompilerWorkflow
from worker.workflows.connector_workflow import ConnectorWorkflow
from worker.workflows.curator_workflow import CuratorWorkflow
from worker.workflows.deep_research_workflow import DeepResearchWorkflow
from worker.workflows.import_workflow import ImportWorkflow
from worker.workflows.ingest_workflow import IngestWorkflow, read_text_object
from worker.workflows.librarian_workflow import LibrarianWorkflow
from worker.workflows.lit_import_workflow import LitImportWorkflow
from worker.workflows.narrator_workflow import NarratorWorkflow
from worker.workflows.research_workflow import ResearchWorkflow
from worker.workflows.socratic_workflow import SocraticEvaluateWorkflow, SocraticGenerateWorkflow
from worker.workflows.staleness_workflow import StalenessWorkflow
from worker.workflows.synthesis_workflow import SynthesisWorkflow
from worker.workflows.visualize_workflow import VisualizeWorkflow

load_dotenv()


@dataclass(frozen=True)
class WorkerConfig:
    """Resolved worker registration set.

    Built fresh on each call to ``build_worker_config`` so that feature flags
    are read at process-start time (or test time, via ``monkeypatch.setenv``)
    rather than at module import. This keeps the registration deterministic
    and the unit test for flag gating hermetic.
    """

    workflows: list[Any]
    activities: list[Any]


def build_worker_config() -> WorkerConfig:
    """Resolve the workflow + activity set the Temporal worker should register.

    Reads ``FEATURE_DEEP_RESEARCH`` and ``FEATURE_CODE_AGENT`` from the
    environment so feature-flagged components are added only when their flag
    is on. The base set (ingest/compiler/research/librarian/batch/import) is
    always registered.
    """
    workflows: list[Any] = [
        IngestWorkflow,
        CompilerWorkflow,
        ResearchWorkflow,
        SynthesisWorkflow,
        LibrarianWorkflow,
        BatchEmbedWorkflow,
        ImportWorkflow,
        VisualizeWorkflow,
        SocraticGenerateWorkflow,
        SocraticEvaluateWorkflow,
        CuratorWorkflow,
        ConnectorWorkflow,
        StalenessWorkflow,
        NarratorWorkflow,
        LitImportWorkflow,  # Plan: Literature Search & Auto-Import
    ]
    activities: list[Any] = [
        emit_started,
        parse_pdf,
        parse_office,
        parse_hwp,
        transcribe_audio,
        analyze_image,
        ingest_youtube,
        scrape_web_url,
        read_text_object,
        enhance_with_gemini,
        create_source_note,
        quarantine_source,
        report_ingest_failure,
        compile_note,
        run_curator,
        run_connector_activity,
        run_research,
        run_staleness_activity,
        run_synthesis,
        run_narrator,
        run_librarian,
        build_view,
        generate_questions,
        evaluate_answer,
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
        # Plan: Literature Search & Auto-Import — appended at the END of
        # the activities list so adjacent parallel sessions adding their
        # own activities here merge cleanly (no interleaving).
        fetch_paper_metadata,
        lit_dedupe_check,
        create_metadata_note,
        fetch_and_upload_oa_pdf,
    ]

    # Deep Research Phase B — feature-flag gated so the worker boots cleanly
    # when the flag is off without warning about activities that never fire.
    if os.environ.get("FEATURE_DEEP_RESEARCH", "false").lower() == "true":
        workflows.append(DeepResearchWorkflow)
        activities.extend(
            [
                create_deep_research_plan,
                iterate_deep_research_plan,
                execute_deep_research,
                persist_deep_research_report,
                finalize_deep_research,
            ]
        )

    # Plan 7 Phase 2 — Code Agent. Same flag-gated registration as Deep
    # Research; shares the ``ingest`` task queue per the single-worker
    # convention documented in the module docstring.
    if os.environ.get("FEATURE_CODE_AGENT", "false").lower() == "true":
        workflows.append(CodeAgentWorkflow)
        activities.extend([generate_code_activity, analyze_feedback_activity])

    # Spec B — Content-Aware Enrichment. Three activities slot into
    # IngestWorkflow's pipeline (detect → enrich → store). No separate
    # workflow; everything runs inside IngestWorkflow.
    if os.environ.get("FEATURE_CONTENT_ENRICHMENT", "false").lower() == "true":
        from worker.activities.detect_content_type_activity import (
            detect_content_type,
        )
        from worker.activities.enrich_document_activity import enrich_document
        from worker.activities.store_enrichment_activity import (
            store_enrichment_artifact,
        )

        activities.extend(
            [detect_content_type, enrich_document, store_enrichment_artifact]
        )

    # Plan 11B Phase A — DocEditor slash commands. Same flag-gated
    # registration as Deep Research / Code Agent. Appended at the END so
    # parallel sessions adding their own registrations merge cleanly.
    if os.environ.get("FEATURE_DOC_EDITOR_SLASH", "false").lower() == "true":
        from worker.activities.doc_editor_activity import (
            run_doc_editor as _run_doc_editor,
        )
        from worker.workflows.doc_editor_workflow import DocEditorWorkflow

        workflows.append(DocEditorWorkflow)
        activities.append(_run_doc_editor)

    return WorkerConfig(workflows=workflows, activities=activities)


async def main() -> None:
    client = await Client.connect(
        os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
        namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )
    task_queue = os.environ.get("TEMPORAL_TASK_QUEUE", "ingest")
    cfg = build_worker_config()

    worker = Worker(
        client,
        task_queue=task_queue,
        workflows=cfg.workflows,
        activities=cfg.activities,
    )
    print(f"[worker] Starting Temporal worker on task queue: {task_queue}")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
