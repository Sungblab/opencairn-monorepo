"""LibrarianWorkflow — nightly knowledge-graph maintenance.

One workflow = one project. Designed to be driven by a Temporal *Schedule*
(see :mod:`worker.scripts.ensure_librarian_schedule`) that fires once per
night with the project's id as input. Each run is idempotent: the agent's
queries are bounded (``LIMIT N``) and the server-side merge endpoint is
atomic, so a retried run simply catches up on whatever changed.

v0 deliberately does NOT acquire the per-project semaphore — the intended
deployment runs Librarian during off-hours. Plan 5 can add an exclusive
lock mode if we see concept churn issues in production.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.lib.batch_timeouts import batch_aware_start_timeout

# Plan 3b gap: when BATCH_EMBED_LIBRARIAN_ENABLED is on, run_librarian
# blocks on the BatchEmbedWorkflow for up to BATCH_EMBED_MAX_WAIT_SECONDS
# (default 24h). See compiler_workflow.py for the analogous rationale.
RUN_LIBRARIAN_START_TIMEOUT = batch_aware_start_timeout(
    timedelta(hours=1), flag_env="BATCH_EMBED_LIBRARIAN_ENABLED"
)


@workflow.defn(name="LibrarianWorkflow")
class LibrarianWorkflow:
    @workflow.run
    async def run(self, inp: dict[str, Any]) -> dict[str, Any]:
        workflow.logger.info(
            "LibrarianWorkflow start: project=%s", inp.get("project_id")
        )

        result = await workflow.execute_activity(
            "run_librarian",
            inp,
            start_to_close_timeout=RUN_LIBRARIAN_START_TIMEOUT,
            heartbeat_timeout=timedelta(minutes=5),
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=10),
                maximum_interval=timedelta(minutes=5),
                backoff_coefficient=2.0,
                maximum_attempts=2,
            ),
        )

        workflow.logger.info(
            "LibrarianWorkflow done: project=%s orphans=%d merged=%d links=%d",
            inp.get("project_id"),
            result.get("orphan_count", 0),
            result.get("duplicates_merged", 0),
            result.get("links_strengthened", 0),
        )
        return result
