"""get_concept_graph - N-hop subgraph fetch tool.

Wraps AgentApiClient.expand_concept_graph against the internal route
/api/internal/projects/:id/graph/expand. Used by VisualizationAgent
and reusable by other agents.

Mirrors `search_concepts.py`: client is instantiated inside the tool
(env-driven), workspace_id/user_id come from `ctx: ToolContext`.
"""
from __future__ import annotations

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient


@tool(name="get_concept_graph", allowed_scopes=("project",))
async def get_concept_graph(
    concept_id: str,
    ctx: ToolContext,
    hops: int = 1,
) -> dict:
    """Return concepts + edges within `hops` of `concept_id`.

    Args:
        concept_id: starting concept (project-scoped).
        hops: 1-3, capped at 3 server-side.
    Returns:
        {"nodes": [{id,name,description,degree,noteCount,firstNoteId}],
         "edges": [{id,sourceId,targetId,relationType,weight}]}
    """
    if hops < 1 or hops > 3:
        return {"error": "hops_out_of_range"}
    client = AgentApiClient()
    return await client.expand_concept_graph(
        project_id=ctx.project_id or "",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user_id,
        concept_id=concept_id,
        hops=hops,
    )
