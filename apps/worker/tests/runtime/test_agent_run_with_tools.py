from __future__ import annotations

import pytest
from llm.errors import ToolCallingNotSupported
from llm.tool_types import AssistantTurn, ToolResult, ToolUse, UsageCounts

from runtime.events import AgentEvent  # noqa: TC001
from runtime.loop_runner import run_with_tools
from runtime.tool_loop import LoopConfig
from runtime.tools import ToolContext, tool


class _NoToolsProvider:
    def supports_tool_calling(self) -> bool:
        return False

    async def generate_with_tools(self, **kwargs):
        raise ToolCallingNotSupported("nope")


class _FakeProvider:
    def __init__(self, scripted: list[AssistantTurn]) -> None:
        self.scripted = scripted

    def supports_tool_calling(self) -> bool:
        return True

    async def generate_with_tools(self, **kwargs):
        return self.scripted.pop(0)

    def tool_result_to_message(self, result: ToolResult) -> dict:
        return {
            "role": "tool",
            "id": result.tool_use_id,
            "name": result.name,
            "data": result.data,
            "is_error": result.is_error,
        }


def _turn(text: str | None = None, tool_uses=(), stop="STOP"):
    return AssistantTurn(
        final_text=text,
        tool_uses=tuple(tool_uses),
        assistant_message={"role": "assistant", "text": text},
        usage=UsageCounts(input_tokens=5, output_tokens=3),
        stop_reason=stop,
    )


async def _noop_emit(_ev: AgentEvent) -> None:
    return None


async def test_run_with_tools_fails_fast_when_provider_unsupported():
    with pytest.raises(ToolCallingNotSupported):
        await run_with_tools(
            provider=_NoToolsProvider(),
            initial_messages=[],
            tools=[],
            tool_context={"workspace_id": "ws", "project_id": "pj"},
            config=LoopConfig(),
        )


async def test_run_with_tools_threads_read_only_permission_mode():
    called = False

    @tool(name="write_note", read_only=False, risk="write")
    async def write_note(note_id: str, body: str, ctx: ToolContext) -> dict:
        nonlocal called
        called = True
        return {"note_id": note_id, "workspace_id": ctx.workspace_id}

    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[ToolUse(id="t1", name="write_note", args={"note_id": "n1", "body": "x"})]),
        _turn(text="done"),
    ])

    result = await run_with_tools(
        provider=provider,
        initial_messages=[{"role": "user", "text": "write"}],
        tools=[write_note],
        tool_context={
            "workspace_id": "ws",
            "project_id": "pj",
            "user_id": "u1",
            "run_id": "r1",
            "scope": "project",
            "emit": _noop_emit,
        },
        permission_mode="read_only",
    )

    assert result.termination_reason == "model_stopped"
    assert called is False
