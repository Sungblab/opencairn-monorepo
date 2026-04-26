"""HeartbeatLoopHooks — relays tool_use/tool_result events to Temporal
activity heartbeat metadata so the apps/api SSE wrapper can stream
progress to the browser. Plan 5 Phase 2.

Implements `runtime.tool_loop.LoopHooks` Protocol.
"""
from __future__ import annotations

from typing import Any

from temporalio import activity


class HeartbeatLoopHooks:
    """Heartbeat per tool_use/tool_result. Other lifecycle hooks no-op."""

    async def on_run_start(self, state: Any) -> None:  # noqa: D401
        return None

    async def on_turn_start(self, state: Any) -> None:
        return None

    async def on_tool_start(self, state: Any, tool_use: Any) -> None:
        activity.heartbeat({
            "event": "tool_use",
            "payload": {
                "name": tool_use.name,
                "callId": tool_use.id,
                "input": dict(tool_use.args or {}),
            },
        })

    async def on_tool_end(
        self, state: Any, tool_use: Any, result: Any,
    ) -> None:
        activity.heartbeat({
            "event": "tool_result",
            "payload": {
                "callId": tool_use.id,
                "name": tool_use.name,
                "ok": not bool(getattr(result, "is_error", False)),
            },
        })

    async def on_run_end(self, state: Any) -> None:
        return None
