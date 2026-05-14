"""Tool registry adapter used by `ToolLoopExecutor`.

`runtime.tools.Tool` instances are keyed by `.name`. The adapter looks
them up, injects a `ToolContext`, and calls `.run()`. The executor only
needs an object with an async `execute(name, args)` signature.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from runtime.tools import Tool, ToolContext

_SYSTEM_KEYS = {
    "workspace_id",
    "project_id",
    "page_id",
    "user_id",
    "run_id",
    "scope",
}


class ToolContextRegistry:
    def __init__(self, tools: list[Tool], ctx: ToolContext) -> None:
        self._by_name = {t.name: t for t in tools}
        self._ctx = ctx

    async def execute(self, name: str, args: dict[str, Any]) -> Any:
        tool = self._by_name.get(name)
        if tool is None:
            raise KeyError(f"Unknown tool: {name}")
        # Remove any system-managed keys the LLM might have tried to
        # supply; they come from ctx instead. (ToolLoopExecutor already
        # merges ctx values into args; we strip here to avoid Pydantic
        # rejecting unexpected fields in the tool's input schema.)
        clean = {k: v for k, v in args.items() if k not in _SYSTEM_KEYS}
        return await tool.run(clean, self._ctx)
