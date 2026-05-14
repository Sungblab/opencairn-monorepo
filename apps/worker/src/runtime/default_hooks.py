"""Default global hooks — trajectory writer, token counter, Sentry, latency."""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from runtime.events import AgentEnd, AgentError, AgentEvent, ModelEnd
from runtime.hooks import AgentHook, ModelHook, ModelRequest, ModelResponse, ToolHook
from runtime.trajectory import TrajectoryWriter, resolve_storage_from_env

if TYPE_CHECKING:
    from runtime.tools import ToolContext

log = logging.getLogger(__name__)


@dataclass
class RunTotals:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    cost_krw: int = 0
    tool_call_count: int = 0
    model_call_count: int = 0


class TrajectoryWriterHook(AgentHook, ModelHook, ToolHook):
    """Captures every event into an NDJSON trajectory.

    Attached as `global` scope. Hook methods delegate to `on_event`.
    """

    def __init__(self) -> None:
        self._writers: dict[str, TrajectoryWriter] = {}

    async def _build_writer(self, ctx: ToolContext) -> TrajectoryWriter:
        """Override in tests to inject storage."""
        storage = resolve_storage_from_env()
        w = TrajectoryWriter(
            storage=storage, run_id=ctx.run_id, workspace_id=ctx.workspace_id
        )
        await w.open()
        return w

    async def on_event(self, ctx: ToolContext, event: AgentEvent) -> None:
        writer = self._writers.get(ctx.run_id)
        if writer is None:
            writer = await self._build_writer(ctx)
            self._writers[ctx.run_id] = writer
        try:
            await writer.emit(event)
        except Exception:
            log.exception("trajectory emit failed — continuing")

        if isinstance(event, (AgentEnd, AgentError)):
            try:
                await writer.close()
            except Exception:
                log.exception("trajectory close failed")
            finally:
                self._writers.pop(ctx.run_id, None)

    # AgentHook
    async def before_agent(
        self, ctx: ToolContext, input: dict[str, Any]
    ) -> dict[str, Any] | None:
        return None

    async def after_agent(
        self, ctx: ToolContext, output: dict[str, Any]
    ) -> dict[str, Any] | None:
        return None

    # ModelHook
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
        return None

    # ToolHook
    async def before_tool(
        self, ctx: ToolContext, tool_name: str, args: dict[str, Any]
    ) -> Any | None:
        return None

    async def after_tool(
        self, ctx: ToolContext, tool_name: str, result: Any
    ) -> Any | None:
        return None

    async def on_tool_error(
        self, ctx: ToolContext, tool_name: str, error: Exception
    ) -> Any | None:
        return None


class TokenCounterHook(AgentHook, ModelHook, ToolHook):
    """Accumulates per-run token + cost totals. Consumed by workspace credit deduction."""

    def __init__(self) -> None:
        self._totals: dict[str, RunTotals] = {}

    async def reset(self, run_id: str) -> None:
        self._totals[run_id] = RunTotals()

    def totals(self, run_id: str) -> RunTotals:
        return self._totals.setdefault(run_id, RunTotals())

    async def on_event(self, ctx: ToolContext, event: AgentEvent) -> None:
        t = self._totals.setdefault(ctx.run_id, RunTotals())
        if isinstance(event, ModelEnd):
            t.prompt_tokens += event.prompt_tokens
            t.completion_tokens += event.completion_tokens
            t.cached_tokens += event.cached_tokens
            t.cost_krw += event.cost_krw
            t.model_call_count += 1

    async def before_agent(
        self, ctx: ToolContext, input: dict[str, Any]
    ) -> dict[str, Any] | None:
        return None

    async def after_agent(
        self, ctx: ToolContext, output: dict[str, Any]
    ) -> dict[str, Any] | None:
        return None

    async def before_model(
        self, ctx: ToolContext, request: ModelRequest
    ) -> ModelRequest | None:
        return None

    async def after_model(
        self, ctx: ToolContext, response: ModelResponse
    ) -> ModelResponse | None:
        # Treat after_model as the signal for a model call; count via on_event
        # (ModelEnd) to stay consistent with trajectory-driven sources.
        return None

    async def on_model_error(
        self, ctx: ToolContext, error: Exception
    ) -> ModelResponse | None:
        return None

    async def before_tool(
        self, ctx: ToolContext, tool_name: str, args: dict[str, Any]
    ) -> Any | None:
        return None

    async def after_tool(
        self, ctx: ToolContext, tool_name: str, result: Any
    ) -> Any | None:
        t = self._totals.setdefault(ctx.run_id, RunTotals())
        t.tool_call_count += 1
        return None

    async def on_tool_error(
        self, ctx: ToolContext, tool_name: str, error: Exception
    ) -> Any | None:
        return None


