"""NarratorAgent unit tests.

All HTTP I/O and S3 operations are mocked so these run fully offline.
"""
from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from worker.agents.narrator.agent import NarratorAgent, NarratorInput, _parse_script
from worker.agents.narrator.prompts import (
    SCRIPT_SYSTEM,
    build_script_prompt,
    _script_to_text,
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
# Helpers
# ---------------------------------------------------------------------------

_SCRIPT_JSON = json.dumps([
    {"speaker": "host", "text": "Welcome! Today we discuss neural networks."},
    {"speaker": "guest", "text": "Thanks for having me. Let me explain."},
    {"speaker": "host", "text": "What makes them so powerful?"},
    {"speaker": "guest", "text": "They learn hierarchical representations."},
])

_NOTE_PAYLOAD = {
    "id": "note-abc",
    "title": "Neural Networks",
    "contentText": "A neural network is a machine learning model.",
    "type": "wiki",
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_provider():
    p = MagicMock()
    p.config.model = "gemini-test"
    p.generate = AsyncMock(return_value=_SCRIPT_JSON)
    p.tts = AsyncMock(return_value=b"fake-audio-bytes")
    return p


@pytest.fixture
def mock_provider_no_tts():
    """Provider whose TTS returns None (Ollama graceful degrade)."""
    p = MagicMock()
    p.config.model = "ollama-test"
    p.generate = AsyncMock(return_value=_SCRIPT_JSON)
    p.tts = AsyncMock(return_value=None)
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
# Test 1: Happy path with TTS available
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_narrator_happy_path_with_tts(mock_provider, ctx):
    """Happy path: note fetched, script generated, audio uploaded, record saved."""
    with (
        patch(
            "worker.agents.narrator.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.narrator.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
        patch(
            "worker.agents.narrator.agent._sync_upload",
        ) as mock_upload,
    ):
        mock_get.return_value = _NOTE_PAYLOAD
        mock_post.return_value = {"id": "audio-file-123"}
        mock_upload.return_value = None

        agent = NarratorAgent(provider=mock_provider)
        events = []
        async for ev in agent.run(
            {
                "note_id": "note-abc",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
                "style": "conversational",
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
        assert end_ev.output["has_audio"] is True
        assert end_ev.output["audio_file_id"] == "audio-file-123"
        assert "r2_key" in end_ev.output
        assert end_ev.output["r2_key"].startswith("audio/ws-1/")
        assert len(end_ev.output["script"]) == 4

        # Verify S3 upload and API post happened.
        mock_upload.assert_called_once()
        mock_post.assert_awaited_once()
        post_call_body = mock_post.call_args[0][1]
        assert post_call_body["noteId"] == "note-abc"
        assert "r2Key" in post_call_body
        assert post_call_body["voices"] == [{"name": "Kore", "style": "conversational"}]


# ---------------------------------------------------------------------------
# Test 2: TTS returns None (Ollama degrade)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_narrator_tts_none_graceful_degrade(mock_provider_no_tts, ctx):
    """When TTS returns None, agent succeeds with has_audio=False; no S3 upload."""
    with (
        patch(
            "worker.agents.narrator.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.narrator.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
        patch(
            "worker.agents.narrator.agent._sync_upload",
        ) as mock_upload,
    ):
        mock_get.return_value = _NOTE_PAYLOAD

        agent = NarratorAgent(provider=mock_provider_no_tts)
        events = []
        async for ev in agent.run(
            {
                "note_id": "note-abc",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        end_ev = next(e for e in events if e.type == "agent_end")
        assert end_ev.output["has_audio"] is False
        assert "audio_file_id" not in end_ev.output
        assert "r2_key" not in end_ev.output
        assert len(end_ev.output["script"]) == 4

        # No S3 upload, no audio-files POST when TTS returned None.
        mock_upload.assert_not_called()
        mock_post.assert_not_awaited()


# ---------------------------------------------------------------------------
# Test 3: Script generation fails (LLM raises)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_narrator_llm_error_raises_agent_error(ctx):
    """When LLM.generate raises, AgentError is emitted and re-raised."""
    provider = MagicMock()
    provider.config.model = "gemini-test"
    provider.generate = AsyncMock(side_effect=RuntimeError("LLM unavailable"))

    with patch(
        "worker.agents.narrator.agent.get_internal",
        new_callable=AsyncMock,
    ) as mock_get:
        mock_get.return_value = _NOTE_PAYLOAD

        agent = NarratorAgent(provider=provider)
        events = []
        with pytest.raises(RuntimeError, match="LLM unavailable"):
            async for ev in agent.run(
                {
                    "note_id": "note-abc",
                    "project_id": "proj-1",
                    "workspace_id": "ws-1",
                    "user_id": "user-1",
                },
                ctx,
            ):
                events.append(ev)

    error_evs = [e for e in events if e.type == "agent_error"]
    assert len(error_evs) == 1
    assert "LLM unavailable" in error_evs[0].message


# ---------------------------------------------------------------------------
# Test 4: Note fetch fails 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_narrator_note_fetch_404_raises_agent_error(mock_provider, ctx):
    """A 404 on note fetch raises AgentError and re-raises the exception."""
    import httpx

    with patch(
        "worker.agents.narrator.agent.get_internal",
        new_callable=AsyncMock,
    ) as mock_get:
        mock_get.side_effect = httpx.HTTPStatusError(
            "not found",
            request=MagicMock(),
            response=MagicMock(status_code=404),
        )

        agent = NarratorAgent(provider=mock_provider)
        events = []
        with pytest.raises(httpx.HTTPStatusError):
            async for ev in agent.run(
                {
                    "note_id": "bad-note-id",
                    "project_id": "proj-1",
                    "workspace_id": "ws-1",
                    "user_id": "user-1",
                },
                ctx,
            ):
                events.append(ev)

    error_evs = [e for e in events if e.type == "agent_error"]
    assert len(error_evs) == 1


# ---------------------------------------------------------------------------
# Test 5: Script parsing — invalid JSON returns empty list
# ---------------------------------------------------------------------------


def test_parse_script_invalid_json_returns_empty():
    result = _parse_script("this is not json at all")
    assert result == []


def test_parse_script_non_list_json_returns_empty():
    result = _parse_script('{"speaker": "host", "text": "hi"}')
    assert result == []


def test_parse_script_valid_returns_turns():
    result = _parse_script(_SCRIPT_JSON)
    assert len(result) == 4
    assert result[0]["speaker"] == "host"
    assert result[1]["speaker"] == "guest"
    assert "neural networks" in result[0]["text"].lower()


def test_parse_script_skips_malformed_turns():
    raw = json.dumps([
        {"speaker": "host", "text": "Good turn"},
        {"bad": "turn"},
        {"speaker": "guest", "text": "Another good turn"},
    ])
    result = _parse_script(raw)
    assert len(result) == 2


def test_parse_script_empty_string_returns_empty():
    assert _parse_script("") == []


# ---------------------------------------------------------------------------
# Test 6: CustomEvent includes correct stats
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_narrator_custom_event_stats(mock_provider, ctx):
    """narrator.completed CustomEvent carries has_audio and script_turns."""
    with (
        patch(
            "worker.agents.narrator.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.narrator.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
        patch(
            "worker.agents.narrator.agent._sync_upload",
        ),
    ):
        mock_get.return_value = _NOTE_PAYLOAD
        mock_post.return_value = {"id": "af-xyz"}

        agent = NarratorAgent(provider=mock_provider)
        events = []
        async for ev in agent.run(
            {
                "note_id": "note-abc",
                "project_id": "proj-1",
                "workspace_id": "ws-1",
                "user_id": "user-1",
            },
            ctx,
        ):
            events.append(ev)

        custom_ev = next(
            (e for e in events if e.type == "custom" and e.label == "narrator.completed"),
            None,
        )
        assert custom_ev is not None
        assert custom_ev.payload["has_audio"] is True
        assert custom_ev.payload["script_turns"] == 4


# ---------------------------------------------------------------------------
# Test 7: ModelEnd event fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_narrator_model_end_event_fields(mock_provider, ctx):
    """ModelEnd event carries provider model name and zero-cost placeholder values."""
    with (
        patch(
            "worker.agents.narrator.agent.get_internal",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "worker.agents.narrator.agent.post_internal",
            new_callable=AsyncMock,
        ) as mock_post,
        patch(
            "worker.agents.narrator.agent._sync_upload",
        ),
    ):
        mock_get.return_value = _NOTE_PAYLOAD
        mock_post.return_value = {"id": "af-yz"}

        agent = NarratorAgent(provider=mock_provider)
        events = []
        async for ev in agent.run(
            {
                "note_id": "note-abc",
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


def test_build_script_prompt_contains_title_and_content():
    result = build_script_prompt("Quantum Computing", "Qubits represent superpositions.", "conversational")
    assert "Quantum Computing" in result
    assert "Qubits" in result
    assert "conversational" in result


def test_build_script_prompt_clips_long_content():
    long_content = "x" * 5000
    result = build_script_prompt("Title", long_content, "educational")
    # The clipped content should not exceed 2000 chars + overhead
    assert len(result) < 2500


def test_build_script_prompt_handles_empty_content():
    result = build_script_prompt("Title", "", "debate")
    assert "(no content)" in result


def test_script_to_text_formats_speakers():
    script = [
        {"speaker": "host", "text": "Hello there."},
        {"speaker": "guest", "text": "Hi!"},
    ]
    text = _script_to_text(script)
    assert "Host: Hello there." in text
    assert "Guest: Hi!" in text


def test_script_system_prompt_contains_style_placeholder():
    formatted = SCRIPT_SYSTEM.format(style="educational")
    assert "educational" in formatted
    assert "host" in formatted.lower()
    assert "guest" in formatted.lower()
