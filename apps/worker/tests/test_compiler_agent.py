"""Tests for :mod:`worker.agents.compiler.agent`.

The agent has three natural test surfaces:

1. Pure helpers (``_parse_extraction``, ``_pick_merge_target``) — exercised
   directly with no mocks.
2. ``CompilerAgent.run`` with fake provider + fake API — verifies the event
   sequence and downstream API calls.
3. Empty-note short-circuit — critical path when OCR is disabled.
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from llm.base import EmbedInput, LLMProvider, ProviderConfig

from runtime.tools import ToolContext

from worker.agents.compiler.agent import (
    MERGE_SIMILARITY_THRESHOLD,
    CompilerAgent,
    _parse_extraction,
    _pick_merge_target,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_parse_extraction_accepts_plain_json() -> None:
    raw = json.dumps({"concepts": [{"name": "배치 정규화", "description": "..."}]})
    assert _parse_extraction(raw) == [
        {"name": "배치 정규화", "description": "..."}
    ]


def test_parse_extraction_strips_markdown_fence() -> None:
    raw = '```json\n{"concepts": [{"name": "Foo", "description": "bar"}]}\n```'
    assert _parse_extraction(raw) == [{"name": "Foo", "description": "bar"}]


def test_parse_extraction_returns_empty_on_garbage() -> None:
    assert _parse_extraction("not json at all") == []
    assert _parse_extraction("") == []
    assert _parse_extraction("{}") == []


def test_parse_extraction_skips_items_without_name() -> None:
    raw = json.dumps(
        {
            "concepts": [
                {"description": "no name"},
                {"name": "", "description": "empty name"},
                {"name": "Keep", "description": "real"},
            ]
        }
    )
    assert _parse_extraction(raw) == [{"name": "Keep", "description": "real"}]


def test_parse_extraction_truncates_long_fields() -> None:
    long_name = "a" * 500
    raw = json.dumps({"concepts": [{"name": long_name, "description": "b" * 5000}]})
    out = _parse_extraction(raw)
    assert len(out[0]["name"]) == 200
    assert len(out[0]["description"]) == 2000


def test_pick_merge_target_returns_none_on_exact_name_match() -> None:
    # Server-side (project_id, name) dedupe handles this case — client
    # should NOT pre-emptively pick a merge target.
    existing = [{"id": "c1", "name": "Foo", "similarity": 0.99}]
    assert _pick_merge_target("foo", existing) is None


def test_pick_merge_target_picks_high_similarity_different_name() -> None:
    existing = [
        {"id": "c1", "name": "배치 정규화", "similarity": 0.95},
        {"id": "c2", "name": "batch norm", "similarity": 0.80},
    ]
    target = _pick_merge_target("Batch Normalization", existing)
    assert target is not None
    assert target["id"] == "c1"


def test_pick_merge_target_none_below_threshold() -> None:
    below = MERGE_SIMILARITY_THRESHOLD - 0.01
    existing = [{"id": "c1", "name": "other", "similarity": below}]
    assert _pick_merge_target("query", existing) is None


# ---------------------------------------------------------------------------
# CompilerAgent.run — end-to-end with mocked collaborators
# ---------------------------------------------------------------------------


def _make_ctx() -> ToolContext:
    async def _emit(_: Any) -> None:
        return None

    return ToolContext(
        workspace_id="ws-1",
        project_id="proj-1",
        page_id="note-1",
        user_id="user-1",
        run_id="run-1",
        scope="project",
        emit=_emit,
    )


def _make_provider(response: str, embedding: list[float] | None = None) -> LLMProvider:
    """A minimal LLMProvider stub that returns a canned extraction and a
    deterministic embedding. Uses MagicMock under the hood so assertions
    remain available on call_args.
    """
    p = MagicMock(spec=LLMProvider)
    p.config = ProviderConfig(provider="gemini", model="gemini-3-test", embed_model="e")
    p.generate = AsyncMock(return_value=response)
    emb = embedding if embedding is not None else [0.1] * 16
    p.embed = AsyncMock(return_value=[emb])
    return p


def _make_api(*, existing: list[dict[str, Any]] | None = None) -> MagicMock:
    api = MagicMock()
    api.get_note = AsyncMock(
        return_value={
            "id": "note-1",
            "projectId": "proj-1",
            "workspaceId": "ws-1",
            "title": "Deep Learning Basics",
            "contentText": "Batch normalization is a technique used in training neural networks.",
            "sourceType": "pdf",
            "sourceUrl": None,
            "type": "source",
        }
    )
    api.search_concepts = AsyncMock(return_value=list(existing or []))
    api.upsert_concept = AsyncMock(return_value=("concept-abc", True))
    api.link_concept_note = AsyncMock(return_value=None)
    api.log_wiki = AsyncMock(return_value="log-1")
    return api


@pytest.mark.asyncio
async def test_compiler_runs_happy_path() -> None:
    extraction = json.dumps(
        {
            "concepts": [
                {
                    "name": "Batch Normalization",
                    "description": "Per-layer normalisation technique.",
                }
            ]
        }
    )
    provider = _make_provider(extraction)
    api = _make_api()
    agent = CompilerAgent(provider=provider, api=api)

    events = []
    async for ev in agent.run(
        {
            "note_id": "note-1",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)

    # Event stream contract: first is agent_start, last is agent_end, at
    # least one model_end and one tool_use/tool_result pair in between.
    types = [e.type for e in events]
    assert types[0] == "agent_start"
    assert types[-1] == "agent_end"
    assert "model_end" in types
    assert types.count("tool_use") == types.count("tool_result")
    assert types.count("tool_use") >= 3  # fetch + search + upsert + link

    # The agent should have invoked the API once per step.
    api.get_note.assert_awaited_once_with("note-1")
    api.search_concepts.assert_awaited()
    api.upsert_concept.assert_awaited_once()
    api.link_concept_note.assert_awaited_once()
    api.log_wiki.assert_awaited_once()

    end = events[-1]
    assert end.output["note_id"] == "note-1"
    assert end.output["extracted_count"] == 1
    assert end.output["created_count"] == 1
    assert end.output["merged_count"] == 0
    assert end.output["linked_count"] == 1
    assert end.output["concept_ids"] == ["concept-abc"]


@pytest.mark.asyncio
async def test_compiler_short_circuits_on_empty_note() -> None:
    provider = _make_provider("")
    api = _make_api()
    api.get_note = AsyncMock(
        return_value={
            "id": "note-1",
            "projectId": "proj-1",
            "workspaceId": "ws-1",
            "title": "Blank scan",
            "contentText": "   ",
            "sourceType": "pdf",
            "sourceUrl": None,
            "type": "source",
        }
    )
    agent = CompilerAgent(provider=provider, api=api)

    events = []
    async for ev in agent.run(
        {
            "note_id": "note-1",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)

    types = [e.type for e in events]
    assert "agent_start" in types
    assert "custom" in types  # empty_note marker
    assert types[-1] == "agent_end"
    # LLM must NOT be called for an empty note — saves cost on bad OCR scans.
    provider.generate.assert_not_called()
    api.upsert_concept.assert_not_called()


@pytest.mark.asyncio
async def test_compiler_merges_on_high_similarity() -> None:
    # Existing concept differs in name but is very close in embedding — the
    # agent should merge into the existing id rather than creating fresh.
    extraction = json.dumps(
        {
            "concepts": [
                {"name": "Batch Normalization", "description": "..."}
            ]
        }
    )
    provider = _make_provider(extraction)
    api = _make_api(
        existing=[
            {"id": "c-existing", "name": "배치 정규화", "similarity": 0.95},
        ]
    )
    api.upsert_concept = AsyncMock(return_value=("c-existing", False))
    agent = CompilerAgent(provider=provider, api=api)

    events = []
    async for ev in agent.run(
        {
            "note_id": "note-1",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)

    # upsert_concept was called with the *existing* name (merge target)
    args, kwargs = api.upsert_concept.call_args
    assert kwargs["name"] == "배치 정규화"

    # Wiki log action should reflect the merge/link path.
    log_args, log_kwargs = api.log_wiki.call_args
    assert log_kwargs["action"] == "link"

    end = events[-1]
    assert end.output["created_count"] == 0
    assert end.output["merged_count"] == 1


@pytest.mark.asyncio
async def test_compiler_propagates_unexpected_errors_with_agent_error_event() -> None:
    extraction = json.dumps(
        {"concepts": [{"name": "x", "description": "y"}]}
    )
    provider = _make_provider(extraction)
    api = _make_api()
    api.upsert_concept = AsyncMock(side_effect=RuntimeError("db down"))
    agent = CompilerAgent(provider=provider, api=api)

    events = []
    with pytest.raises(RuntimeError):
        async for ev in agent.run(
            {
                "note_id": "note-1",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            _make_ctx(),
        ):
            events.append(ev)

    assert events[-1].type == "agent_error"
    assert "db down" in events[-1].message


# ---------------------------------------------------------------------------
# Plan 3b — batch embedding integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compiler_takes_batch_path_when_flag_on_and_enough_candidates(
    monkeypatch,
) -> None:
    """With BATCH_EMBED_COMPILER_ENABLED=true and a candidate count at
    or above BATCH_EMBED_MIN_ITEMS, the injected batch_submit callback
    should be awaited once and provider.embed should never fire.
    """
    monkeypatch.setenv("BATCH_EMBED_COMPILER_ENABLED", "true")
    monkeypatch.setenv("BATCH_EMBED_MIN_ITEMS", "3")

    # 3 concepts extracted — exactly at the threshold.
    extraction = json.dumps(
        {
            "concepts": [
                {"name": f"concept-{i}", "description": f"desc-{i}"}
                for i in range(3)
            ]
        }
    )
    provider = _make_provider(extraction)
    # Gemini exposes supports_batch_embed=True; the mock doesn't reflect
    # that by default. Set it explicitly so embed_many takes the batch
    # branch.
    provider.supports_batch_embed = True

    api = _make_api()

    batch_calls: list[dict[str, Any]] = []

    async def batch_submit(inputs, *, workspace_id):
        batch_calls.append({"workspace_id": workspace_id, "n": len(inputs)})
        return [[0.2] * 16 for _ in inputs]

    agent = CompilerAgent(provider=provider, api=api, batch_submit=batch_submit)

    events = []
    async for ev in agent.run(
        {
            "note_id": "note-1",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        events.append(ev)

    assert len(batch_calls) == 1
    assert batch_calls[0]["n"] == 3
    assert batch_calls[0]["workspace_id"] == "ws-1"
    # Sync path must not be touched when the batch path succeeded.
    provider.embed.assert_not_awaited()


@pytest.mark.asyncio
async def test_compiler_stays_on_sync_path_when_flag_off(monkeypatch) -> None:
    """Default configuration — flag unset → sync provider.embed called once
    per extracted concept (via embed_many's sync aggregation).
    """
    monkeypatch.delenv("BATCH_EMBED_COMPILER_ENABLED", raising=False)

    extraction = json.dumps(
        {
            "concepts": [
                {"name": f"concept-{i}", "description": f"desc-{i}"}
                for i in range(3)
            ]
        }
    )
    provider = _make_provider(extraction)
    # Return 3 vectors aligned with the 3 concepts — embed_many's sync
    # path calls provider.embed once with the whole list.
    provider.embed = AsyncMock(return_value=[[0.1] * 16 for _ in range(3)])

    batch_submit = AsyncMock()
    api = _make_api()
    agent = CompilerAgent(provider=provider, api=api, batch_submit=batch_submit)

    async for _ in agent.run(
        {
            "note_id": "note-1",
            "project_id": "proj-1",
            "workspace_id": "ws-1",
            "user_id": "user-1",
        },
        _make_ctx(),
    ):
        pass

    batch_submit.assert_not_awaited()
    # Sync path: provider.embed called once (embed_many sends the whole
    # list) even though there are 3 candidates.
    provider.embed.assert_awaited_once()
