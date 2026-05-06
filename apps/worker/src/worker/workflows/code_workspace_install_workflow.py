"""Code Workspace dependency install workflow.

Wraps the approved install activity so the API can start one Temporal workflow
per Agent Action Ledger row and receive terminal install metadata by callback.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.code_workspace_install import (
        notify_code_workspace_install_result_activity,
        run_code_workspace_install_activity,
    )


ACTIVITY_HEARTBEAT = timedelta(seconds=10)


@workflow.defn(name="CodeWorkspaceInstallWorkflow")
class CodeWorkspaceInstallWorkflow:
    @workflow.run
    async def run(self, request: dict[str, Any]) -> dict[str, Any]:
        timeout_ms = int(request.get("timeoutMs") or 120_000)
        activity_timeout = timedelta(milliseconds=timeout_ms + 30_000)
        try:
            result = await workflow.execute_activity(
                run_code_workspace_install_activity,
                args=[request],
                start_to_close_timeout=activity_timeout,
                heartbeat_timeout=ACTIVITY_HEARTBEAT,
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        except Exception:
            result = {
                "ok": False,
                "codeWorkspaceId": str(request.get("codeWorkspaceId") or ""),
                "snapshotId": str(request.get("snapshotId") or ""),
                "packageManager": str(request.get("packageManager") or "pnpm"),
                "installed": list(request.get("packages") or []),
                "exitCode": 1,
                "durationMs": 0,
                "logs": [
                    {
                        "stream": "system",
                        "text": "install workflow failed",
                    }
                ],
            }

        await workflow.execute_activity(
            notify_code_workspace_install_result_activity,
            args=[request, result, workflow.info().workflow_id],
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )
        return result
