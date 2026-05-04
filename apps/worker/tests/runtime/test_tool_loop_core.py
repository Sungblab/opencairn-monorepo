from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from llm.tool_types import AssistantTurn, ToolResult, ToolUse, UsageCounts

from runtime.tool_loop import LoopConfig, ToolLoopExecutor
from runtime.tool_policy import ToolPolicy


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


class _CaptureHooks:
    def __init__(self):
        self.messages: list[Any] = []

    async def on_run_start(self, state) -> None:
        pass

    async def on_turn_start(self, state) -> None:
        pass

    async def on_tool_start(self, state, tool_use) -> None:
        pass

    async def on_tool_end(self, state, tool_use, result) -> None:
        pass

    async def on_run_end(self, state) -> None:
        self.messages = list(state.messages)


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


async def test_read_only_permission_denies_write_tool_without_invoking_registry():
    tu = ToolUse(id="t1", name="update_page", args={"title": "x"})
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="done"),
    ])
    called = False

    async def handler(args):
        nonlocal called
        called = True
        return {"ok": True}

    registry = _FakeRegistry({"update_page": handler})
    write_tool = SimpleNamespace(name="update_page", read_only=False, risk="write")
    executor = ToolLoopExecutor(
        provider=provider,
        tool_registry=registry,
        config=LoopConfig(permission_mode="read_only"),
        tool_context={"workspace_id": "ws"},
        tools=[write_tool],
    )

    result = await executor.run(initial_messages=[{"role": "user", "text": "update"}])

    assert result.termination_reason == "model_stopped"
    assert called is False


async def test_ask_mode_returns_approval_needed_result_for_write_tool():
    tu = ToolUse(id="t1", name="update_page", args={"title": "x"})
    hooks = _CaptureHooks()
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="done"),
    ])

    async def handler(args):
        return {"ok": True}

    registry = _FakeRegistry({"update_page": handler})
    write_tool = SimpleNamespace(name="update_page", read_only=False, risk="write")
    executor = ToolLoopExecutor(
        provider=provider,
        tool_registry=registry,
        config=LoopConfig(permission_mode="ask"),
        tool_context={"workspace_id": "ws"},
        tools=[write_tool],
        hooks=hooks,
    )

    await executor.run(initial_messages=[{"role": "user", "text": "update"}])

    tool_messages = [
        msg for msg in hooks.messages
        if isinstance(msg, dict) and msg.get("role") == "tool"
    ]
    assert tool_messages[0]["is_error"] is True
    assert tool_messages[0]["data"]["permission"]["action"] == "needs_approval"


async def test_permission_policy_uses_runtime_context_over_model_scope_args():
    tu = ToolUse(
        id="t1",
        name="update_page",
        args={"page_id": "model-page", "title": "x"},
    )
    hooks = _CaptureHooks()
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="done"),
    ])

    async def handler(args):
        return {"ok": True}

    registry = _FakeRegistry({"update_page": handler})
    write_tool = SimpleNamespace(
        name="update_page",
        policy=lambda args: ToolPolicy(
            read_only=False,
            risk="write",
            resource=f"page:{args['page_id']}",
        ),
    )
    executor = ToolLoopExecutor(
        provider=provider,
        tool_registry=registry,
        config=LoopConfig(permission_mode="ask"),
        tool_context={"workspace_id": "ws", "page_id": "runtime-page"},
        tools=[write_tool],
        hooks=hooks,
    )

    await executor.run(initial_messages=[{"role": "user", "text": "update"}])

    tool_messages = [
        msg for msg in hooks.messages
        if isinstance(msg, dict) and msg.get("role") == "tool"
    ]
    assert tool_messages[0]["data"]["permission"]["policy"]["resource"] == "page:runtime-page"


async def test_loop_warning_emits_one_response_per_tool_use_id():
    first = ToolUse(id="repeat-1", name="search", args={"q": "same"})
    second = ToolUse(id="repeat-2", name="search", args={"q": "same"})
    hooks = _CaptureHooks()
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[first]),
        _turn(tool_uses=[second]),
        _turn(text="done"),
    ])

    async def search_handler(args):
        return {"hits": ["concept_42"]}

    registry = _FakeRegistry(handlers={"search": search_handler})
    executor = ToolLoopExecutor(
        provider=provider,
        tool_registry=registry,
        config=LoopConfig(
            loop_detection_threshold=2,
            loop_detection_stop_threshold=10,
        ),
        tool_context={"workspace_id": "ws"},
        hooks=hooks,
    )
    result = await executor.run(initial_messages=[{"role": "user", "text": "find"}])

    assert result.termination_reason == "model_stopped"
    tool_messages = [
        msg for msg in hooks.messages
        if isinstance(msg, dict) and msg.get("role") == "tool"
    ]
    assert [msg["id"] for msg in tool_messages].count("repeat-2") == 1
