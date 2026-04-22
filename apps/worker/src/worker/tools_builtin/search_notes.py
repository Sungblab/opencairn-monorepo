"""`search_notes` tool — raw note/chunk hybrid retrieval."""
from __future__ import annotations

from typing import Literal

from llm.base import EmbedInput
from llm.factory import get_provider

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient


@tool(name="search_notes", allowed_scopes=("project",))
async def search_notes(
    query: str,
    ctx: ToolContext,
    k: int = 5,
    mode: Literal["synopsis", "full"] = "synopsis",
) -> list[dict]:
    """Chunk-level RRF hybrid search over source notes in the current
    project. Prefer synopsis mode; use full only when a deep dive is
    necessary.
    """
    provider = get_provider()
    [embedding] = await provider.embed(
        [EmbedInput(text=query, task="retrieval_query")],
    )
    client = AgentApiClient()
    hits = await client.hybrid_search_notes(
        project_id=ctx.project_id,
        query_text=query,
        query_embedding=embedding,
        k=k,
    )
    if mode == "synopsis":
        return [
            {**h, "snippet": (h.get("snippet") or "")[:400]}
            for h in hits
        ]
    return hits