class SentryHook(AgentHook, ModelHook, ToolHook):
    """Captures errors to Sentry if SENTRY_DSN is set; otherwise no-op."""

    def __init__(self) -> None:
        self._enabled = bool(os.environ.get("SENTRY_DSN"))
        if self._enabled:
            try:
                import sentry_sdk  # noqa: F401
            except ImportError:
                log.warning(
                    "SENTRY_DSN set but sentry-sdk not installed; "
                    "install 'opencairn-worker[sentry]'"
                )
                self._enabled = False

    async def _capture(self, error: Exception, extra: dict[str, Any]) -> None:
        if not self._enabled:
            return
        import sentry_sdk

        with sentry_sdk.push_scope() as scope:
            for k, v in extra.items():
                scope.set_extra(k, v)
            sentry_sdk.capture_exception(error)

    async def before_agent(
        self, ctx: ToolContext, input: dict[str, Any]
    ) -> dict[str, Any] | None:
        return None

    async def after_agent(
        self, ctx: ToolContext, output: dict[str, Any]
    ) -> dict[str, Any] | None:
        return None

    async def before_model(
        self, ctx: ToolContext, request: ModelRequest
    ) -> ModelRequest | None:
        return None

    async def after_model(
        self, ctx: ToolContext, response: ModelResponse
    ) -> ModelResponse | None:
        return None

    async def before_tool(
        self, ctx: ToolContext, tool_name: str, args: dict[str, Any]
    ) -> Any | None:
        return None

    async def after_tool(
        self, ctx: ToolContext, tool_name: str, result: Any
    ) -> Any | None:
        return None

    async def on_model_error(
        self, ctx: ToolContext, error: Exception
    ) -> ModelResponse | None:
        await self._capture(error, {"run_id": ctx.run_id, "layer": "model"})
        return None

    async def on_tool_error(
        self, ctx: ToolContext, tool_name: str, error: Exception
    ) -> Any | None:
        await self._capture(error, {"run_id": ctx.run_id, "tool": tool_name})
        return None


class LatencyHook(AgentHook, ModelHook, ToolHook):
    """Records start times for latency measurement; logs on completion."""

    def __init__(self) -> None:
        self._starts: dict[str, float] = {}

    async def before_agent(
        self, ctx: ToolContext, input: dict[str, Any]
    ) -> dict[str, Any] | None:
        self._starts[ctx.run_id] = time.monotonic()
        return None

    async def after_agent(
        self, ctx: ToolContext, output: dict[str, Any]
    ) -> dict[str, Any] | None:
        start = self._starts.pop(ctx.run_id, None)
        if start is not None:
            log.info(
                "agent completed run_id=%s duration_ms=%d",
                ctx.run_id, int((time.monotonic() - start) * 1000),
            )
        return None

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
        return None

    async def before_tool(
        self, ctx: ToolContext, tool_name: str, args: dict[str, Any]
    ) -> Any | None:
        return None

    async def after_tool(
        self, ctx: ToolContext, tool_name: str, result: Any
    ) -> Any | None:
        return None

    async def on_tool_error(
        self, ctx: ToolContext, tool_name: str, error: Exception
    ) -> Any | None:
        return None


__all__ = [
    "LatencyHook",
    "RunTotals",
    "SentryHook",
    "TokenCounterHook",
    "TrajectoryWriterHook",
]
