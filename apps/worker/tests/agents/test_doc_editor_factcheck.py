"""Plan 11B Phase B - /factcheck command behavior."""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

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
async def test_factcheck_returns_comment_payload(monkeypatch: pytest.MonkeyPatch):
    async def fake_run_with_tools(**kwargs: Any) -> LoopResult:
        assert kwargs["config"].allowed_tool_names == [
            "search_notes",
            "emit_structured_output",
        ]
        return LoopResult(
            final_text=None,
            final_structured_output={
                "claims": [
                    {
                        "blockId": "b1",
                        "range": {"start": 0, "end": 10},
                        "verdict": "supported",
                        "evidence": [
                            {
                                "source_id": "note-1",
                                "snippet": "Source supports it.",
                                "confidence": 0.9,
                            }
                        ],
                        "note": "Evidence supports the claim.",
                    }
                ]
            },
            termination_reason="structured_submitted",
            turn_count=1,
            tool_call_count=2,
            total_input_tokens=200,
            total_output_tokens=80,
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
            "command": "factcheck",
            "selection": {
                "blockId": "b1",
                "start": 0,
                "end": 10,
                "text": "Claim text",
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
    assert out.command == "factcheck"
    assert out.output_mode == "comment"
    assert out.tools_used == 2
    assert out.payload["claims"][0]["verdict"] == "supported"


@pytest.mark.asyncio
async def test_factcheck_all_unclear_without_evidence(monkeypatch: pytest.MonkeyPatch):
    async def fake_run_with_tools(**_kwargs: Any) -> LoopResult:
        return LoopResult(
            final_text=None,
            final_structured_output={
                "claims": [
                    {
                        "blockId": "b1",
                        "range": {"start": 0, "end": 10},
                        "verdict": "unclear",
                        "evidence": [],
                        "note": "No matching evidence found.",
                    }
                ]
            },
            termination_reason="structured_submitted",
            turn_count=1,
            tool_call_count=1,
            total_input_tokens=50,
            total_output_tokens=20,
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
            "command": "factcheck",
            "selection": {
                "blockId": "b1",
                "start": 0,
                "end": 10,
                "text": "Claim text",
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
    assert out.payload["claims"][0]["verdict"] == "unclear"
    assert out.payload["claims"][0]["evidence"] == []
