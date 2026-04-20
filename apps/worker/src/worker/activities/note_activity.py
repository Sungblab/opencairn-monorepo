"""Source-note creation activity.

Plan 3 Task 9. Called by :class:`worker.workflows.ingest_workflow.IngestWorkflow`
after the per-MIME parser (pdf/stt/image/youtube/web + optional enhance) has
produced a plain-text body. The activity POSTs the payload to the internal
Hono endpoint ``POST /api/internal/source-notes``, which persists a ``source``
note under the caller's project and returns the new note ID.

The ``trigger_compiler`` flag is always sent as True; the API side is a
Plan 5 wire-up point (currently a log statement).
"""
from __future__ import annotations

from temporalio import activity

from worker.lib.api_client import post_internal


def _derive_title(inp: dict) -> str:
    """Prefer an uploaded filename, fall back to the URL, finally a sentinel."""
    if inp.get("file_name"):
        return inp["file_name"]
    if inp.get("url"):
        return inp["url"]
    return "Untitled Source"


def _derive_source_type(mime_type: str) -> str:
    """Map an ingest MIME type to the `source_type` enum value.

    ``x-opencairn/youtube`` and ``x-opencairn/web-url`` are the synthetic
    mime types the Hono ingest route sets for URL-origin submissions
    (see ``apps/api/src/routes/ingest.ts``).
    """
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("image/"):
        return "image"
    mapping = {
        "application/pdf": "pdf",
        "x-opencairn/youtube": "youtube",
        "x-opencairn/web-url": "web",
    }
    return mapping.get(mime_type, "unknown")


@activity.defn(name="create_source_note")
async def create_source_note(inp: dict) -> str:
    """Call back into the API to create a source note; return its ID.

    Input dict (provided by :class:`IngestWorkflow`):
        - user_id, project_id, parent_note_id (nullable)
        - file_name, url (one of the two present)
        - mime_type, object_key (nullable)
        - text — extracted body
    """
    activity.logger.info(
        "Creating source note: user=%s project=%s",
        inp["user_id"],
        inp["project_id"],
    )

    payload = {
        "userId": inp["user_id"],
        "projectId": inp["project_id"],
        "parentNoteId": inp.get("parent_note_id"),
        "title": _derive_title(inp),
        "content": inp.get("text", ""),
        "sourceType": _derive_source_type(inp["mime_type"]),
        "objectKey": inp.get("object_key"),
        "sourceUrl": inp.get("url"),
        "mimeType": inp["mime_type"],
        "triggerCompiler": True,
    }
    result = await post_internal("/api/internal/source-notes", payload)
    note_id: str = result["noteId"]
    activity.logger.info("Source note created: %s", note_id)
    return note_id
