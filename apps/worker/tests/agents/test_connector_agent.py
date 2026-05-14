"""ConnectorAgent unit tests.

All HTTP I/O is mocked out via AsyncMock so these run fully offline.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from runtime.tools import ToolContext
from worker.agents.connector.agent import ConnectorAgent

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_provider():
    p = MagicMock()
    p.config.model = "gemini-test"
    return p


@pytest.fixture
def mock_api():
    return MagicMock()


@pytest.fixture
def ctx():
    return ToolContext(
        workspace_id="ws-1",
        project_id="proj-1",
        page_id=None,
        user_id="user-1",
        run_id="run-1",
        scope="project",
        emit=AsyncMock(),
    )


# ---------------------------------------------------------------------------
# Test 1: Happy path — one above-threshold candidate produces one suggestion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connector_happy_path(mock_provider, mock_api, ctx):
    """Happy path: concept with embedding, one matching cross-project candidate."""
    with patch(
        "worker.agents.connector.agent.get_internal", new_callable=AsyncMock
    ) as mock_get, patch(
        "worker.agents.connector.agent._cross_project_search", new_callable=AsyncMock
    ) as mock_search, patch(
        "worker.agents.connector.agent.post_internal", new_callable=AsyncMock
    ) as mock_post:
        mock_get.return_value = {
            "id": "c1",
            "name": "Quantum",
            "embedding": [0.1] * 768,
        }
        mock_search.return_value = [
            {
                "id": "c2",
                "name": "ML",
                "project_id": "proj-2",
                "similarity": 0.85,
            }
        ]
        mock_post.return_value = {"id": "sugg-1"}

        agent = ConnectorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "concept_id": "c1",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

    types = [e.type for e in events]
    assert "agent_start" in types
    assert "agent_end" in types
    assert "custom" in types

    end_ev = next(e for e in events if e.type == "agent_end")
    assert end_ev.output["candidates_found"] == 1
    assert end_ev.output["suggestion_ids"] == ["sugg-1"]

    # Verify post_internal was called with the right shape.
    call_args = mock_post.call_args
    assert call_args[0][0] == "/api/internal/suggestions"
    payload = call_args[0][1]
    assert payload["type"] == "connector_link"
    assert payload["payload"]["sourceConceptId"] == "c1"
    assert payload["payload"]["targetConceptId"] == "c2"
    assert payload["payload"]["similarity"] == 0.85


# ---------------------------------------------------------------------------
# Test 2: No embedding — agent skips search and ends cleanly with zero counts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connector_no_embedding(mock_provider, mock_api, ctx):
    """When concept has no embedding, agent emits AgentEnd with zero counts
    without attempting a search or persisting anything."""
    with patch(
        "worker.agents.connector.agent.get_internal", new_callable=AsyncMock
    ) as mock_get, patch(
        "worker.agents.connector.agent._cross_project_search", new_callable=AsyncMock
    ) as mock_search, patch(
        "worker.agents.connector.agent.post_internal", new_callable=AsyncMock
    ) as mock_post:
        mock_get.return_value = {"id": "c1", "name": "Quantum", "embedding": None}

        agent = ConnectorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "concept_id": "c1",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

    end_ev = next(e for e in events if e.type == "agent_end")
    assert end_ev.output["candidates_found"] == 0
    assert end_ev.output["suggestion_ids"] == []

    mock_search.assert_not_called()
    mock_post.assert_not_called()


# ---------------------------------------------------------------------------
# Test 3: Below threshold — candidates found but none pass the threshold filter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connector_below_threshold(mock_provider, mock_api, ctx):
    """Candidates found but all below threshold → no suggestions created."""
    with patch(
        "worker.agents.connector.agent.get_internal", new_callable=AsyncMock
    ) as mock_get, patch(
        "worker.agents.connector.agent._cross_project_search", new_callable=AsyncMock
    ) as mock_search, patch(
        "worker.agents.connector.agent.post_internal", new_callable=AsyncMock
    ) as mock_post:
        mock_get.return_value = {
            "id": "c1",
            "name": "Quantum",
            "embedding": [0.1] * 768,
        }
        # Both candidates are below the default threshold of 0.75.
        mock_search.return_value = [
            {"id": "c2", "name": "Foo", "project_id": "proj-2", "similarity": 0.5},
            {"id": "c3", "name": "Bar", "project_id": "proj-3", "similarity": 0.6},
        ]

        agent = ConnectorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "concept_id": "c1",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
                "threshold": 0.75,
            },
            ctx,
        ):
            events.append(ev)

    end_ev = next(e for e in events if e.type == "agent_end")
    # Two candidates were found in the search but none persist.
    assert end_ev.output["candidates_found"] == 2
    assert end_ev.output["suggestion_ids"] == []
    mock_post.assert_not_called()


# ---------------------------------------------------------------------------
# Test 4: Empty candidates — search returns nothing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connector_empty_candidates(mock_provider, mock_api, ctx):
    """Cross-project search returns no candidates → zero suggestions."""
    with patch(
        "worker.agents.connector.agent.get_internal", new_callable=AsyncMock
    ) as mock_get, patch(
        "worker.agents.connector.agent._cross_project_search", new_callable=AsyncMock
    ) as mock_search, patch(
        "worker.agents.connector.agent.post_internal", new_callable=AsyncMock
    ) as mock_post:
        mock_get.return_value = {
            "id": "c1",
            "name": "Quantum",
            "embedding": [0.1] * 768,
        }
        mock_search.return_value = []

        agent = ConnectorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "concept_id": "c1",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

    end_ev = next(e for e in events if e.type == "agent_end")
    assert end_ev.output["candidates_found"] == 0
    assert end_ev.output["suggestion_ids"] == []

    # Persist call should still happen (with count=0 so no POST to /suggestions).
    mock_post.assert_not_called()


# ---------------------------------------------------------------------------
# Test 5: Error handling — get_internal raises, agent emits AgentError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connector_error_handling(mock_provider, mock_api, ctx):
    """When get_internal raises, agent emits AgentError and re-raises."""

    with patch(
        "worker.agents.connector.agent.get_internal", new_callable=AsyncMock
    ) as mock_get:
        mock_get.side_effect = RuntimeError("network down")

        agent = ConnectorAgent(provider=mock_provider, api=mock_api)
        events = []
        with pytest.raises(RuntimeError, match="network down"):
            async for ev in agent.run(
                {
                    "concept_id": "c1",
                    "project_id": "proj-1",
                    "workspace_id": "ws-1",
                    "user_id": "user-1",
                },
                ctx,
            ):
                events.append(ev)

    error_ev = next((e for e in events if e.type == "agent_error"), None)
    assert error_ev is not None
    assert error_ev.error_class == "RuntimeError"
    assert "network down" in error_ev.message


# ---------------------------------------------------------------------------
# Test 6: High threshold filters everything even when similarity is 0.74
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connector_high_threshold_filters_all(mock_provider, mock_api, ctx):
    """With threshold=0.9, a candidate at 0.74 similarity is excluded."""
    with patch(
        "worker.agents.connector.agent.get_internal", new_callable=AsyncMock
    ) as mock_get, patch(
        "worker.agents.connector.agent._cross_project_search", new_callable=AsyncMock
    ) as mock_search, patch(
        "worker.agents.connector.agent.post_internal", new_callable=AsyncMock
    ) as mock_post:
        mock_get.return_value = {
            "id": "c1",
            "name": "Concept",
            "embedding": [0.1] * 768,
        }
        mock_search.return_value = [
            {"id": "c2", "name": "Related", "project_id": "proj-2", "similarity": 0.74},
            {"id": "c3", "name": "Close", "project_id": "proj-3", "similarity": 0.89},
        ]

        agent = ConnectorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "concept_id": "c1",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
                "threshold": 0.9,
            },
            ctx,
        ):
            events.append(ev)

    end_ev = next(e for e in events if e.type == "agent_end")
    # Two candidates found in the raw search.
    assert end_ev.output["candidates_found"] == 2
    # But neither passes the 0.9 threshold.
    assert end_ev.output["suggestion_ids"] == []
    mock_post.assert_not_called()


# ---------------------------------------------------------------------------
# Test 7: Multiple above-threshold candidates → multiple suggestions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connector_multiple_suggestions(mock_provider, mock_api, ctx):
    """Three candidates all above threshold → three suggestion rows created."""
    with patch(
        "worker.agents.connector.agent.get_internal", new_callable=AsyncMock
    ) as mock_get, patch(
        "worker.agents.connector.agent._cross_project_search", new_callable=AsyncMock
    ) as mock_search, patch(
        "worker.agents.connector.agent.post_internal", new_callable=AsyncMock
    ) as mock_post:
        mock_get.return_value = {
            "id": "c1",
            "name": "Concept",
            "embedding": [0.1] * 768,
        }
        mock_search.return_value = [
            {"id": "c2", "name": "A", "project_id": "proj-2", "similarity": 0.80},
            {"id": "c3", "name": "B", "project_id": "proj-3", "similarity": 0.85},
            {"id": "c4", "name": "C", "project_id": "proj-4", "similarity": 0.90},
        ]
        # Return a different suggestion id per call.
        mock_post.side_effect = [
            {"id": "sugg-1"},
            {"id": "sugg-2"},
            {"id": "sugg-3"},
        ]

        agent = ConnectorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "concept_id": "c1",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
                "threshold": 0.75,
            },
            ctx,
        ):
            events.append(ev)

    end_ev = next(e for e in events if e.type == "agent_end")
    assert end_ev.output["candidates_found"] == 3
    assert sorted(end_ev.output["suggestion_ids"]) == ["sugg-1", "sugg-2", "sugg-3"]
    assert mock_post.call_count == 3


# ---------------------------------------------------------------------------
# Test 8: Event sequence check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connector_event_sequence(mock_provider, mock_api, ctx):
    """Event stream follows the expected order: start → tool_use/result pairs
    → custom → end."""
    with patch(
        "worker.agents.connector.agent.get_internal", new_callable=AsyncMock
    ) as mock_get, patch(
        "worker.agents.connector.agent._cross_project_search", new_callable=AsyncMock
    ) as mock_search, patch(
        "worker.agents.connector.agent.post_internal", new_callable=AsyncMock
    ) as mock_post:
        mock_get.return_value = {
            "id": "c1",
            "name": "X",
            "embedding": [0.5] * 768,
        }
        mock_search.return_value = [
            {"id": "c2", "name": "Y", "project_id": "proj-2", "similarity": 0.8}
        ]
        mock_post.return_value = {"id": "sugg-1"}

        agent = ConnectorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "concept_id": "c1",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

    types = [e.type for e in events]
    # Must start with agent_start and end with agent_end.
    assert types[0] == "agent_start"
    assert types[-1] == "agent_end"
    # Must contain tool_use/result pairs and a custom summary event.
    assert "tool_use" in types
    assert "tool_result" in types
    assert "custom" in types
    # custom must come before agent_end.
    assert types.index("custom") < types.index("agent_end")
