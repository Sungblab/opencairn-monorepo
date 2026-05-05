"""Code workspace repair planner workflow."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.code_workspace_repair import plan_code_workspace_repair


ACTIVITY_START_TO_CLOSE = timedelta(minutes=5)
ACTIVITY_HEARTBEAT = timedelta(seconds=30)


@workflow.defn(name="CodeWorkspaceRepairWorkflow")
class CodeWorkspaceRepairWorkflow:
    @workflow.run
    async def run(self, request: dict[str, Any]) -> dict[str, Any]:
        return await workflow.execute_activity(
            plan_code_workspace_repair,
            args=[request],
            start_to_close_timeout=ACTIVITY_START_TO_CLOSE,
            heartbeat_timeout=ACTIVITY_HEARTBEAT,
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
