"""CuratorAgent unit tests.

All HTTP I/O is mocked out via AsyncMock so these run fully offline.
"""
from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, call, patch

from worker.agents.curator.agent import (
    CuratorAgent,
    CuratorInput,
    _build_candidate_pairs,
    _parse_contradiction_response,
)
from worker.agents.curator.prompts import (
    CONTRADICTION_SYSTEM,
    build_contradiction_prompt,
)
from runtime.tools import ToolContext
from runtime.events import (
    AgentStart,
    AgentEnd,
    AgentError,
    ModelEnd,
    ToolUse,
    ToolResult,
    CustomEvent,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_provider():
    p = MagicMock()
    p.config.model = "gemini-test"
    # Default: no contradictions found.
    p.generate = AsyncMock(
        return_value=json.dumps(
            {"contradicts": False, "confidence": 0.1, "reason": "no conflict"}
        )
    )
    return p


@pytest.fixture
def mock_api():
    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(return_value=[])
    api.list_concept_pairs = AsyncMock(return_value=[])
    api.list_ontology_issues = AsyncMock(
        return_value={
            "broadRelations": [],
            "hierarchyCycles": [],
            "promotionCandidates": [],
        }
    )
    api.list_project_topics = AsyncMock(return_value=[])
    return api


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
# Test 1: Happy path — empty project produces correct zero-count output
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_empty_project(mock_provider, mock_api, ctx):
    """Empty project (no orphans, no pairs, no topics) completes cleanly."""
    with patch(
        "worker.agents.curator.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        agent = CuratorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        types = [ev.type for ev in events]
        assert "agent_start" in types
        assert "tool_use" in types
        assert "tool_result" in types
        assert "custom" in types
        assert "agent_end" in types

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["orphans_found"] == 0
        assert end_ev.output["duplicates_found"] == 0
        assert end_ev.output["contradictions_found"] == 0
        assert end_ev.output["suggestions_created"] == 0

        mock_post.assert_not_called()


# ---------------------------------------------------------------------------
# Test 2: Orphan concepts create suggestions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_orphan_detection(mock_provider, ctx):
    """Orphan concepts each produce a curator_orphan suggestion."""
    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(
        return_value=[
            {"id": "c1", "name": "Orphan One"},
            {"id": "c2", "name": "Orphan Two"},
        ]
    )
    api.list_concept_pairs = AsyncMock(return_value=[])
    api.list_ontology_issues = AsyncMock(
        return_value={
            "broadRelations": [],
            "hierarchyCycles": [],
            "promotionCandidates": [],
        }
    )
    api.list_project_topics = AsyncMock(return_value=[])

    with patch(
        "worker.agents.curator.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "sugg-1"}

        agent = CuratorAgent(provider=mock_provider, api=api)
        events = []
        async for ev in agent.run(
            {
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["orphans_found"] == 2
        assert end_ev.output["suggestions_created"] == 2

        # Verify both suggestions were posted as curator_orphan.
        orphan_calls = [
            c for c in mock_post.call_args_list
            if c.args[1].get("type") == "curator_orphan"
        ]
        assert len(orphan_calls) == 2

        names = {c.args[1]["payload"]["name"] for c in orphan_calls}
        assert names == {"Orphan One", "Orphan Two"}


# ---------------------------------------------------------------------------
# Test 3: Duplicate pairs create suggestions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_duplicate_detection(mock_provider, ctx):
    """Near-duplicate concept pairs each produce a curator_duplicate suggestion."""
    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(return_value=[])
    api.list_concept_pairs = AsyncMock(
        return_value=[
            {
                "idA": "ca-1",
                "idB": "cb-1",
                "nameA": "Alpha",
                "nameB": "Alpha variant",
                "similarity": 0.95,
            }
        ]
    )
    api.list_ontology_issues = AsyncMock(
        return_value={
            "broadRelations": [],
            "hierarchyCycles": [],
            "promotionCandidates": [],
        }
    )
    api.list_project_topics = AsyncMock(return_value=[])

    with patch(
        "worker.agents.curator.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "sugg-2"}

        agent = CuratorAgent(provider=mock_provider, api=api)
        events = []
        async for ev in agent.run(
            {
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["duplicates_found"] == 1
        assert end_ev.output["suggestions_created"] == 1

        dup_calls = [
            c for c in mock_post.call_args_list
            if c.args[1].get("type") == "curator_duplicate"
        ]
        assert len(dup_calls) == 1
        payload = dup_calls[0].args[1]["payload"]
        assert payload["conceptAId"] == "ca-1"
        assert payload["conceptBId"] == "cb-1"
        assert payload["similarity"] == 0.95


# ---------------------------------------------------------------------------
# Test 4: Ontology issue detection creates reviewable suggestions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_ontology_issue_detection(mock_provider, ctx):
    """Ontology quality issues become curator suggestions without LLM calls."""
    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(return_value=[])
    api.list_concept_pairs = AsyncMock(return_value=[])
    api.list_ontology_issues = AsyncMock(
        return_value={
            "broadRelations": [
                {
                    "edge_id": "e-broad",
                    "issue_kind": "broad_relation",
                    "relation_type": "related-to",
                    "source_id": "c1",
                    "source_name": "자료형",
                    "target_id": "c2",
                    "target_name": "형 변환",
                    "weight": 0.8,
                },
                {
                    "edge_id": "e-unknown",
                    "issue_kind": "unknown_predicate",
                    "relation_type": "random-link",
                    "source_id": "c3",
                    "source_name": "입력",
                    "target_id": "c4",
                    "target_name": "출력",
                    "weight": 0.6,
                },
            ],
            "hierarchyCycles": [
                {
                    "edge_id": "e-cycle-a",
                    "reverse_edge_id": "e-cycle-b",
                    "source_id": "c5",
                    "source_name": "A",
                    "target_id": "c6",
                    "target_name": "B",
                }
            ],
            "promotionCandidates": [
                {
                    "edge_id": "e-promote",
                    "relation_type": "co-mentioned",
                    "source_id": "c7",
                    "source_name": "f-string",
                    "target_id": "c8",
                    "target_name": "문자열 포매팅",
                    "weight": 0.92,
                }
            ],
        }
    )
    api.list_project_topics = AsyncMock(return_value=[])

    with patch(
        "worker.agents.curator.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "sugg-ontology"}

        agent = CuratorAgent(provider=mock_provider, api=api)
        events = []
        async for ev in agent.run(
            {"project_id": "proj-1", "workspace_id": "ws-1", "user_id": "user-1"},
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["ontology_issues_found"] == 4
        assert end_ev.output["suggestions_created"] == 4

        posted_types = [c.args[1].get("type") for c in mock_post.call_args_list]
        assert posted_types.count("curator_relation_refinement") == 2
        assert posted_types.count("curator_ontology_violation") == 1
        assert posted_types.count("curator_hierarchy_cycle") == 1

        violation = next(
            c.args[1]["payload"]
            for c in mock_post.call_args_list
            if c.args[1].get("type") == "curator_ontology_violation"
        )
        assert violation["kind"] == "unknown_predicate"
        assert violation["relationType"] == "random-link"
        assert violation["proposedRelationType"] == "related-to"


# ---------------------------------------------------------------------------
# Test 5: Contradiction detection — LLM flags a contradiction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_contradiction_detection(ctx):
    """When LLM returns contradicts=true with confidence >= 0.7, a suggestion is created."""
    provider = MagicMock()
    provider.config.model = "gemini-test"
    provider.generate = AsyncMock(
        return_value=json.dumps(
            {"contradicts": True, "confidence": 0.85, "reason": "conflicting claims"}
        )
    )

    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(return_value=[])
    api.list_concept_pairs = AsyncMock(return_value=[])
    api.list_ontology_issues = AsyncMock(
        return_value={
            "broadRelations": [],
            "hierarchyCycles": [],
            "promotionCandidates": [],
        }
    )
    api.list_project_topics = AsyncMock(
        return_value=[
            {"id": "t1", "name": "Theory A", "description": "Claims X is true."},
            {"id": "t2", "name": "Theory B", "description": "Claims X is false."},
        ]
    )

    with patch(
        "worker.agents.curator.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "sugg-3"}

        agent = CuratorAgent(provider=provider, api=api)
        events = []
        async for ev in agent.run(
            {
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
                "max_contradiction_pairs": 5,
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["contradictions_found"] == 1
        assert end_ev.output["suggestions_created"] == 1

        contra_calls = [
            c for c in mock_post.call_args_list
            if c.args[1].get("type") == "curator_contradiction"
        ]
        assert len(contra_calls) == 1
        payload = contra_calls[0].args[1]["payload"]
        assert payload["conceptAId"] == "t1"
        assert payload["conceptBId"] == "t2"
        assert payload["confidence"] == 0.85

        # ModelEnd should have been emitted once (one LLM call).
        model_ends = [e for e in events if e.type == "model_end"]
        assert len(model_ends) == 1
        assert model_ends[0].model_id == "gemini-test"


# ---------------------------------------------------------------------------
# Test 6: Contradiction below threshold is NOT flagged
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_contradiction_below_threshold(ctx):
    """LLM returns contradicts=true but confidence < 0.7 — no suggestion created."""
    provider = MagicMock()
    provider.config.model = "gemini-test"
    provider.generate = AsyncMock(
        return_value=json.dumps(
            {"contradicts": True, "confidence": 0.5, "reason": "weak conflict"}
        )
    )

    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(return_value=[])
    api.list_concept_pairs = AsyncMock(return_value=[])
    api.list_ontology_issues = AsyncMock(
        return_value={
            "broadRelations": [],
            "hierarchyCycles": [],
            "promotionCandidates": [],
        }
    )
    api.list_project_topics = AsyncMock(
        return_value=[
            {"id": "t1", "name": "X", "description": "Desc X"},
            {"id": "t2", "name": "Y", "description": "Desc Y"},
        ]
    )

    with patch(
        "worker.agents.curator.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "sugg-x"}

        agent = CuratorAgent(provider=provider, api=api)
        events = []
        async for ev in agent.run(
            {"project_id": "proj-1", "workspace_id": "ws-1", "user_id": "user-1"},
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["contradictions_found"] == 0
        # No curator_contradiction suggestions.
        contra_calls = [
            c for c in mock_post.call_args_list
            if c.args[1].get("type") == "curator_contradiction"
        ]
        assert len(contra_calls) == 0


# ---------------------------------------------------------------------------
# Test 7: AgentError emitted on exception, exception re-raised
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_emits_agent_error_on_failure(mock_provider, ctx):
    """If the API call throws, AgentError is emitted and the exception propagates."""
    import httpx

    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(
        side_effect=httpx.HTTPStatusError(
            "service unavailable",
            request=MagicMock(),
            response=MagicMock(status_code=503),
        )
    )
    api.list_ontology_issues = AsyncMock(
        return_value={
            "broadRelations": [],
            "hierarchyCycles": [],
            "promotionCandidates": [],
        }
    )

    agent = CuratorAgent(provider=mock_provider, api=api)
    events = []
    with pytest.raises(httpx.HTTPStatusError):
        async for ev in agent.run(
            {"project_id": "proj-1", "workspace_id": "ws-1", "user_id": "user-1"},
            ctx,
        ):
            events.append(ev)

    error_evs = [e for e in events if e.type == "agent_error"]
    assert len(error_evs) == 1
    assert error_evs[0].retryable is True
    assert "503" in error_evs[0].message or "service unavailable" in error_evs[0].message


# ---------------------------------------------------------------------------
# Test 8: max_orphans cap is respected
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_respects_max_orphans_cap(mock_provider, ctx):
    """max_orphans=2 limits how many orphan suggestions are created even if API returns more."""
    api = MagicMock()
    api.list_orphan_concepts = AsyncMock(
        return_value=[
            {"id": f"c{i}", "name": f"Orphan {i}"}
            for i in range(5)
        ]
    )
    api.list_concept_pairs = AsyncMock(return_value=[])
    api.list_ontology_issues = AsyncMock(
        return_value={
            "broadRelations": [],
            "hierarchyCycles": [],
            "promotionCandidates": [],
        }
    )
    api.list_project_topics = AsyncMock(return_value=[])

    with patch(
        "worker.agents.curator.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "s"}

        agent = CuratorAgent(provider=mock_provider, api=api)
        events = []
        async for ev in agent.run(
            {
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
                "max_orphans": 2,
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["orphans_found"] == 2
        assert end_ev.output["suggestions_created"] == 2


# ---------------------------------------------------------------------------
# Test 9: custom event label is correct
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_curator_emits_completed_custom_event(mock_provider, mock_api, ctx):
    """curator.completed CustomEvent is emitted with the final counts."""
    with patch("worker.agents.curator.agent.post_internal", new_callable=AsyncMock):
        agent = CuratorAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {"project_id": "proj-1", "workspace_id": "ws-1", "user_id": "user-1"},
            ctx,
        ):
            events.append(ev)

        custom_ev = next(
            (e for e in events if e.type == "custom" and e.label == "curator.completed"),
            None,
        )
        assert custom_ev is not None
        assert "orphans_found" in custom_ev.payload
        assert "suggestions_created" in custom_ev.payload


# ---------------------------------------------------------------------------
# Helper unit tests
# ---------------------------------------------------------------------------


def test_parse_contradiction_response_valid():
    raw = json.dumps({"contradicts": True, "confidence": 0.9, "reason": "clash"})
    result = _parse_contradiction_response(raw)
    assert result["contradicts"] is True
    assert result["confidence"] == 0.9


def test_parse_contradiction_response_with_markdown_fence():
    raw = "```json\n{\"contradicts\": false, \"confidence\": 0.2, \"reason\": \"ok\"}\n```"
    result = _parse_contradiction_response(raw)
    assert result["contradicts"] is False


def test_parse_contradiction_response_invalid_json():
    result = _parse_contradiction_response("not json at all")
    assert result["contradicts"] is False
    assert result["confidence"] == 0.0
    assert result["reason"] == "parse_error"


def test_build_candidate_pairs_adjacent():
    topics = [
        {"id": f"t{i}", "name": f"Topic {i}", "description": f"Desc {i}"}
        for i in range(6)
    ]
    # Sliding window: (0,1), (1,2), (2,3), (3,4), (4,5) = 5 pairs (capped by max_pairs=5)
    pairs = _build_candidate_pairs(topics, max_pairs=5)
    assert len(pairs) == 5
    assert pairs[0][0]["id"] == "t0"
    assert pairs[0][1]["id"] == "t1"
    assert pairs[1][0]["id"] == "t1"
    assert pairs[1][1]["id"] == "t2"


def test_build_candidate_pairs_respects_max():
    topics = [
        {"id": f"t{i}", "name": f"T{i}", "description": "desc"}
        for i in range(10)
    ]
    pairs = _build_candidate_pairs(topics, max_pairs=2)
    assert len(pairs) == 2


def test_build_candidate_pairs_skips_empty_descriptions():
    topics = [
        {"id": "t0", "name": "A", "description": "Has content"},
        {"id": "t1", "name": "B", "description": ""},  # empty
        {"id": "t2", "name": "C", "description": "Also has content"},
        {"id": "t3", "name": "D", "description": "More content"},
    ]
    pairs = _build_candidate_pairs(topics, max_pairs=5)
    # Pair (t0, t1) is skipped because t1 has empty description.
    # Pair (t2, t3) should be included.
    assert len(pairs) == 1
    assert pairs[0][0]["id"] == "t2"
    assert pairs[0][1]["id"] == "t3"


def test_build_contradiction_prompt_contains_both_concepts():
    result = build_contradiction_prompt("Alpha", "Alpha desc", "Beta", "Beta desc")
    assert "Alpha" in result
    assert "Alpha desc" in result
    assert "Beta" in result
    assert "Beta desc" in result


def test_contradiction_system_prompt_not_empty():
    assert len(CONTRADICTION_SYSTEM) > 50
    assert "contradicts" in CONTRADICTION_SYSTEM
