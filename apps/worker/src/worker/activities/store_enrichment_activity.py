"""Spec B — persist an enrichment artifact to the DB via the internal API.

Kept separate from ``enrich_document`` so that retries hit only the cheap
HTTP path (the LLM call upstream is single-shot).
"""

from __future__ import annotations

from temporalio import activity

from worker.lib.api_client import post_internal


@activity.defn(name="store_enrichment_artifact")
async def store_enrichment_artifact(inp: dict) -> dict:
    note_id: str = inp["note_id"]
    if activity.in_activity():
        activity.logger.info("storing enrichment for note %s", note_id)

    payload = {
        "workspaceId": inp["workspace_id"],
        "contentType": inp.get("content_type", "document"),
        "status": "done",
        "artifact": inp.get("artifact"),
        "provider": inp.get("provider"),
        "skipReasons": inp.get("skip_reasons", []),
        "error": inp.get("error"),
    }
    result = await post_internal(
        f"/api/internal/notes/{note_id}/enrichment", payload
    )
    if activity.in_activity():
        activity.logger.info("enrichment stored for note %s", note_id)
    return result
