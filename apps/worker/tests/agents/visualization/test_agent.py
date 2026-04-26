from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.agents.visualization.agent import (
    VisualizationAgent,
    VisualizationFailed,
    VisualizeRequest,
)


def _request(**kw):
    return VisualizeRequest(
        project_id=kw.pop("project_id", "proj-1"),
        workspace_id=kw.pop("workspace_id", "ws-1"),
        user_id=kw.pop("user_id", "user-1"),
        run_id=kw.pop("run_id", "run-1"),
        prompt=kw.pop("prompt", "transformer mindmap"),
        view_hint=kw.pop("view_hint", None),
    )


def _make_loop_result(reason: str, structured: dict | None):
    result = MagicMock()
    result.termination_reason = reason
    result.final_structured_output = structured
    result.tool_call_count = 3
    result.turn_count = 2
    return result


@pytest.mark.asyncio
async def test_returns_view_spec_on_structured_submitted():
    provider = MagicMock()
    spec = {"viewType": "mindmap", "layout": "dagre", "rootId": "x",
            "nodes": [], "edges": []}
    with patch(
        "worker.agents.visualization.agent.run_with_tools",
        new=AsyncMock(return_value=_make_loop_result("structured_submitted", spec)),
    ):
        agent = VisualizationAgent(provider=provider)
        out = await agent.run(request=_request())
    assert out.view_spec == spec
    assert out.tool_calls == 3
    assert out.turn_count == 2


@pytest.mark.asyncio
async def test_failure_when_termination_not_structured_submitted():
    provider = MagicMock()
    with patch(
        "worker.agents.visualization.agent.run_with_tools",
        new=AsyncMock(return_value=_make_loop_result("max_turns", None)),
    ):
        agent = VisualizationAgent(provider=provider)
        with pytest.raises(VisualizationFailed, match="max_turns"):
            await agent.run(request=_request())


@pytest.mark.asyncio
async def test_failure_when_structured_output_is_none():
    provider = MagicMock()
    with patch(
        "worker.agents.visualization.agent.run_with_tools",
        new=AsyncMock(return_value=_make_loop_result("structured_submitted", None)),
    ):
        agent = VisualizationAgent(provider=provider)
        with pytest.raises(VisualizationFailed):
            await agent.run(request=_request())


@pytest.mark.asyncio
async def test_run_with_tools_called_with_three_tools_and_loop_config():
    provider = MagicMock()
    spec = {"viewType": "graph", "layout": "fcose", "rootId": None,
            "nodes": [], "edges": []}
    captured = {}

    async def fake(**kwargs):
        captured.update(kwargs)
        return _make_loop_result("structured_submitted", spec)

    with patch(
        "worker.agents.visualization.agent.run_with_tools", new=fake,
    ):
        agent = VisualizationAgent(provider=provider)
        await agent.run(request=_request(view_hint="mindmap"))

    tool_names = [t.name for t in captured["tools"]]
    assert tool_names == [
        "search_concepts", "get_concept_graph", "emit_structured_output",
    ]
    cfg = captured["config"]
    assert cfg.max_turns == 6
    assert cfg.max_tool_calls == 10
    ctx = captured["tool_context"]
    assert ctx["workspace_id"] == "ws-1"
    assert ctx["project_id"] == "proj-1"
    assert ctx["user_id"] == "user-1"
    assert ctx["scope"] == "project"
    msgs = captured["initial_messages"]
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"
    assert "User-preferred view: mindmap" in msgs[1]["text"]
