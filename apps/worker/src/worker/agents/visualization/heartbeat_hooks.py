"""HeartbeatLoopHooks — relays tool_use/tool_result events to Temporal
activity heartbeat metadata so the apps/api SSE wrapper can stream
progress to the browser. Plan 5 Phase 2.

Implements ``runtime.tool_loop.LoopHooks`` Protocol.

Heartbeats are *lossy* — Temporal only persists the latest call's details.
The first iteration of this hook emitted a single event per heartbeat,
which meant fast tool calls (cache hits, sub-poll-interval completions)
overwrote each other before the API poller (250 ms) ever saw them — the
SSE feed silently dropped events. To fix that, this hook accumulates
the full ``{event, payload}`` history and re-emits it via variadic
``activity.heartbeat(*self._events)`` on every call, so the latest
``heartbeatDetails.payloads`` always carries every event the run has
emitted. The API side dedupes by JSON-stringifying each payload (see
``apps/api/src/lib/temporal-visualize.ts`` ``streamBuildView``).
"""
from __future__ import annotations

from typing import Any

from temporalio import activity


class HeartbeatLoopHooks:
    """Heartbeat per tool_use/tool_result. Other lifecycle hooks no-op."""

    def __init__(self) -> None:
        # Append-only event history. Each tool_use / tool_result becomes one
        # entry, and every heartbeat call re-sends the full list so the
        # `heartbeatDetails.payloads` snapshot always reflects every event.
        self._events: list[dict[str, Any]] = []

    def _emit(self, event: dict[str, Any]) -> None:
        self._events.append(event)
        # Variadic — Temporal serialises each positional arg into a separate
        # entry on `heartbeatDetails.payloads`. The API decoder iterates
        # that array, decodes each Payload via the SDK DataConverter, and
        # dedupes against an in-memory `seen` Set keyed on JSON.stringify.
        activity.heartbeat(*self._events)

    async def on_run_start(self, state: Any) -> None:  # noqa: D401
        return None

    async def on_turn_start(self, state: Any) -> None:
        return None

    async def on_tool_start(self, state: Any, tool_use: Any) -> None:
        self._emit({
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
        self._emit({
            "event": "tool_result",
            "payload": {
                "callId": tool_use.id,
                "name": tool_use.name,
                "ok": not bool(getattr(result, "is_error", False)),
            },
        })

    async def on_run_end(self, state: Any) -> None:
        return None
