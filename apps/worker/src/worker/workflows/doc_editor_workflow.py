"""Plan 11B Phase A — DocEditorWorkflow.

Single activity wrapper. We use a workflow rather than calling the
activity directly so the API can use the same Temporal client pattern as
research/code. The workflow is short (one activity + return); future
phases may extend it for multi-step commands like /factcheck.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.doc_editor_activity import (
        DocEditorActivityInput,
        run_doc_editor,
    )


@workflow.defn(name="DocEditorWorkflow")
class DocEditorWorkflow:
    @workflow.run
    async def run(self, payload: DocEditorActivityInput) -> dict[str, Any]:
        return await workflow.execute_activity(
            run_doc_editor,
            payload,
            start_to_close_timeout=timedelta(seconds=45),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
