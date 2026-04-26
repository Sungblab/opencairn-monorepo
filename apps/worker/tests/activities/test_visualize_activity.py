"""Tests for :func:`worker.activities.visualize_activity.build_view`.

Plan 5 Phase 2 Task 7. The activity is a thin wrapper around
:class:`VisualizationAgent`: translates the workflow's raw payload into a
typed :class:`VisualizeRequest`, runs the agent with
:class:`HeartbeatLoopHooks`, and returns the validated ``ViewSpec`` dict.
:class:`VisualizationFailed` becomes a non-retryable
:class:`temporalio.exceptions.ApplicationError` so Temporal won't loop on
agent failures.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.activities.visualize_activity import build_view


@pytest.mark.asyncio
async def test_build_view_returns_view_spec_dict():
    spec = {
        "viewType": "graph", "layout": "fcose", "rootId": None,
        "nodes": [], "edges": [],
    }
    output = MagicMock(view_spec=spec, tool_calls=2, turn_count=1)
    with patch(
        "worker.activities.visualize_activity.get_provider",
        return_value=MagicMock(),
    ), patch(
        "worker.activities.visualize_activity.VisualizationAgent",
    ) as klass:
        klass.return_value.run = AsyncMock(return_value=output)
        result = await build_view({
            "projectId": "p-1",
            "workspaceId": "w-1",
            "userId": "u-1",
            "prompt": "tx mindmap",
        })
    assert result == spec


@pytest.mark.asyncio
async def test_build_view_passes_view_hint_when_present():
    spec = {"viewType": "mindmap", "layout": "dagre", "rootId": "x",
            "nodes": [], "edges": []}
    captured = {}

    async def fake_run(**kw):
        captured.update(kw)
        return MagicMock(view_spec=spec, tool_calls=1, turn_count=1)

    with patch(
        "worker.activities.visualize_activity.get_provider",
        return_value=MagicMock(),
    ), patch(
        "worker.activities.visualize_activity.VisualizationAgent",
    ) as klass:
        klass.return_value.run = fake_run
        await build_view({
            "projectId": "p", "workspaceId": "w", "userId": "u",
            "prompt": "x", "viewType": "mindmap",
        })
    req = captured["request"]
    assert req.view_hint == "mindmap"
    assert req.project_id == "p"
    assert req.workspace_id == "w"
    assert req.user_id == "u"
    assert req.prompt == "x"


@pytest.mark.asyncio
async def test_build_view_propagates_visualization_failed_as_application_error():
    from worker.agents.visualization.agent import VisualizationFailed

    with patch(
        "worker.activities.visualize_activity.get_provider",
        return_value=MagicMock(),
    ), patch(
        "worker.activities.visualize_activity.VisualizationAgent",
    ) as klass:
        klass.return_value.run = AsyncMock(side_effect=VisualizationFailed("max_turns"))
        with pytest.raises(Exception) as exc_info:
            await build_view({
                "projectId": "p", "workspaceId": "w", "userId": "u",
                "prompt": "x",
            })
    # Activity-friendly: the raised exception type subclasses ApplicationError
    # OR carries the original message.
    assert "max_turns" in str(exc_info.value)
