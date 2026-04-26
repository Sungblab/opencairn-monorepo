from unittest.mock import AsyncMock, patch

import pytest

from runtime.tools import ToolContext
from worker.tools_builtin.get_concept_graph import get_concept_graph


def _ctx(**kw):
    return ToolContext(
        workspace_id=kw.pop("workspace_id", "ws-1"),
        project_id=kw.pop("project_id", "proj-1"),
        page_id=None,
        user_id=kw.pop("user_id", "user-1"),
        run_id="run-1",
        scope="project",
        emit=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_calls_expand_concept_graph_with_ctx_values():
    ctx = _ctx()
    fake = {"nodes": [{"id": "n1"}], "edges": []}
    with patch(
        "worker.tools_builtin.get_concept_graph.AgentApiClient",
    ) as klass:
        instance = klass.return_value
        instance.expand_concept_graph = AsyncMock(return_value=fake)
        result = await get_concept_graph.run(
            {"concept_id": "c-1", "hops": 2}, ctx,
        )
    assert result == fake
    instance.expand_concept_graph.assert_awaited_once_with(
        project_id="proj-1",
        workspace_id="ws-1",
        user_id="user-1",
        concept_id="c-1",
        hops=2,
    )


@pytest.mark.asyncio
async def test_hops_out_of_range_returns_error_dict():
    ctx = _ctx()
    res_low = await get_concept_graph.run({"concept_id": "c", "hops": 0}, ctx)
    res_high = await get_concept_graph.run({"concept_id": "c", "hops": 4}, ctx)
    assert res_low == {"error": "hops_out_of_range"}
    assert res_high == {"error": "hops_out_of_range"}


@pytest.mark.asyncio
async def test_default_hops_one():
    ctx = _ctx()
    with patch(
        "worker.tools_builtin.get_concept_graph.AgentApiClient",
    ) as klass:
        instance = klass.return_value
        instance.expand_concept_graph = AsyncMock(return_value={})
        await get_concept_graph.run({"concept_id": "c"}, ctx)
    instance.expand_concept_graph.assert_awaited_once()
    assert instance.expand_concept_graph.await_args.kwargs["hops"] == 1


def test_tool_metadata():
    assert get_concept_graph.name == "get_concept_graph"
    assert "project" in get_concept_graph.allowed_scopes
