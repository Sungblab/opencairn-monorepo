"""Plan 11B Phase A - DocEditorAgent.run yields the expected event sequence."""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest

from runtime.events import AgentEnd, AgentStart, ModelEnd
from runtime.tools import ToolContext
from worker.agents.doc_editor.agent import DocEditorAgent, DocEditorOutput


def _ctx() -> ToolContext:
    return ToolContext(
        workspace_id="ws-test",
        project_id="proj-1",
        page_id=None,
        user_id="user-1",
        run_id="run-test",
        scope="page",
        emit=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_improve_happy_path_yields_diff_payload():
    raw = json.dumps(
        {
            "hunks": [
                {
                    "blockId": "b1",
                    "originalRange": {"start": 0, "end": 5},
                    "originalText": "hello",
                    "replacementText": "Hello there",
                }
            ],
            "summary": "1 word adjusted",
        }
    )
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value=raw)
    provider.config.model = "gemini-2.5-flash"

    agent = DocEditorAgent(provider=provider)
    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "improve",
            "selection": {
                "blockId": "b1",
                "start": 0,
                "end": 5,
                "text": "hello",
            },
            "documentContextSnippet": "around the selection",
            "note_id": "note-1",
            "user_id": "user-1",
        },
        _ctx(),
    ):
        events.append(ev)

    assert isinstance(events[0], AgentStart)
    assert isinstance(events[-1], AgentEnd)
    assert any(isinstance(e, ModelEnd) for e in events)
    out = DocEditorOutput(**events[-1].output)
    assert out.command == "improve"
    assert out.payload["hunks"][0]["replacementText"] == "Hello there"
    assert out.tokens_in >= 0
    assert out.tokens_out >= 0
    assert out.tools_used == 0


@pytest.mark.asyncio
async def test_unknown_command_raises_keyerror_path():
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value="{}")
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)
    with pytest.raises(KeyError):
        async for _ in agent.run(
            {
                "command": "outline",
                "selection": {
                    "blockId": "b1",
                    "start": 0,
                    "end": 4,
                    "text": "test",
                },
                "documentContextSnippet": "",
                "note_id": "n",
                "user_id": "u",
            },
            _ctx(),
        ):
            pass


@pytest.mark.asyncio
async def test_oversized_selection_rejected():
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value="{}")
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)
    big = "x" * 5000
    with pytest.raises(ValueError, match="selection too long"):
        async for _ in agent.run(
            {
                "command": "improve",
                "selection": {
                    "blockId": "b1",
                    "start": 0,
                    "end": 5000,
                    "text": big,
                },
                "documentContextSnippet": "",
                "note_id": "n",
                "user_id": "u",
            },
            _ctx(),
        ):
            pass


@pytest.mark.asyncio
async def test_translate_passes_language_to_user_message():
    raw = json.dumps(
        {
            "hunks": [
                {
                    "blockId": "b1",
                    "originalRange": {"start": 0, "end": 5},
                    "originalText": "hello",
                    "replacementText": "안녕하세요",
                }
            ],
            "summary": "Translated to ko",
        }
    )
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value=raw)
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)
    async for _ in agent.run(
        {
            "command": "translate",
            "selection": {"blockId": "b1", "start": 0, "end": 5, "text": "hello"},
            "language": "ko",
            "documentContextSnippet": "",
            "note_id": "n",
            "user_id": "u",
        },
        _ctx(),
    ):
        pass
    args, _ = provider.generate.call_args
    user_msg = args[0][1]["content"]
    assert "Target language: ko" in user_msg


@pytest.mark.asyncio
async def test_phase_a_command_uses_single_shot_generate():
    raw = json.dumps(
        {
            "hunks": [
                {
                    "blockId": "b1",
                    "originalRange": {"start": 0, "end": 5},
                    "originalText": "hello",
                    "replacementText": "Hello",
                }
            ],
            "summary": "capitalized",
        }
    )
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value=raw)
    provider.generate_with_tools = AsyncMock()
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)

    async for _ in agent.run(
        {
            "command": "improve",
            "selection": {"blockId": "b1", "start": 0, "end": 5, "text": "hello"},
            "documentContextSnippet": "",
            "note_id": "n",
            "project_id": "p",
            "user_id": "u",
        },
        _ctx(),
    ):
        pass

    provider.generate.assert_awaited_once()
    provider.generate_with_tools.assert_not_called()


@pytest.mark.asyncio
async def test_phase_a_command_records_provider_usage():
    raw = json.dumps(
        {
            "hunks": [
                {
                    "blockId": "b1",
                    "originalRange": {"start": 0, "end": 5},
                    "originalText": "hello",
                    "replacementText": "Hello",
                }
            ],
            "summary": "capitalized",
        }
    )
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value=raw)
    provider.generate_with_tools = AsyncMock()
    provider.config.model = "gemini-3-flash-preview"
    provider.last_usage = type(
        "Usage",
        (),
        {
            "input_tokens": 112,
            "output_tokens": 28,
            "cached_input_tokens": 25,
            "thought_tokens": 8,
            "tool_use_prompt_tokens": 12,
            "total_tokens": 140,
        },
    )
    agent = DocEditorAgent(provider=provider)

    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "improve",
            "selection": {"blockId": "b1", "start": 0, "end": 5, "text": "hello"},
            "documentContextSnippet": "",
            "note_id": "n",
            "project_id": "p",
            "user_id": "u",
        },
        _ctx(),
    ):
        events.append(ev)

    model_end = next(ev for ev in events if isinstance(ev, ModelEnd))
    assert model_end.prompt_tokens == 112
    assert model_end.completion_tokens == 28
    assert model_end.cached_tokens == 25
    agent_end = next(ev for ev in events if isinstance(ev, AgentEnd))
    assert agent_end.output["tokens_in"] == 112
    assert agent_end.output["tokens_out"] == 28
