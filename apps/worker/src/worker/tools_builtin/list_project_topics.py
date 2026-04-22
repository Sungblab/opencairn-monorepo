"""`list_project_topics` tool — Layer 3 hierarchical retrieval entry."""
from __future__ import annotations

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient


@tool(name="list_project_topics", allowed_scopes=("project",))
async def list_project_topics(ctx: ToolContext) -> list[dict]:
    """Return the top topics in the current project. Start here to see
    what domains this project covers. Then use search_concepts to drill
    into one topic.
    """
    client = AgentApiClient()
    return await client.list_project_topics(project_id=ctx.project_id)
