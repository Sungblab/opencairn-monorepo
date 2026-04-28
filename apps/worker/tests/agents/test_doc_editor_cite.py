"""Plan 11B Phase B - /cite command behavior."""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from runtime.events import AgentEnd
from runtime.tool_loop import LoopResult
from runtime.tools import ToolContext
from worker.agents.doc_editor.agent import DocEditorAgent, DocEditorOutput


def _ctx() -> ToolContext:
    return ToolContext(
        workspace_id="ws-test",
        project_id="proj-1",
        page_id=None,
        user_id="user-1",
        run_id="run-test",
        scope="project",
        emit=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_cite_returns_diff_payload_from_tool_loop(monkeypatch: pytest.MonkeyPatch):
    async def fake_run_with_tools(**kwargs: Any) -> LoopResult:
        assert kwargs["tool_context"]["project_id"] == "proj-1"
        assert kwargs["config"].allowed_tool_names == [
            "search_notes",
            "emit_structured_output",
        ]
        return LoopResult(
            final_text=None,
            final_structured_output={
                "hunks": [
                    {
                        "blockId": "b1",
                        "originalRange": {"start": 0, "end": 11},
                        "originalText": "Claim text.",
                        "replacementText": "Claim text.[^1]\n\n[^1]: Source note",
                    }
                ],
                "summary": "1 citation added",
            },
            termination_reason="structured_submitted",
            turn_count=1,
            tool_call_count=1,
            total_input_tokens=123,
            total_output_tokens=45,
        )

    monkeypatch.setattr(
        "worker.agents.doc_editor.agent.run_with_tools",
        fake_run_with_tools,
    )
    provider = AsyncMock()
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)
    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "cite",
            "selection": {
                "blockId": "b1",
                "start": 0,
                "end": 11,
                "text": "Claim text.",
            },
            "documentContextSnippet": "",
            "note_id": "n",
            "project_id": "proj-1",
            "user_id": "u",
        },
        _ctx(),
    ):
        events.append(ev)

    out = DocEditorOutput(**events[-1].output)
    assert isinstance(events[-1], AgentEnd)
    assert out.command == "cite"
    assert out.output_mode == "diff"
    assert out.tools_used == 1
    assert "[^1]" in out.payload["hunks"][0]["replacementText"]


@pytest.mark.asyncio
async def test_cite_allows_no_evidence_no_change(monkeypatch: pytest.MonkeyPatch):
    async def fake_run_with_tools(**_kwargs: Any) -> LoopResult:
        return LoopResult(
            final_text=None,
            final_structured_output={
                "hunks": [
                    {
                        "blockId": "b1",
                        "originalRange": {"start": 0, "end": 11},
                        "originalText": "Claim text.",
                        "replacementText": "Claim text.",
                    }
                ],
                "summary": "no suitable citation found",
            },
            termination_reason="structured_submitted",
            turn_count=1,
            tool_call_count=0,
            total_input_tokens=10,
            total_output_tokens=5,
        )

    monkeypatch.setattr(
        "worker.agents.doc_editor.agent.run_with_tools",
        fake_run_with_tools,
    )
    provider = AsyncMock()
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)
    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "cite",
            "selection": {
                "blockId": "b1",
                "start": 0,
                "end": 11,
                "text": "Claim text.",
            },
            "documentContextSnippet": "",
            "note_id": "n",
            "project_id": "proj-1",
            "user_id": "u",
        },
        _ctx(),
    ):
        events.append(ev)

    out = DocEditorOutput(**events[-1].output)
    assert out.payload["hunks"][0]["replacementText"] == "Claim text."
