"""``literature_search`` agent tool — federated paper search via internal API."""
from __future__ import annotations

from urllib.parse import urlencode

from runtime.tools import ToolContext, tool
from worker.lib.api_client import get_internal


@tool(name="literature_search", allowed_scopes=())
async def literature_search(
    query: str,
    ctx: ToolContext,
    limit: int = 10,
    sources: str = "arxiv,semantic_scholar",
) -> dict:
    """Search academic papers from arXiv and Semantic Scholar.

    Returns a list of papers with title, authors, year, citation count,
    and whether an open-access PDF is available.

    Args:
        query: Search terms (title, author, keyword, or concept).
        limit: Number of results to return (max 50, default 10).
        sources: Comma-separated sources. Options: arxiv, semantic_scholar, crossref.
    """
    params = urlencode(
        {
            "q": query,
            "workspaceId": ctx.workspace_id,
            "limit": min(limit, 50),
            "sources": sources,
        }
    )
    result = await get_internal(f"/api/internal/literature/search?{params}")
    papers = result.get("results", [])
    return {
        "papers": [
            {
                "id": p["id"],
                "title": p["title"],
                # Cap authors so the LLM context stays small; the full list
                # is in the workspace tab via the openInEditor follow-up.
                "authors": p.get("authors", [])[:3],
                "year": p.get("year"),
                "citationCount": p.get("citationCount"),
                "openAccess": p.get("openAccessPdfUrl") is not None,
                "source": p.get("source"),
                "doi": p.get("doi"),
                "arxivId": p.get("arxivId"),
            }
            for p in papers
        ],
        "total": result.get("total", len(papers)),
    }
