"""StalenessAgent unit tests.

All HTTP I/O is mocked out via AsyncMock so these run fully offline.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from runtime.tools import ToolContext
from worker.agents.temporal_agent.agent import (
    StalenessAgent,
    _days_since,
    _parse_staleness_response,
)
from worker.agents.temporal_agent.prompts import (
    STALENESS_SYSTEM,
    build_staleness_prompt,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_note(note_id: str, title: str, days_old: int = 120) -> dict:
    updated_at = (datetime.now(UTC) - timedelta(days=days_old)).isoformat()
    return {
        "id": note_id,
        "title": title,
        "contentText": f"This is the content of {title}. Current version is 1.0.",
        "content": [
            {
                "type": "p",
                "children": [
                    {
                        "text": (
                            f"This is the content of {title}. Current version is 1.0."
                        )
                    }
                ],
            }
        ],
        "updatedAt": updated_at,
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_provider():
    p = MagicMock()
    p.config.model = "gemini-test"
    # Default: score 0.8 (above typical threshold 0.5).
    p.generate = AsyncMock(
        return_value=json.dumps({"score": 0.8, "reason": "mentions old version numbers"})
    )
    return p


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
# Test 1: Happy path — 2 stale notes found, both above threshold, 2 alerts created
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_staleness_happy_path(mock_provider, ctx):
    """2 stale notes found, both score 0.8 (above default 0.5 threshold) → 2 alerts."""
    notes = [_make_note("n1", "API Docs v1"), _make_note("n2", "Setup Guide")]

    with (
        patch(
            "worker.agents.temporal_agent.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.temporal_agent.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
    ):
        mock_get.return_value = {"notes": notes}
        mock_post.return_value = {"id": "alert-1"}

        agent = StalenessAgent(provider=mock_provider)
        events = []
        async for ev in agent.run(
            {
                "workspace_id": "ws-1",
                "project_id": "proj-1",
                "user_id": "user-1",
                "stale_days": 90,
                "max_notes": 20,
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["candidates"] == 2
        assert end_ev.output["notes_checked"] == 2
        assert end_ev.output["alerts_created"] == 2

        # Verify stale-alerts POST calls (score + notification = 2 notes × 2 = 4 calls,
        # but notifications may fail silently; at minimum 2 alert calls).
        alert_calls = [
            c for c in mock_post.call_args_list
            if "/stale-alerts" in str(c)
        ]
        assert len(alert_calls) == 2

        # Each alert call should carry the correct noteId.
        posted_note_ids = {c.args[1]["noteId"] for c in alert_calls}
        assert posted_note_ids == {"n1", "n2"}


@pytest.mark.asyncio
async def test_staleness_creates_reviewable_note_update_action(mock_provider, ctx):
    notes = [_make_note("n1", "API Docs v1")]

    with (
        patch(
            "worker.agents.temporal_agent.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.temporal_agent.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
    ):
        mock_get.return_value = {"notes": notes}
        mock_post.return_value = {
            "action": {"id": "action-1", "status": "draft"},
            "idempotent": False,
        }

        agent = StalenessAgent(provider=mock_provider)
        events = []
        async for ev in agent.run(
            {
                "workspace_id": "ws-1",
                "project_id": "proj-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

    action_calls = [
        c
        for c in mock_post.call_args_list
        if "/agent-actions" in c.args[0]
    ]
    assert len(action_calls) == 1
    payload = action_calls[0].args[1]
    assert payload["userId"] == "user-1"
    action = payload["action"]
    assert action["kind"] == "note.update"
    assert action["risk"] == "write"
    assert action["approvalMode"] == "require"
    assert action["input"]["noteId"] == "n1"
    draft = action["input"]["draft"]["content"]
    assert draft[0]["children"][0]["text"].startswith("This is the content")
    assert "Staleness review" in draft[-1]["children"][0]["text"]

    end_ev = next(e for e in events if e.type == "agent_end")
    assert end_ev.output["review_actions_created"] == 1
    custom_ev = next(
        e
        for e in events
        if e.type == "custom" and e.label == "staleness.completed"
    )
    assert custom_ev.payload["review_actions_created"] == 1


# ---------------------------------------------------------------------------
# Test 2: No stale notes returned → 0 alerts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_staleness_no_stale_notes(mock_provider, ctx):
    """Internal API returns empty list → 0 notes checked, 0 alerts."""
    with (
        patch(
            "worker.agents.temporal_agent.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.temporal_agent.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
    ):
        mock_get.return_value = {"notes": []}

        agent = StalenessAgent(provider=mock_provider)
        events = []
        async for ev in agent.run(
            {
                "workspace_id": "ws-1",
                "project_id": "proj-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["candidates"] == 0
        assert end_ev.output["notes_checked"] == 0
        assert end_ev.output["alerts_created"] == 0

        mock_post.assert_not_called()
        # LLM should not have been called either.
        mock_provider.generate.assert_not_called()


# ---------------------------------------------------------------------------
# Test 3: All notes below score threshold → 0 alerts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_staleness_all_below_threshold(ctx):
    """Notes found but LLM scores all below threshold → 0 alerts created."""
    provider = MagicMock()
    provider.config.model = "gemini-test"
    # Score 0.2 — below default threshold of 0.5.
    provider.generate = AsyncMock(
        return_value=json.dumps({"score": 0.2, "reason": "content looks current"})
    )

    notes = [_make_note("n1", "Fresh Note"), _make_note("n2", "Up-to-date Docs")]

    with (
        patch(
            "worker.agents.temporal_agent.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.temporal_agent.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
    ):
        mock_get.return_value = {"notes": notes}

        agent = StalenessAgent(provider=provider)
        events = []
        async for ev in agent.run(
            {
                "workspace_id": "ws-1",
                "project_id": "proj-1",
                "user_id": "user-1",
                "score_threshold": 0.5,
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["candidates"] == 2
        assert end_ev.output["notes_checked"] == 2
        assert end_ev.output["alerts_created"] == 0

        mock_post.assert_not_called()


# ---------------------------------------------------------------------------
# Test 4: LLM returns invalid JSON → note skipped gracefully, no crash
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_staleness_llm_parse_failure(ctx):
    """LLM returns invalid JSON → note is skipped, no alert created, no crash."""
    provider = MagicMock()
    provider.config.model = "gemini-test"
    provider.generate = AsyncMock(return_value="this is not valid json at all")

    notes = [_make_note("n1", "Broken Response Note")]

    with (
        patch(
            "worker.agents.temporal_agent.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.temporal_agent.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
    ):
        mock_get.return_value = {"notes": notes}

        agent = StalenessAgent(provider=provider)
        events = []
        async for ev in agent.run(
            {
                "workspace_id": "ws-1",
                "project_id": "proj-1",
                "user_id": "user-1",
                "score_threshold": 0.5,
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        # notes_checked is counted on successful parse; parse failure score=0.0
        # is below threshold so no alert.
        assert end_ev.output["candidates"] == 1
        assert end_ev.output["alerts_created"] == 0

        mock_post.assert_not_called()


# ---------------------------------------------------------------------------
# Test 5: AgentStart and AgentEnd events are emitted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_staleness_emits_agent_start_and_end(mock_provider, ctx):
    """Run always emits AgentStart first and AgentEnd last (on success)."""
    with (
        patch(
            "worker.agents.temporal_agent.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.temporal_agent.agent.post_internal",
            new_callable=AsyncMock,
        ),
    ):
        mock_get.return_value = {"notes": []}

        agent = StalenessAgent(provider=mock_provider)
        events = []
        async for ev in agent.run(
            {"workspace_id": "ws-1", "project_id": "proj-1", "user_id": "user-1"},
            ctx,
        ):
            events.append(ev)

    assert len(events) >= 2
    assert events[0].type == "agent_start"
    assert events[-1].type == "agent_end"


# ---------------------------------------------------------------------------
# Test 6: CustomEvent includes stats payload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_staleness_custom_event_includes_stats(mock_provider, ctx):
    """staleness.completed CustomEvent is emitted with correct stat keys."""
    notes_list = [_make_note("n1", "Old Guide")]

    with (
        patch(
            "worker.agents.temporal_agent.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.temporal_agent.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
    ):
        mock_get.return_value = {"notes": notes_list}
        mock_post.return_value = {"id": "alert-x"}

        agent = StalenessAgent(provider=mock_provider)
        events = []
        async for ev in agent.run(
            {
                "workspace_id": "ws-1",
                "project_id": "proj-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

    custom_ev = next(
        (
            e
            for e in events
            if e.type == "custom" and e.label == "staleness.completed"
        ),
        None,
    )
    assert custom_ev is not None
    assert "candidates" in custom_ev.payload
    assert "notes_checked" in custom_ev.payload
    assert "alerts_created" in custom_ev.payload
    assert custom_ev.payload["candidates"] == 1


# ---------------------------------------------------------------------------
# Helper unit tests
# ---------------------------------------------------------------------------


def test_parse_staleness_response_valid():
    raw = json.dumps({"score": 0.75, "reason": "version numbers are old"})
    result = _parse_staleness_response(raw)
    assert result["score"] == 0.75
    assert result["reason"] == "version numbers are old"


def test_parse_staleness_response_with_markdown_fence():
    raw = '```json\n{"score": 0.9, "reason": "outdated"}\n```'
    result = _parse_staleness_response(raw)
    assert result["score"] == 0.9


def test_parse_staleness_response_invalid_json():
    result = _parse_staleness_response("not json at all")
    assert result["score"] == 0.0
    assert result["reason"] == "parse_error"


def test_parse_staleness_response_clamps_score():
    raw = json.dumps({"score": 1.5, "reason": "out of range"})
    result = _parse_staleness_response(raw)
    assert result["score"] == 1.0


def test_parse_staleness_response_empty():
    result = _parse_staleness_response("")
    assert result["score"] == 0.0


def test_days_since_recent():
    recent = (datetime.now(UTC) - timedelta(days=5)).isoformat()
    assert _days_since(recent) == 5


def test_days_since_z_suffix():
    dt_str = (datetime.now(UTC) - timedelta(days=100)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    assert _days_since(dt_str) >= 99


def test_days_since_none():
    assert _days_since(None) == 0


def test_build_staleness_prompt_contains_title_and_days():
    prompt = build_staleness_prompt("My Guide", "Some content here.", 120)
    assert "My Guide" in prompt
    assert "120" in prompt
    assert "Some content here." in prompt


def test_staleness_system_prompt_not_empty():
    assert len(STALENESS_SYSTEM) > 50
    assert "score" in STALENESS_SYSTEM.lower()
