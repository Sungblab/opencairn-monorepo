"""Convenience helper that stitches provider + tools + ToolLoopExecutor.

Existing `runtime.agent.Agent` is an abstract base for 12 production
agents with class-level `name`; it is not a generic tool-loop owner.
The Sub-project A plan referred to an `Agent.run_with_tools` method
but the reality of the codebase makes a standalone runner the cleaner
adaptation (Spec Reconciliation item 7).
"""
from __future__ import annotations

from typing import Any

from llm.errors import ToolCallingNotSupported

from runtime.tool_loop import (
    LoopConfig,
    LoopHooks,
    LoopResult,
    ToolLoopExecutor,
)
from runtime.tool_registry import ToolContextRegistry
from runtime.tools import ToolContext


async def _noop_emit(_ev: Any) -> None:
    return None


def _build_ctx(tool_context: dict[str, Any]) -> ToolContext:
    return ToolContext(
        workspace_id=tool_context["workspace_id"],
        project_id=tool_context.get("project_id"),
        page_id=tool_context.get("page_id"),
        user_id=tool_context.get("user_id", ""),
        run_id=tool_context.get("run_id", ""),
        scope=tool_context.get("scope", "project"),
        emit=tool_context.get("emit", _noop_emit),
    )


async def run_with_tools(
    *,
    provider,
    initial_messages: list,
    tools: list,
    tool_context: dict,
    config: LoopConfig | None = None,
    hooks: LoopHooks | None = None,
) -> LoopResult:
    """Run a tool-calling loop bound to `provider`.

    Fails fast with `ToolCallingNotSupported` when the provider does
    not implement tool calling (e.g. `LLM_PROVIDER=ollama` during
    Sub-project A).
    """
    if not provider.supports_tool_calling():
        raise ToolCallingNotSupported(
            f"Provider {type(provider).__name__} does not support tool calling."
        )

    ctx = _build_ctx(tool_context)
    registry = ToolContextRegistry(tools=tools, ctx=ctx)
    executor = ToolLoopExecutor(
        provider=provider,
        tool_registry=registry,
        config=config or LoopConfig(),
        tool_context=tool_context,
        tools=tools,
        hooks=hooks,
    )
    return await executor.run(initial_messages=initial_messages)


__all__ = ["run_with_tools"]
