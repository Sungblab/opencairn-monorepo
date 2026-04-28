"""Temporal workflow: literature import.

Orchestrates metadata fetch → workspace dedupe → per-paper fan-out →
finalize. Modelled on ImportWorkflow — same activity pattern, same
``ingest`` task queue.

Plan: Literature Search & Auto-Import (2026-04-27).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.workflows.ingest_workflow import IngestInput, IngestWorkflow


_RETRY = RetryPolicy(maximum_attempts=3, backoff_coefficient=2.0)
_SHORT = timedelta(minutes=5)
_MED = timedelta(minutes=10)
_PDF_TIMEOUT = timedelta(minutes=5)


@dataclass
class LitImportInput:
    job_id: str
    user_id: str
    workspace_id: str
    ids: list[str]  # DOI or "arxiv:<id>"


def _paper_key(paper: dict[str, Any]) -> str | None:
    """Stable id used for both dedupe matching and child-workflow ids."""
    if paper.get("doi"):
        return str(paper["doi"])
    if paper.get("arxiv_id"):
        return f"arxiv:{paper['arxiv_id']}"
    return None


@workflow.defn(name="LitImportWorkflow")
class LitImportWorkflow:
    @workflow.run
    async def run(self, inp: LitImportInput) -> dict[str, Any]:
        # 1. Resolve target project (reuses ImportWorkflow's resolve_target
        #    activity — keys on importJobs.id).
        target = await workflow.execute_activity(
            "resolve_target",
            {"job_id": inp.job_id},
            schedule_to_close_timeout=_SHORT,
            retry_policy=_RETRY,
        )

        # 2. Fetch metadata + OA URL for every requested id.
        meta_result = await workflow.execute_activity(
            "fetch_paper_metadata",
            {"ids": inp.ids},
            schedule_to_close_timeout=_MED,
            retry_policy=_RETRY,
        )
        papers: list[dict[str, Any]] = meta_result["papers"]

        # 3. Final server-side dedupe. arxiv-only ids round-trip as
        #    `arxiv:<id>` so the activity can short-circuit them.
        keys = [k for p in papers if (k := _paper_key(p))]
        dedupe = await workflow.execute_activity(
            "lit_dedupe_check",
            {"workspace_id": inp.workspace_id, "ids": keys},
            schedule_to_close_timeout=timedelta(seconds=30),
            retry_policy=_RETRY,
        )
        fresh_set = set(dedupe["fresh"])
        fresh_papers = [p for p in papers if (_paper_key(p) or "") in fresh_set]
        skipped_count = len(papers) - len(fresh_papers)

        # 4. Fan-out per paper: OA PDF → IngestWorkflow child, or fall back
        #    to a metadata-only note for paywalled papers.
        results = await asyncio.gather(
            *(
                self._handle_paper(inp, paper, target["project_id"])
                for paper in fresh_papers
            ),
            return_exceptions=True,
        )

        failed_items = sum(1 for r in results if isinstance(r, BaseException))
        completed_items = len(fresh_papers) - failed_items
        error_lines = [
            f"{fresh_papers[i].get('title', '?')}: {type(e).__name__}: {e}"
            for i, e in enumerate(results)
            if isinstance(e, BaseException)
        ][:100]
        error_summary = "\n".join(error_lines) if error_lines else None

        # 5. Finalize. Skipped papers count as completed for the user
        #    (the note already exists in the workspace).
        await workflow.execute_activity(
            "finalize_import_job",
            {
                "job_id": inp.job_id,
                "user_id": inp.user_id,
                "completed_items": completed_items + skipped_count,
                "failed_items": failed_items,
                "total_items": len(papers),
                "error_summary": error_summary,
            },
            schedule_to_close_timeout=_SHORT,
            retry_policy=_RETRY,
        )

        return {
            "total": len(papers),
            "completed": completed_items,
            "skipped": skipped_count,
            "failed": failed_items,
        }

    async def _handle_paper(
        self,
        inp: LitImportInput,
        paper: dict[str, Any],
        project_id: str,
    ) -> str:
        oa_url = paper.get("oa_pdf_url")
        paper_id = _paper_key(paper) or "unknown"
        # Sanitise for use as a Temporal workflow id (alphanumerics + '-_').
        wf_safe = "".join(
            c if c.isalnum() or c in "-_." else "_" for c in paper_id
        )[:60]

        if oa_url:
            try:
                upload = await workflow.execute_activity(
                    "fetch_and_upload_oa_pdf",
                    {
                        "oa_pdf_url": oa_url,
                        "job_id": inp.job_id,
                        "paper_id": paper_id,
                    },
                    schedule_to_close_timeout=_PDF_TIMEOUT,
                    retry_policy=_RETRY,
                )
                await workflow.execute_child_workflow(
                    IngestWorkflow.run,
                    IngestInput(
                        object_key=upload["object_key"],
                        file_name=f"{paper.get('title', 'paper')[:80]}.pdf",
                        mime_type="application/pdf",
                        user_id=inp.user_id,
                        project_id=project_id,
                        note_id=None,
                        workspace_id=inp.workspace_id,
                    ),
                    id=f"ingest-lit-{inp.job_id}-{wf_safe}",
                )
                return "ok"
            except Exception:
                # Graceful degradation: PDF download/upload failed → fall
                # back to a metadata-only note so the user at least sees
                # the paper in their workspace.
                pass

        await workflow.execute_activity(
            "create_metadata_note",
            {
                "paper": paper,
                "project_id": project_id,
                "job_id": inp.job_id,
            },
            schedule_to_close_timeout=timedelta(seconds=30),
            retry_policy=_RETRY,
        )
        return "ok"
