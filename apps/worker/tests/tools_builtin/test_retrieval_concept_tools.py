from __future__ import annotations

from unittest.mock import AsyncMock, patch

from runtime.tools import ToolContext
from worker.tools_builtin.list_project_topics import list_project_topics
from worker.tools_builtin.search_concepts import search_concepts


def _ctx(project_id: str = "pj") -> ToolContext:
    async def _emit(_ev): ...
    return ToolContext(
        workspace_id="ws", project_id=project_id, page_id=None,
        user_id="u", run_id="r", scope="project",
        emit=_emit,
    )


async def test_list_project_topics_delegates_to_api():
    with patch(
        "worker.tools_builtin.list_project_topics.AgentApiClient",
    ) as cls:
        inst = cls.return_value
        inst.list_project_topics = AsyncMock(return_value=[
            {"topic_id": "c1", "name": "RoPE", "concept_count": 5},
        ])
        res = await list_project_topics.run(args={}, ctx=_ctx())
    assert res == [{"topic_id": "c1", "name": "RoPE", "concept_count": 5}]
    inst.list_project_topics.assert_awaited_once_with(project_id="pj")


async def test_search_concepts_embeds_query_then_calls_api():
    with patch(
        "worker.tools_builtin.search_concepts.get_provider",
    ) as get_provider, patch(
        "worker.tools_builtin.search_concepts.AgentApiClient",
    ) as cls:
        provider = AsyncMock()
        provider.embed = AsyncMock(return_value=[[0.1, 0.2]])
        get_provider.return_value = provider
        inst = cls.return_value
        inst.search_concepts = AsyncMock(return_value=[
            {"id": "c1", "name": "RoPE", "description": "..", "similarity": 0.9},
        ])
        res = await search_concepts.run(
            args={"query": "rotary embeddings", "k": 3}, ctx=_ctx(),
        )
    provider.embed.assert_awaited_once()
    inst.search_concepts.assert_awaited_once_with(
        project_id="pj", embedding=[0.1, 0.2], k=3,
    )
    assert res[0]["id"] == "c1"
