"""Temporal workflow for worker-backed document generation exports."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.document_generation.generate import (
        normalize_generation,
        normalize_params,
    )
    from worker.activities.document_generation.types import (
        DocumentGenerationErrorResult,
        DocumentGenerationResult,
        DocumentGenerationSourceBundle,
        DocumentGenerationTerminalResult,
        DocumentGenerationWorkflowParams,
        GeneratedDocumentArtifact,
        ProjectObjectSummary,
    )


@workflow.defn(name="DocumentGenerationWorkflow")
class DocumentGenerationWorkflow:
    @workflow.run
    async def run(
        self,
        params: DocumentGenerationWorkflowParams | dict[str, Any],
    ) -> DocumentGenerationTerminalResult:
        normalized = normalize_params(params)
        generation = normalize_generation(normalized.generation)
        workflow_id = workflow.info().workflow_id
        retry = RetryPolicy(maximum_attempts=2)

        try:
            sources: DocumentGenerationSourceBundle = await workflow.execute_activity(
                "hydrate_document_generation_sources",
                normalized,
                result_type=DocumentGenerationSourceBundle,
                start_to_close_timeout=timedelta(minutes=2),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            artifact: GeneratedDocumentArtifact = await workflow.execute_activity(
                "generate_document_artifact",
                args=[normalized, sources],
                result_type=GeneratedDocumentArtifact,
                start_to_close_timeout=timedelta(minutes=5),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            project_object: ProjectObjectSummary = await workflow.execute_activity(
                "register_document_generation_result",
                args=[normalized, artifact, workflow_id, sources],
                result_type=ProjectObjectSummary,
                start_to_close_timeout=timedelta(minutes=2),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return DocumentGenerationResult(
                ok=True,
                requestId=normalized.request_id,
                workflowId=workflow_id,
                format=generation.format,
                object=project_object,
                artifact=artifact,
            )
        except Exception as exc:
            workflow.logger.exception("document generation workflow failed: %s", exc)
            return DocumentGenerationErrorResult(
                ok=False,
                requestId=normalized.request_id,
                workflowId=workflow_id,
                format=generation.format,
                errorCode="document_generation_failed",
                retryable=True,
            )
