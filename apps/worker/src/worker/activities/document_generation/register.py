"""Register generated document artifacts as project objects."""
from __future__ import annotations

from typing import Any

from temporalio import activity

from worker.activities.document_generation.generate import (
    heartbeat_safe,
    normalize_destination,
    normalize_generation,
    normalize_params,
)
from worker.activities.document_generation.types import (
    DocumentGenerationSourceBundle,
    DocumentGenerationWorkflowParams,
    GeneratedDocumentArtifact,
    ProjectObjectSummary,
    normalize_source_bundle,
)
from worker.lib.api_client import post_internal


def _to_project_object_summary(raw: dict[str, Any]) -> ProjectObjectSummary:
    return ProjectObjectSummary(
        id=raw["id"],
        objectType=raw.get("objectType", raw.get("object_type", "agent_file")),
        title=raw["title"],
        filename=raw["filename"],
        kind=raw["kind"],
        mimeType=raw.get("mimeType", raw.get("mime_type")),
        projectId=raw.get("projectId", raw.get("project_id")),
    )


@activity.defn(name="register_document_generation_result")
async def register_document_generation_result(
    params: DocumentGenerationWorkflowParams | dict[str, Any],
    artifact: GeneratedDocumentArtifact | dict[str, Any],
    workflow_id: str,
    source_bundle: DocumentGenerationSourceBundle | dict[str, Any] | None = None,
) -> ProjectObjectSummary:
    normalized = normalize_params(params)
    generation = normalize_generation(normalized.generation)
    destination = normalize_destination(generation.destination)
    artifact_dict = (
        {
            "objectKey": artifact.objectKey,
            "mimeType": artifact.mimeType,
            "bytes": artifact.bytes,
        }
        if isinstance(artifact, GeneratedDocumentArtifact)
        else artifact
    )

    heartbeat_safe("registering generated document project object")
    response = await post_internal(
        "/api/internal/document-generation/agent-files",
        {
            "actionId": normalized.action_id,
            "requestId": normalized.request_id,
            "workflowId": workflow_id,
            "workspaceId": normalized.workspace_id,
            "projectId": normalized.project_id,
            "userId": normalized.user_id,
            "filename": destination.filename,
            "title": destination.title or destination.filename,
            "folderId": destination.folder_id,
            "kind": generation.format,
            "mimeType": artifact_dict["mimeType"],
            "objectKey": artifact_dict["objectKey"],
            "bytes": artifact_dict["bytes"],
            "source": "document_generation",
            "startIngest": destination.start_ingest,
            "metadata": {
                "template": generation.template,
                "locale": generation.locale,
                "sourceCount": len(generation.sources),
                "sourceQuality": _source_quality_metadata(source_bundle),
            },
        },
    )
    return _to_project_object_summary(response.get("object", response))


def _source_quality_metadata(
    source_bundle: DocumentGenerationSourceBundle | dict[str, Any] | None,
) -> dict[str, Any]:
    bundle = normalize_source_bundle(source_bundle)
    sources = []
    signals = []
    for item in bundle.items:
        item_signals = list(dict.fromkeys(item.quality_signals))
        if not item_signals:
            continue
        signals.extend(item_signals)
        sources.append(
            {
                "id": item.id,
                "kind": item.kind,
                "title": item.title,
                "signals": item_signals,
            }
        )
    return {
        "signals": list(dict.fromkeys(signals)),
        "sources": sources,
    }
