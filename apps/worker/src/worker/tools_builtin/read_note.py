"""`read_note` tool — full note content with workspace isolation."""
from __future__ import annotations

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient

MAX_CONTENT_CHARS = 50_000


@tool(name="read_note", allowed_scopes=("project",))
async def read_note(note_id: str, ctx: ToolContext) -> dict:
    """Fetch the full content of a specific note. Use after
    search_concepts or search_notes identified something worth reading.
    """
    client = AgentApiClient()
    try:
        note = await client.get_note(note_id)
    except Exception as e:
        return {"error": f"Failed to fetch note: {e}"}

    # Defence in depth — even if the caller injected a note_id from
    # another workspace, the API response includes workspaceId and we
    # check it here (project_id is stricter still).
    if note.get("workspaceId") != ctx.workspace_id:
        return {
            "error": (
                f"Note {note_id} does not belong to current workspace"
            )
        }

    content = note.get("contentText") or ""
    truncated = False
    if len(content) > MAX_CONTENT_CHARS:
        content = content[: MAX_CONTENT_CHARS - 100] + "\n\n[truncated]"
        truncated = True

    return {
        "id": note["id"],
        "title": note.get("title"),
        "content": content,
        "truncated": truncated,
        "project_id": note.get("projectId"),
    }
