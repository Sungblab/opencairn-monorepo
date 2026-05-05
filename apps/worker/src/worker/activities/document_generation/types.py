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
SourceQualitySignal = Literal[
    "metadata_fallback",
    "unsupported_source",
    "source_corrupt",
    "source_oversized",
    "scanned_no_text",
    "no_extracted_text",
    "source_hydration_failed",
    "source_token_budget_exceeded",
]
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
    action_id: str
    request_id: str
    workspace_id: str
    project_id: str
    user_id: str
    generation: DocumentGenerationRequest | dict[str, Any]


@dataclass(frozen=True)
class DocumentGenerationSourceItem:
    id: str
    title: str
    body: str
    kind: str
    token_count: int
    included: bool = True
    quality_signals: list[SourceQualitySignal] = field(default_factory=list)


@dataclass
class DocumentGenerationSourceBundle:
    items: list[DocumentGenerationSourceItem] = field(default_factory=list)


def normalize_source_bundle(
    raw: DocumentGenerationSourceBundle | dict[str, Any] | None,
) -> DocumentGenerationSourceBundle:
    if raw is None:
        return DocumentGenerationSourceBundle()
    if isinstance(raw, DocumentGenerationSourceBundle):
        return raw
    return DocumentGenerationSourceBundle(
        items=[
            item
            if isinstance(item, DocumentGenerationSourceItem)
            else DocumentGenerationSourceItem(
                id=str(item["id"]),
                title=str(item.get("title") or item["id"]),
                body=str(item.get("body") or ""),
                kind=str(item.get("kind") or "source"),
                token_count=int(item.get("token_count", item.get("tokenCount", 1))),
                included=bool(item.get("included", True)),
                quality_signals=list(
                    item.get("quality_signals", item.get("qualitySignals", []))
                ),
            )
            for item in raw.get("items", [])
        ]
    )


@dataclass(frozen=True)
class GeneratedDocumentArtifact:
    objectKey: str
    mimeType: str
    bytes: int


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
