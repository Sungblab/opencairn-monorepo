"""Tests for :mod:`worker.agents.research.agent`.

Structured like the Compiler tests: pure helpers direct, full-run end-to-end
with fake provider + fake API client.
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from llm.base import LLMProvider, ProviderConfig

from runtime.tools import ToolContext
from worker.agents.research.agent import (
    ResearchAgent,
    _parse_sub_queries,
    _parse_wiki_feedback,
)
from worker.agents.research.prompts import format_evidence_block

# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_parse_sub_queries_accepts_object_shape() -> None:
    raw = json.dumps({"sub_queries": ["What is X?", "How does X work?"]})
    assert _parse_sub_queries(raw) == ["What is X?", "How does X work?"]


def test_parse_sub_queries_accepts_plain_array() -> None:
    raw = json.dumps(["q1", "q2"])
    assert _parse_sub_queries(raw) == ["q1", "q2"]


def test_parse_sub_queries_caps_at_four() -> None:
    raw = json.dumps({"sub_queries": [f"q{i}" for i in range(10)]})
    assert len(_parse_sub_queries(raw)) == 4


def test_parse_sub_queries_strips_markdown_fence() -> None:
    raw = '```json\n{"sub_queries": ["a"]}\n```'
    assert _parse_sub_queries(raw) == ["a"]


def test_parse_sub_queries_returns_empty_on_garbage() -> None:
    assert _parse_sub_queries("not json") == []
    assert _parse_sub_queries("") == []


def test_parse_wiki_feedback_drops_hallucinated_ids() -> None:
    raw = json.dumps(
        {
            "feedback": [
                {"note_id": "note-real", "suggestion": "Add context", "reason": "missing"},
                {"note_id": "note-fake", "suggestion": "Update", "reason": "stale"},
            ]
        }
    )
    valid = {"note-real"}
    out = _parse_wiki_feedback(raw, valid)
    assert len(out) == 1
    assert out[0].note_id == "note-real"


def test_parse_wiki_feedback_caps_at_three() -> None:
    valid = {f"n{i}" for i in range(10)}
    raw = json.dumps(
        {
            "feedback": [
                {"note_id": f"n{i}", "suggestion": f"s{i}", "reason": "r"}
                for i in range(10)
            ]
        }
    )
    assert len(_parse_wiki_feedback(raw, valid)) == 3


def test_format_evidence_block_truncates_to_char_budget() -> None:
    citations = [
        {"noteId": f"n{i}", "title": "T", "snippet": "x" * 1000}
        for i in range(10)
    ]
    block = format_evidence_block(citations, max_chars=2000)
    # Should include at least one complete note but stop before all ten.
    assert "n0" in block
    assert "n9" not in block


# ---------------------------------------------------------------------------
# ResearchAgent.run — end-to-end
# ---------------------------------------------------------------------------


def _make_ctx() -> ToolContext:
    async def _emit(_: Any) -> None:
        return None

    return ToolContext(
        workspace_id="ws-1",
        project_id="proj-1",
        page_id=None,
        user_id="user-1",
        run_id="run-research-1",
        scope="project",
        emit=_emit,
    )


def _make_provider(responses: list[str]) -> LLMProvider:
    """Provider that returns each response in order on .generate() and a
    canned embedding on .embed(). Responses are consumed by the agent in
    this order: decompose → answer → wiki_feedback.
    """
    p = MagicMock(spec=LLMProvider)
    p.config = ProviderConfig(provider="gemini", model="gemini-test", embed_model="e")
    p.generate = AsyncMock(side_effect=list(responses))
    p.embed = AsyncMock(return_value=[[0.1] * 8])
    return p


def _make_api(hits_by_query: dict[str, list[dict[str, Any]]] | None = None) -> MagicMock:
    """Fake AgentApiClient. hits_by_query maps query substring → hit list."""
    api = MagicMock()
    hits_by_query = hits_by_query or {}

    async def _search(*, project_id: str, query_text: str, query_embedding: list[float], k: int):
        for key, hits in hits_by_query.items():
            if key in query_text:
                return list(hits)
        return []

    api.hybrid_search_notes = AsyncMock(side_effect=_search)
    return api


@pytest.mark.asyncio
async def test_research_runs_happy_path_with_citations() -> None:
    decompose = json.dumps({"sub_queries": ["What is attention?"]})
    answer = "Attention weights tokens by relevance [[note-1]]."
    feedback = json.dumps(
        {
            "feedback": [
                {
                    "note_id": "note-1",
                    "suggestion": "Mention multi-head variant",
                    "reason": "missing context",
                }
            ]
        }
    )
    provider = _make_provider([decompose, answer, feedback])
    api = _make_api(
        {
            "attention": [
                {
                    "noteId": "note-1",
                    "title": "Transformers",
                    "snippet": "Self-attention lets tokens look at other tokens.",
                    "rrfScore": 0.42,
                }
            ]
        }
    )
    agent = ResearchAgent(provider=provider, api=api)

    events = []
    async for ev in agent.run(
        {
            "query": "How does attention work?",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)

    types = [e.type for e in events]
    assert types[0] == "agent_start"
    assert types[-1] == "agent_end"
    # decompose + answer + feedback = 3 model_end events
    assert types.count("model_end") == 3
    # embed + hybrid_search pair per sub-query
    assert types.count("tool_use") == types.count("tool_result")
    assert types.count("tool_use") >= 2

    api.hybrid_search_notes.assert_awaited_once()
    end = events[-1]
    assert "note-1" in end.output["answer"]
    assert end.output["citations"][0]["note_id"] == "note-1"
    assert end.output["wiki_feedback"][0]["note_id"] == "note-1"


@pytest.mark.asyncio
async def test_research_skips_wiki_feedback_when_no_evidence() -> None:
    decompose = json.dumps({"sub_queries": ["Unknown topic"]})
    answer = "I don't have enough information to answer."
    provider = _make_provider([decompose, answer])
    api = _make_api({})  # every search returns []
    agent = ResearchAgent(provider=provider, api=api)

    events = []
    async for ev in agent.run(
        {
            "query": "Something nobody knows",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)

    # Only 2 model_end events (no wiki_feedback call when citations is empty).
    assert [e.type for e in events].count("model_end") == 2
    assert provider.generate.await_count == 2

    end = events[-1]
    assert end.output["citations"] == []
    assert end.output["wiki_feedback"] == []


@pytest.mark.asyncio
async def test_research_falls_back_to_raw_query_on_bad_decompose() -> None:
    # decompose returns garbage — agent must still proceed using the raw
    # query as a single sub-query.
    provider = _make_provider(["not json at all", "answer", json.dumps({"feedback": []})])
    api = _make_api(
        {
            "test": [
                {
                    "noteId": "n1",
                    "title": "T",
                    "snippet": "s",
                    "rrfScore": 0.1,
                }
            ]
        }
    )
    agent = ResearchAgent(provider=provider, api=api)

    events = []
    async for ev in agent.run(
        {
            "query": "test query",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)

    end = events[-1]
    assert end.output["sub_queries"] == ["test query"]
    assert end.output["answer"] == "answer"


@pytest.mark.asyncio
async def test_research_dedupes_citations_across_sub_queries() -> None:
    decompose = json.dumps({"sub_queries": ["q1 about X", "q2 about Y"]})
    provider = _make_provider([decompose, "ans", json.dumps({"feedback": []})])
    # Both sub-queries return the same note — the agent should keep the
    # strongest RRF and emit a single citation.
    same_hit_weak = {"noteId": "n1", "title": "T", "snippet": "s", "rrfScore": 0.1}
    same_hit_strong = {"noteId": "n1", "title": "T", "snippet": "s", "rrfScore": 0.9}
    api = _make_api({"X": [same_hit_weak], "Y": [same_hit_strong]})
    agent = ResearchAgent(provider=provider, api=api)

    events = []
    async for ev in agent.run(
        {
            "query": "big",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)

    end = events[-1]
    citations = end.output["citations"]
    assert len(citations) == 1
    assert citations[0]["rrf_score"] == 0.9
