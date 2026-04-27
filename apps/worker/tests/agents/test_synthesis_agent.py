"""SynthesisAgent unit tests.

All HTTP I/O is mocked out via AsyncMock so these run fully offline.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from worker.agents.synthesis.agent import SynthesisAgent, SynthesisInput, SynthesisOutput
from worker.agents.synthesis.prompts import SYNTHESIS_SYSTEM, build_synthesis_prompt
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
    p.generate = AsyncMock(
        return_value=(
            "This is a synthesized essay about quantum computing and machine learning. "
            "It integrates key concepts from multiple sources and presents a coherent narrative "
            "about the intersection of these two transformative technologies."
        )
    )
    return p


@pytest.fixture
def mock_api():
    api = MagicMock()
    api.get_note = AsyncMock(
        return_value={
            "id": "note-1",
            "title": "Quantum Computing",
            "contentText": "Quantum computing uses qubits to perform computations.",
        }
    )
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
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_synthesis_happy_path(mock_provider, mock_api, ctx):
    """Happy path: one note fetched, LLM called, note created, all events emitted."""
    with patch(
        "worker.agents.synthesis.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "new-note-id"}

        agent = SynthesisAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "note_ids": ["note-1"],
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
                "title": "Test Synthesis",
                "style": "",
            },
            ctx,
        ):
            events.append(ev)

        types = [ev.type for ev in events]
        assert "agent_start" in types
        assert "tool_use" in types
        assert "tool_result" in types
        assert "model_end" in types
        assert "custom" in types
        assert "agent_end" in types

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["note_id"] == "new-note-id"
        assert end_ev.output["word_count"] > 0
        assert end_ev.output["source_note_ids"] == ["note-1"]

        mock_api.get_note.assert_awaited_once_with("note-1")
        mock_provider.generate.assert_awaited_once()
        mock_post.assert_awaited_once()


@pytest.mark.asyncio
async def test_synthesis_multiple_notes(mock_provider, ctx):
    """Multiple note IDs are fetched sequentially; all appear in source_note_ids."""
    api = MagicMock()
    api.get_note = AsyncMock(
        side_effect=[
            {"id": "n1", "title": "Note A", "contentText": "Content A"},
            {"id": "n2", "title": "Note B", "contentText": "Content B"},
        ]
    )

    with patch(
        "worker.agents.synthesis.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "synthesized-note"}

        agent = SynthesisAgent(provider=mock_provider, api=api)
        events = []
        async for ev in agent.run(
            {
                "note_ids": ["n1", "n2"],
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
                "title": "Multi-Note Synthesis",
                "style": "academic",
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["source_note_ids"] == ["n1", "n2"]
        # Two fetch ToolUse events + two ToolResult events + one save ToolUse + one save ToolResult
        tool_uses = [e for e in events if e.type == "tool_use"]
        assert len(tool_uses) == 3  # 2 fetch + 1 save


@pytest.mark.asyncio
async def test_synthesis_emits_custom_event(mock_provider, mock_api, ctx):
    """synthesis.completed CustomEvent is emitted before AgentEnd."""
    with patch(
        "worker.agents.synthesis.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "note-xyz"}

        agent = SynthesisAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "note_ids": ["note-1"],
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        custom_ev = next(
            (e for e in events if e.type == "custom" and e.label == "synthesis.completed"),
            None,
        )
        assert custom_ev is not None
        assert custom_ev.payload["note_id"] == "note-xyz"
        assert custom_ev.payload["word_count"] > 0


@pytest.mark.asyncio
async def test_synthesis_note_fetch_failure_skips_note(mock_provider, ctx):
    """A 404 on one note emits a failed ToolResult but does not abort the run
    — the remaining notes are used and synthesis continues."""
    import httpx

    api = MagicMock()
    api.get_note = AsyncMock(
        side_effect=[
            httpx.HTTPStatusError(
                "not found",
                request=MagicMock(),
                response=MagicMock(status_code=404),
            ),
            {"id": "n2", "title": "Good Note", "contentText": "This note has content."},
        ]
    )

    with patch(
        "worker.agents.synthesis.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "result-note"}

        agent = SynthesisAgent(provider=mock_provider, api=api)
        events = []
        async for ev in agent.run(
            {
                "note_ids": ["bad-note", "n2"],
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        # Should succeed overall (n2 had content)
        end_ev = next((e for e in events if e.type == "agent_end"), None)
        assert end_ev is not None

        # The failed fetch should emit a ToolResult with ok=False
        failed_results = [
            e for e in events if e.type == "tool_result" and not e.ok
        ]
        assert len(failed_results) == 1


@pytest.mark.asyncio
async def test_synthesis_all_notes_empty_raises(mock_provider, ctx):
    """When all fetched notes have empty content, AgentError is emitted and re-raised."""
    api = MagicMock()
    api.get_note = AsyncMock(
        return_value={"id": "n1", "title": "Empty", "contentText": ""}
    )

    agent = SynthesisAgent(provider=mock_provider, api=api)
    events = []
    with pytest.raises(ValueError, match="No usable note content"):
        async for ev in agent.run(
            {
                "note_ids": ["n1"],
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

    error_evs = [e for e in events if e.type == "agent_error"]
    assert len(error_evs) == 1
    assert "No usable note content" in error_evs[0].message


@pytest.mark.asyncio
async def test_synthesis_model_end_event_fields(mock_provider, mock_api, ctx):
    """ModelEnd event carries provider model name and zero-cost placeholder values."""
    with patch(
        "worker.agents.synthesis.agent.post_internal",
        new_callable=AsyncMock,
    ) as mock_post:
        mock_post.return_value = {"id": "n-out"}

        agent = SynthesisAgent(provider=mock_provider, api=mock_api)
        events = []
        async for ev in agent.run(
            {
                "note_ids": ["note-1"],
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        model_ev = next(e for e in events if e.type == "model_end")
        assert model_ev.model_id == "gemini-test"
        assert model_ev.prompt_tokens == 0
        assert model_ev.completion_tokens == 0
        assert model_ev.finish_reason == "stop"


# ---------------------------------------------------------------------------
# Prompt helper tests
# ---------------------------------------------------------------------------


def test_build_synthesis_prompt_includes_all_contexts():
    contexts = [
        {"title": "A", "text": "Text A"},
        {"title": "B", "text": "Text B"},
    ]
    result = build_synthesis_prompt(contexts, "My Title", "")
    assert "Title: My Title" in result
    assert "# A" in result
    assert "Text A" in result
    assert "# B" in result
    assert "Text B" in result


def test_build_synthesis_prompt_includes_style_when_provided():
    contexts = [{"title": "X", "text": "Some content"}]
    result = build_synthesis_prompt(contexts, "Title", "academic prose")
    assert "Writing style: academic prose" in result


def test_build_synthesis_prompt_skips_empty_text():
    contexts = [
        {"title": "Empty", "text": ""},
        {"title": "Full", "text": "Real content here"},
    ]
    result = build_synthesis_prompt(contexts, "T", "")
    assert "# Empty" not in result
    assert "# Full" in result
