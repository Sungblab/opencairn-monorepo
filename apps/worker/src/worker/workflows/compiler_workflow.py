"""CompilerWorkflow — Temporal workflow that runs the Compiler agent on a
newly-ingested source note.

Triggered by the Hono internal endpoint ``POST /api/internal/source-notes``
(Plan 4 Phase A) when ``triggerCompiler`` is true. One source note → one
CompilerWorkflow run, keyed by ``compiler-{noteId}`` for idempotency.

Plan 4 Phase B adds per-project concurrency control: the workflow acquires
a project semaphore slot before running the Compiler and releases it in a
``finally`` block. The acquire activity spin-polls with heartbeat until a
slot is free; the slot's ``expires_at`` on the DB side means a crashed
worker can't deadlock the project forever.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.semaphore_activity import (
        acquire_project_semaphore,
        release_project_semaphore,
    )


_SEM_PURPOSE = "compiler"
_SEM_ACQUIRE_TIMEOUT = timedelta(minutes=30)


@workflow.defn(name="CompilerWorkflow")
class CompilerWorkflow:
    @workflow.run
    async def run(self, inp: dict[str, Any]) -> dict[str, Any]:
        project_id = inp["project_id"]
        workspace_id = inp["workspace_id"]
        holder_id = workflow.info().workflow_id

        workflow.logger.info(
            "CompilerWorkflow start: note=%s project=%s",
            inp.get("note_id"),
            project_id,
        )

        await workflow.execute_activity(
            acquire_project_semaphore,
            {
                "workspace_id": workspace_id,
                "project_id": project_id,
                "holder_id": holder_id,
                "purpose": _SEM_PURPOSE,
            },
            start_to_close_timeout=_SEM_ACQUIRE_TIMEOUT,
            heartbeat_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        try:
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
        finally:
            try:
                await workflow.execute_activity(
                    release_project_semaphore,
                    {
                        "workspace_id": workspace_id,
                        "project_id": project_id,
                        "holder_id": holder_id,
                    },
                    start_to_close_timeout=timedelta(seconds=60),
                    retry_policy=RetryPolicy(maximum_attempts=1),
                )
            except Exception as exc:  # noqa: BLE001 — slot auto-expires on TTL
                workflow.logger.warning(
                    "CompilerWorkflow: semaphore release failed (slot will "
                    "auto-expire): %s",
                    exc,
                )

        workflow.logger.info(
            "CompilerWorkflow done: extracted=%d created=%d merged=%d",
            result.get("extracted_count", 0),
            result.get("created_count", 0),
            result.get("merged_count", 0),
        )
        return result
