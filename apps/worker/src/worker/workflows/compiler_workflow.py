"""CompilerWorkflow — Temporal workflow that runs the Compiler agent on a
newly-ingested source note.

Triggered by the Hono internal endpoint ``POST /api/internal/source-notes``
(Plan 4 Phase A) when ``triggerCompiler`` is true. One source note → one
CompilerWorkflow run, keyed by ``compiler-{noteId}`` for idempotency.

The workflow is a thin orchestrator: it invokes the ``compile_note``
activity with Temporal's retry policy handling transient failures, then
logs the outcome. Concept merging, embedding, and LLM calls all live
inside the activity (non-deterministic).
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy


@workflow.defn(name="CompilerWorkflow")
class CompilerWorkflow:
    @workflow.run
    async def run(self, inp: dict[str, Any]) -> dict[str, Any]:
        workflow.logger.info(
            "CompilerWorkflow start: note=%s project=%s",
            inp.get("note_id"),
            inp.get("project_id"),
        )

        result = await workflow.execute_activity(
            "compile_note",
            inp,
            start_to_close_timeout=timedelta(minutes=10),
            heartbeat_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=2),
                maximum_interval=timedelta(seconds=60),
                backoff_coefficient=2.0,
                maximum_attempts=3,
                # The agent surfaces non-retryable 4xx responses by
                # returning AgentError with retryable=False — Temporal
                # sees them as ActivityError and falls into the retry
                # attempt counter naturally; the ceiling above caps it.
            ),
        )
        workflow.logger.info(
            "CompilerWorkflow done: extracted=%d created=%d merged=%d",
            result.get("extracted_count", 0),
            result.get("created_count", 0),
            result.get("merged_count", 0),
        )
        return result
