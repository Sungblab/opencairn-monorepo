from __future__ import annotations

import pytest
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from worker.activities.document_generation.types import (
    DocumentGenerationSourceBundle,
    GeneratedDocumentArtifact,
    ProjectObjectSummary,
)
from worker.workflows.document_generation_workflow import DocumentGenerationWorkflow


def _request() -> dict:
    return {
        "actionId": "00000000-0000-4000-8000-000000000011",
        "requestId": "00000000-0000-4000-8000-000000000020",
        "workspaceId": "00000000-0000-4000-8000-000000000001",
        "projectId": "00000000-0000-4000-8000-000000000003",
        "userId": "00000000-0000-4000-8000-000000000004",
        "generation": {
            "format": "pdf",
            "prompt": "Generate a polished project report.",
            "locale": "ko",
            "template": "report",
            "sources": [],
            "destination": {
                "filename": "project-report.pdf",
                "title": "Project report",
                "publishAs": "agent_file",
                "startIngest": False,
            },
            "artifactMode": "object_storage",
        },
    }


@activity.defn(name="hydrate_document_generation_sources")
async def fake_hydrate(_params: dict) -> DocumentGenerationSourceBundle:
    return DocumentGenerationSourceBundle()


@activity.defn(name="generate_document_artifact")
async def fake_generate(
    _params: dict,
    _sources: DocumentGenerationSourceBundle,
) -> GeneratedDocumentArtifact:
    return GeneratedDocumentArtifact(
        objectKey="agent-files/project/document-generation/request/project-report.pdf",
        mimeType="application/pdf",
        bytes=128,
    )


@activity.defn(name="register_document_generation_result")
async def fake_register(
    _params: dict, _artifact: GeneratedDocumentArtifact, _workflow_id: str
) -> ProjectObjectSummary:
    return ProjectObjectSummary(
        id="00000000-0000-4000-8000-000000000010",
        objectType="agent_file",
        title="Project report",
        filename="project-report.pdf",
        kind="pdf",
        mimeType="application/pdf",
        projectId="00000000-0000-4000-8000-000000000003",
    )


@activity.defn(name="register_document_generation_result")
async def fake_register_fails(
    _params: dict, _artifact: GeneratedDocumentArtifact, _workflow_id: str
) -> ProjectObjectSummary:
    raise RuntimeError("internal_api_unavailable")


@pytest.mark.asyncio
async def test_document_generation_workflow_returns_terminal_success_result() -> None:
    async with (
        await WorkflowEnvironment.start_time_skipping() as env,
        Worker(
            env.client,
            task_queue="doc-gen-test-q",
            workflows=[DocumentGenerationWorkflow],
            activities=[fake_hydrate, fake_generate, fake_register],
        ),
    ):
        result = await env.client.execute_workflow(
            DocumentGenerationWorkflow.run,
            _request(),
            id="document-generation/00000000-0000-4000-8000-000000000020",
            task_queue="doc-gen-test-q",
        )

    assert result.ok is True
    assert result.requestId == "00000000-0000-4000-8000-000000000020"
    assert result.workflowId == "document-generation/00000000-0000-4000-8000-000000000020"
    assert result.format == "pdf"
    assert result.object.id == "00000000-0000-4000-8000-000000000010"
    assert result.artifact.objectKey.endswith("/project-report.pdf")


@pytest.mark.asyncio
async def test_document_generation_workflow_returns_terminal_failure_result() -> None:
    async with (
        await WorkflowEnvironment.start_time_skipping() as env,
        Worker(
            env.client,
            task_queue="doc-gen-test-q",
            workflows=[DocumentGenerationWorkflow],
            activities=[fake_hydrate, fake_generate, fake_register_fails],
        ),
    ):
        result = await env.client.execute_workflow(
            DocumentGenerationWorkflow.run,
            _request(),
            id="document-generation/00000000-0000-4000-8000-000000000020",
            task_queue="doc-gen-test-q",
        )

    assert result.ok is False
    assert result.requestId == "00000000-0000-4000-8000-000000000020"
    assert result.workflowId == "document-generation/00000000-0000-4000-8000-000000000020"
    assert result.format == "pdf"
    assert result.errorCode == "document_generation_failed"
    assert result.retryable is True
