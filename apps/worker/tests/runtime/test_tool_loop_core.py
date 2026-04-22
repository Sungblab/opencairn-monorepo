from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from llm.tool_types import AssistantTurn, ToolResult, ToolUse, UsageCounts
from runtime.tool_loop import LoopConfig, ToolLoopExecutor


@dataclass
class _FakeProvider:
    """Scripted responses: list of AssistantTurn, popped in order."""
    scripted: list[AssistantTurn]

    def supports_tool_calling(self) -> bool:
        return True

    async def generate_with_tools(self, **kwargs) -> AssistantTurn:
        return self.scripted.pop(0)

    def tool_result_to_message(self, result: ToolResult) -> dict:
        return {
            "role": "tool",
            "id": result.tool_use_id,
            "name": result.name,
            "data": result.data,
            "is_error": result.is_error,
        }


class _FakeRegistry:
    def __init__(self, handlers: dict[str, Any]):
        self._handlers = handlers

    async def execute(self, name: str, args: dict) -> Any:
        return await self._handlers[name](args)


def _turn(text: str | None = None, tool_uses=(), stop="STOP"):
    return AssistantTurn(
        final_text=text, tool_uses=tuple(tool_uses),
        assistant_message={"role": "assistant", "text": text},
        usage=UsageCounts(input_tokens=5, output_tokens=3),
        stop_reason=stop,
    )


async def test_turn_one_no_tools_returns_model_stopped():
    provider = _FakeProvider(scripted=[_turn(text="hi")])
    registry = _FakeRegistry(handlers={})
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=LoopConfig(), tool_context={"workspace_id": "ws"},
    )
    result = await executor.run(initial_messages=[{"role": "user", "text": "ping"}])
    assert result.termination_reason == "model_stopped"
    assert result.final_text == "hi"
    assert result.turn_count == 0
    assert result.tool_call_count == 0


async def test_tool_use_then_model_stopped():
    tu = ToolUse(id="t1", name="search", args={"q": "rope"})
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="done"),
    ])

    async def search_handler(args):
        assert args["q"] == "rope"
        return {"hits": ["concept_42"]}

    registry = _FakeRegistry(handlers={"search": search_handler})
    executor = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=LoopConfig(), tool_context={"workspace_id": "ws"},
    )
    result = await executor.run(initial_messages=[{"role": "user", "text": "find"}])
    assert result.termination_reason == "model_stopped"
    assert result.tool_call_count == 1
    assert result.final_text == "done"
