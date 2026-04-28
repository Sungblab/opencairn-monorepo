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
