"""Temporal workflow for optional Google Workspace project-object export."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.google_workspace_export import (
        GoogleWorkspaceExportErrorResult,
        GoogleWorkspaceExportParams,
        GoogleWorkspaceExportResult,
        GoogleWorkspaceExportTerminalResult,
        GoogleWorkspaceExportUploadResult,
        normalize_google_workspace_export_params,
        stable_google_export_error_code,
    )


@workflow.defn(name="GoogleWorkspaceExportWorkflow")
class GoogleWorkspaceExportWorkflow:
    @workflow.run
    async def run(
        self,
        params: GoogleWorkspaceExportParams | dict[str, Any],
    ) -> GoogleWorkspaceExportTerminalResult:
        normalized = normalize_google_workspace_export_params(params)
        workflow_id = workflow.info().workflow_id
        retry = RetryPolicy(maximum_attempts=3)
        try:
            exported: GoogleWorkspaceExportUploadResult = await workflow.execute_activity(
                "export_project_object_to_google_workspace",
                normalized,
                result_type=GoogleWorkspaceExportUploadResult,
                start_to_close_timeout=timedelta(minutes=5),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return GoogleWorkspaceExportResult(
                ok=True,
                requestId=normalized.request_id,
                workflowId=workflow_id,
                objectId=normalized.object.id,
                provider=normalized.provider,
                externalObjectId=exported.externalObjectId,
                externalUrl=exported.externalUrl,
                exportedMimeType=exported.exportedMimeType,
                exportStatus="completed",
            )
        except Exception as exc:
            workflow.logger.exception("google workspace export failed: %s", exc)
            return GoogleWorkspaceExportErrorResult(
                ok=False,
                requestId=normalized.request_id,
                workflowId=workflow_id,
                objectId=normalized.object.id,
                provider=normalized.provider,
                exportStatus="failed",
                errorCode=stable_google_export_error_code(exc),
                retryable=True,
            )
