"""Tests for hook system — registration, scope resolution, short-circuit semantics."""
from __future__ import annotations

from typing import Any

import pytest

from runtime.events import AgentEvent
from runtime.hooks import (
    AgentHook,
    HookRegistry,
    ModelHook,
    ModelRequest,
    ModelResponse,
    ToolHook,
)
from runtime.tools import ToolContext


async def _noop(_ev: AgentEvent) -> None:
    pass


@pytest.fixture
def ctx() -> ToolContext:
    return ToolContext(
        workspace_id="w1", project_id=None, page_id=None,
        user_id="u1", run_id="r1", scope="workspace", emit=_noop,
    )


class RecorderAgentHook(AgentHook):
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def before_agent(self, ctx: ToolContext, input: dict[str, Any]) -> dict[str, Any] | None:
        self.calls.append(f"before:{input.get('tag')}")
        return None

    async def after_agent(self, ctx: ToolContext, output: dict[str, Any]) -> dict[str, Any] | None:
        self.calls.append("after")
        return None


class ShortCircuitHook(AgentHook):
    async def before_agent(self, ctx: ToolContext, input: dict[str, Any]) -> dict[str, Any] | None:
        return {"short_circuited": True}

    async def after_agent(self, ctx: ToolContext, output: dict[str, Any]) -> dict[str, Any] | None:
        return None


async def test_register_global_agent_hook(ctx: ToolContext) -> None:
    reg = HookRegistry()
    h = RecorderAgentHook()
    reg.register(h, scope="global")
    chain = reg.resolve(ctx)
    await chain.run_before_agent(ctx, {"tag": "x"})
    assert h.calls == ["before:x"]


async def test_short_circuit_stops_chain(ctx: ToolContext) -> None:
    reg = HookRegistry()
    sc = ShortCircuitHook()
    rec = RecorderAgentHook()
    reg.register(sc, scope="global")
    reg.register(rec, scope="global")
    chain = reg.resolve(ctx)
    result = await chain.run_before_agent(ctx, {"tag": "y"})
    assert result == {"short_circuited": True}
    assert rec.calls == []  # recorder skipped


async def test_agent_scope_filters_by_agent_filter(ctx: ToolContext) -> None:
    reg = HookRegistry()
    h = RecorderAgentHook()
    reg.register(h, scope="agent", agent_filter=["research"])
    chain = reg.resolve_for_agent(ctx, agent_name="research")
    await chain.run_before_agent(ctx, {"tag": "r"})
    assert h.calls == ["before:r"]

    h2 = RecorderAgentHook()
    reg2 = HookRegistry()
    reg2.register(h2, scope="agent", agent_filter=["research"])
    chain2 = reg2.resolve_for_agent(ctx, agent_name="librarian")
    await chain2.run_before_agent(ctx, {"tag": "l"})
    assert h2.calls == []  # not in filter


async def test_onion_execution_order(ctx: ToolContext) -> None:
    """global before -> agent before -> run before -> [run] -> run after -> agent after -> global after."""
    order: list[str] = []

    class OrderHook(AgentHook):
        def __init__(self, tag: str) -> None:
            self.tag = tag

        async def before_agent(
            self, ctx: ToolContext, input: dict[str, Any]
        ) -> dict[str, Any] | None:
            order.append(f"{self.tag}:before")
            return None

        async def after_agent(
            self, ctx: ToolContext, output: dict[str, Any]
        ) -> dict[str, Any] | None:
            order.append(f"{self.tag}:after")
            return None

    reg = HookRegistry()
    reg.register(OrderHook("global"), scope="global")
    reg.register(OrderHook("agent"), scope="agent", agent_filter=["research"])
    reg.register(OrderHook("run"), scope="run", run_id="r1")
    chain = reg.resolve_for_agent(ctx, agent_name="research")
    await chain.run_before_agent(ctx, {})
    await chain.run_after_agent(ctx, {})
    assert order == [
        "global:before", "agent:before", "run:before",
        "run:after", "agent:after", "global:after",
    ]


async def test_model_hook_on_error_short_circuits(ctx: ToolContext) -> None:
    class Recover(ModelHook):
        async def before_model(
            self, ctx: ToolContext, request: ModelRequest
        ) -> ModelRequest | None:
            return None

        async def after_model(
            self, ctx: ToolContext, response: ModelResponse
        ) -> ModelResponse | None:
            return None

        async def on_model_error(
            self, ctx: ToolContext, error: Exception
        ) -> ModelResponse | None:
            return ModelResponse(
                text="fallback", model_id="x",
                prompt_tokens=0, completion_tokens=0, cost_krw=0,
            )

    reg = HookRegistry()
    reg.register(Recover(), scope="global")
    chain = reg.resolve(ctx)
    resp = await chain.run_on_model_error(ctx, RuntimeError("boom"))
    assert resp is not None
    assert resp.text == "fallback"


async def test_tool_hook_before_can_replace_result(ctx: ToolContext) -> None:
    class CacheHit(ToolHook):
        async def before_tool(
            self, ctx: ToolContext, tool_name: str, args: dict[str, Any]
        ) -> Any | None:
            return {"cached": True}

        async def after_tool(
            self, ctx: ToolContext, tool_name: str, result: Any
        ) -> Any | None:
            return None

        async def on_tool_error(
            self, ctx: ToolContext, tool_name: str, error: Exception
        ) -> Any | None:
            return None

    reg = HookRegistry()
    reg.register(CacheHit(), scope="global")
    chain = reg.resolve(ctx)
    result = await chain.run_before_tool(ctx, "search_pages", {"q": "x"})
    assert result == {"cached": True}
