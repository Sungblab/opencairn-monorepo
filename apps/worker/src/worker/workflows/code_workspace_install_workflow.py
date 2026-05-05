"""Code Workspace dependency install workflow.

Wraps the approved install activity so the API can start one Temporal workflow
per Agent Action Ledger row and await terminal install metadata.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.code_workspace_install import run_code_workspace_install_activity


ACTIVITY_HEARTBEAT = timedelta(seconds=10)


@workflow.defn(name="CodeWorkspaceInstallWorkflow")
class CodeWorkspaceInstallWorkflow:
    @workflow.run
    async def run(self, request: dict[str, Any]) -> dict[str, Any]:
        timeout_ms = int(request.get("timeoutMs") or 120_000)
        activity_timeout = timedelta(milliseconds=timeout_ms + 30_000)
        return await workflow.execute_activity(
            run_code_workspace_install_activity,
            args=[request],
            start_to_close_timeout=activity_timeout,
            heartbeat_timeout=ACTIVITY_HEARTBEAT,
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
