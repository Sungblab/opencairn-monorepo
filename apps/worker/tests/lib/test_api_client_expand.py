from unittest.mock import AsyncMock, patch

import pytest

from worker.lib.api_client import AgentApiClient


@pytest.mark.asyncio
async def test_expand_concept_graph_posts_to_internal_endpoint():
    client = AgentApiClient()
    fake_response = {"nodes": [{"id": "x"}], "edges": []}
    with patch(
        "worker.lib.api_client.post_internal",
        new=AsyncMock(return_value=fake_response),
    ) as post_mock:
        result = await client.expand_concept_graph(
            project_id="proj-1",
            workspace_id="ws-1",
            user_id="user-1",
            concept_id="concept-1",
            hops=2,
        )
    assert result == fake_response
    post_mock.assert_awaited_once_with(
        "/api/internal/projects/proj-1/graph/expand",
        {
            "conceptId": "concept-1",
            "hops": 2,
            "workspaceId": "ws-1",
            "userId": "user-1",
        },
    )


@pytest.mark.asyncio
async def test_expand_concept_graph_default_hops_one():
    client = AgentApiClient()
    with patch(
        "worker.lib.api_client.post_internal",
        new=AsyncMock(return_value={"nodes": [], "edges": []}),
    ) as post_mock:
        await client.expand_concept_graph(
            project_id="p", workspace_id="w", user_id="u", concept_id="c",
        )
    body = post_mock.await_args.args[1]
    assert body["hops"] == 1
