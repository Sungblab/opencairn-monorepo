"""`search_concepts` tool — concept-level hybrid retrieval."""
from __future__ import annotations

from llm.base import EmbedInput
from llm.factory import get_provider

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient


@tool(name="search_concepts", allowed_scopes=("project",))
async def search_concepts(
    query: str,
    ctx: ToolContext,
    k: int = 5,
) -> list[dict]:
    """Vector search over concepts in the current project. Returns
    summaries (not full page content). Use read_note to drill into a
    specific source note after picking a concept.
    """
    provider = get_provider()
    [embedding] = await provider.embed(
        [EmbedInput(text=query, task="retrieval_query")],
    )
    client = AgentApiClient()
    return await client.search_concepts(
        project_id=ctx.project_id,
        embedding=embedding,
        k=k,
    )
