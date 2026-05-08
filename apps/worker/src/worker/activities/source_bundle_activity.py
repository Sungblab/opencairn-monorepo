"""Source bundle materialization activities for uploaded PDF ingest."""
from __future__ import annotations

from typing import Any

from temporalio import activity

from worker.lib.api_client import post_internal
from worker.lib.ingest_events import publish_safe


@activity.defn(name="create_source_bundle_artifact")
async def create_source_bundle_artifact(inp: dict[str, Any]) -> dict[str, Any]:
    """Create a durable child artifact under a source bundle tree node."""
    bundle_node_id = inp["bundle_node_id"]
    result = await post_internal(
        f"/api/internal/source-bundles/{bundle_node_id}/artifacts",
        {
            "workspaceId": inp["workspace_id"],
            "projectId": inp["project_id"],
            "userId": inp["user_id"],
            "parentNodeId": inp["parent_node_id"],
            "kind": inp.get("kind", "agent_file"),
            "label": inp["label"],
            "role": inp["role"],
            "text": inp.get("text"),
            "filename": inp.get("filename"),
            "mimeType": inp.get("mime_type"),
            "metadata": inp.get("metadata", {}),
        },
    )
    workflow_id = inp.get("workflow_id")
    if workflow_id:
        await publish_safe(workflow_id, "artifact_created", {
            "nodeId": result["nodeId"],
            "parentId": inp["parent_node_id"],
            "kind": inp.get("kind", "agent_file"),
            "label": inp["label"],
            "role": inp["role"],
            **({"pageIndex": inp["page_index"]} if inp.get("page_index") is not None else {}),
            **({"figureIndex": inp["figure_index"]} if inp.get("figure_index") is not None else {}),
        })
    return result


@activity.defn(name="update_source_bundle_status")
async def update_source_bundle_status(inp: dict[str, Any]) -> dict[str, Any]:
    """Update source bundle status metadata and publish an ingest event."""
    bundle_node_id = inp["bundle_node_id"]
    status = inp["status"]
    body = {"status": status}
    if inp.get("reason"):
        body["reason"] = inp["reason"]
    result = await post_internal(
        f"/api/internal/source-bundles/{bundle_node_id}/status",
        body,
    )
    workflow_id = inp.get("workflow_id")
    if workflow_id:
        await publish_safe(workflow_id, "bundle_status_changed", {
            "bundleNodeId": bundle_node_id,
            "status": status,
            **({"reason": inp["reason"]} if inp.get("reason") else {}),
        })
    return result
