"""Types for the worker-backed document generation pipeline.

The TypeScript source of truth lives in
``packages/shared/src/project-object-actions.ts``. These dataclasses mirror the
JSON shape that Temporal receives after the API has injected authenticated
scope.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

DocumentGenerationFormat = Literal["pdf", "docx", "pptx", "xlsx"]
DocumentGenerationTemplate = Literal[
    "report",
    "brief",
    "research_summary",
    "deck",
    "spreadsheet",
    "custom",
]

MIME_TYPES: dict[DocumentGenerationFormat, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@dataclass(frozen=True)
class DocumentGenerationDestination:
    filename: str
    title: str | None = None
    folder_id: str | None = None
    publish_as: Literal["agent_file"] = "agent_file"
    start_ingest: bool = False


@dataclass(frozen=True)
class DocumentGenerationRequest:
    format: DocumentGenerationFormat
    prompt: str
    locale: str = "ko"
    template: DocumentGenerationTemplate = "report"
    sources: list[dict[str, Any]] = field(default_factory=list)
    destination: DocumentGenerationDestination | dict[str, Any] = field(
        default_factory=lambda: DocumentGenerationDestination(filename="document.pdf")
    )
    artifact_mode: Literal["object_storage"] = "object_storage"


@dataclass(frozen=True)
class DocumentGenerationWorkflowParams:
    request_id: str
    workspace_id: str
    project_id: str
    user_id: str
    generation: DocumentGenerationRequest | dict[str, Any]


@dataclass(frozen=True)
class GeneratedDocumentArtifact:
    objectKey: str
    mimeType: str
    bytes: int
    format: DocumentGenerationFormat


@dataclass(frozen=True)
class ProjectObjectSummary:
    id: str
    objectType: Literal["agent_file"]
    title: str
    filename: str
    kind: DocumentGenerationFormat
    mimeType: str
    projectId: str


@dataclass(frozen=True)
class DocumentGenerationResult:
    ok: Literal[True]
    requestId: str
    workflowId: str
    format: DocumentGenerationFormat
    object: ProjectObjectSummary
    artifact: GeneratedDocumentArtifact


@dataclass(frozen=True)
class DocumentGenerationErrorResult:
    ok: Literal[False]
    requestId: str
    workflowId: str | None = None
    format: DocumentGenerationFormat | None = None
    errorCode: str = "document_generation_failed"
    retryable: bool = True


DocumentGenerationTerminalResult = DocumentGenerationResult | DocumentGenerationErrorResult
