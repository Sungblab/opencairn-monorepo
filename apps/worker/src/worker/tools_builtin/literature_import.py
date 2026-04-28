"""``literature_import`` agent tool — dispatches LitImportWorkflow via internal API."""
from __future__ import annotations

from runtime.tools import ToolContext, tool
from worker.lib.api_client import post_internal


@tool(name="literature_import", allowed_scopes=("project",))
async def literature_import(
    ids: list[str],
    ctx: ToolContext,
) -> dict:
    """Import selected papers into the current project workspace.

    Fetches available open-access PDFs and creates source notes. Paywalled
    papers get metadata-only notes with a notice to upload the PDF
    manually. Workflow-side dedupe ensures the same DOI is never imported
    twice into the same workspace.

    Args:
        ids: List of paper IDs to import (DOI strings or "arxiv:<id>").
    """
    if not ids:
        return {"error": "No IDs provided", "queued": 0}
    if len(ids) > 50:
        return {"error": "Cannot import more than 50 papers at once", "queued": 0}
    if not ctx.project_id:
        return {"error": "project scope required", "queued": 0}

    result = await post_internal(
        "/api/internal/literature/import",
        {
            "ids": ids,
            "projectId": ctx.project_id,
            "userId": ctx.user_id,
            "workspaceId": ctx.workspace_id,
        },
    )

    queued = result.get("queued", 0)
    skipped = result.get("skipped", []) or []
    skipped_msg = (
        f", {len(skipped)}개 중복으로 건너뜀" if skipped else ""
    )
    return {
        "jobId": result.get("jobId"),
        "queued": queued,
        "skipped": skipped,
        "message": f"{queued}개 논문 가져오기 시작됨{skipped_msg}",
    }
