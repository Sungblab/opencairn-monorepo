"""ToolLoopExecutor — runtime-owned tool-calling loop.

Umbrella: docs/superpowers/specs/2026-04-22-agent-runtime-v2-umbrella.md
Spec:     docs/superpowers/specs/2026-04-22-agent-runtime-v2a-core-tool-loop-design.md

The executor consumes a provider's `generate_with_tools` one turn at a
time, dispatches any requested tool uses through a `ToolRegistry`, and
re-feeds the results until the model stops or a guard fires. Guards,
soft loop detection, per-tool timeouts, and termination reasons are all
owned here so providers stay trivial.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, Sequence

from pydantic import BaseModel


# ── Types ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CallKey:
    tool_name: str
    args_hash: str


@dataclass
class LoopConfig:
    max_turns: int = 8
    max_tool_calls: int = 12
    max_total_input_tokens: int = 200_000
    per_tool_timeout_sec: float = 30.0
    per_tool_timeout_overrides: dict[str, float] = field(
        default_factory=lambda: {"fetch_url": 60.0}
    )
    loop_detection_threshold: int = 3
    loop_detection_stop_threshold: int = 5
    mode: Literal["auto", "any", "none"] = "auto"
    allowed_tool_names: Sequence[str] | None = None
    final_response_schema: type[BaseModel] | None = None
    cached_context_id: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    budget_policy: "BudgetPolicy | None" = None


@dataclass
class LoopState:
    messages: list[Any]
    turn_count: int = 0
    tool_call_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    call_history: list[CallKey] = field(default_factory=list)
    final_structured_output: dict | None = None


TerminationReason = Literal[
    "model_stopped",
    "structured_submitted",
    "max_turns",
    "max_tool_calls",
    "max_input_tokens",
    "budget_exceeded",
    "loop_detected_hard",
    "cancelled",
    "provider_error",
]


@dataclass
class LoopResult:
    final_text: str | None
    final_structured_output: dict | None
    termination_reason: TerminationReason
    turn_count: int
    tool_call_count: int
    total_input_tokens: int
    total_output_tokens: int
    error: str | None = None


# ── Budget policies ─────────────────────────────────────────────────────


class BudgetPolicy(Protocol):
    def should_stop(self, state: LoopState) -> bool: ...


class NullBudgetPolicy:
    """Default. Never blocks — BYOK / PAYG paths per
    `feedback_byok_cost_philosophy` memory."""

    def should_stop(self, state: LoopState) -> bool:
        return False


# ── Hooks ───────────────────────────────────────────────────────────────


class LoopHooks(Protocol):
    async def on_run_start(self, state: LoopState) -> None: ...
    async def on_turn_start(self, state: LoopState) -> None: ...
    async def on_tool_start(self, state: LoopState, tool_use) -> None: ...
    async def on_tool_end(self, state: LoopState, tool_use, result) -> None: ...
    async def on_run_end(self, state: LoopState) -> None: ...


class NoopHooks:
    async def on_run_start(self, state: LoopState) -> None: ...
    async def on_turn_start(self, state: LoopState) -> None: ...
    async def on_tool_start(self, state: LoopState, tool_use) -> None: ...
    async def on_tool_end(self, state: LoopState, tool_use, result) -> None: ...
    async def on_run_end(self, state: LoopState) -> None: ...


# ── Executor ────────────────────────────────────────────────────────────


import asyncio  # noqa: E402
import json  # noqa: E402 (kept near executor so types block stays tidy)
import logging  # noqa: E402

from llm.errors import ProviderFatalError, ProviderRetryableError  # noqa: E402
from llm.tool_types import ToolResult  # noqa: E402

logger = logging.getLogger(__name__)


class ToolLoopExecutor:
    """Sequential tool-calling loop. See module docstring for scope.

    `tool_context` is a plain dict of system-managed values (e.g.
    workspace_id, project_id) that are merged into every tool_use's
    args before dispatch. This enforces workspace isolation: the LLM
    cannot escape its caller-supplied scope even if it tries to pass
    different values.
    """

    def __init__(
        self,
        provider,
        tool_registry,
        config: LoopConfig,
        tool_context: dict[str, Any],
        *,
        tools: list | None = None,
        hooks: LoopHooks | None = None,
    ) -> None:
        self._provider = provider
        self._tool_registry = tool_registry
        self._config = config
        self._tool_context = dict(tool_context)
        self._tools = tools or []
        self._hooks: LoopHooks = hooks or NoopHooks()
        self._budget = config.budget_policy or NullBudgetPolicy()

    async def run(self, initial_messages: list[Any]) -> LoopResult:
        state = LoopState(messages=list(initial_messages))
        await self._hooks.on_run_start(state)
        try:
            while True:
                if reason := self._check_hard_guards(state):
                    return self._finalize(state, reason)

                await self._hooks.on_turn_start(state)

                try:
                    turn = await self._provider.generate_with_tools(
                        messages=state.messages, tools=self._tools,
                        mode=self._config.mode,
                        allowed_tool_names=self._config.allowed_tool_names,
                        final_response_schema=self._config.final_response_schema,
                        cached_context_id=self._config.cached_context_id,
                        temperature=self._config.temperature,
                        max_output_tokens=self._config.max_output_tokens,
                    )
                except ProviderRetryableError:
                    raise  # Temporal activity retry
                except ProviderFatalError as e:
                    return self._finalize(
                        state, "provider_error", error=str(e),
                    )

                state.total_input_tokens += turn.usage.input_tokens
                state.total_output_tokens += turn.usage.output_tokens
                state.messages.append(turn.assistant_message)

                if not turn.tool_uses:
                    return self._finalize(
                        state, "model_stopped",
                        final_text=turn.final_text,
                        structured=turn.structured_output,
                    )

                for tu in turn.tool_uses:
                    repeat_count = self._repeat_count(state, tu)
                    if reason := self._check_soft_guards(repeat_count):
                        return self._finalize(state, reason)
                    if self._should_warn_loop(repeat_count):
                        result = self._build_loop_warning(tu)
                    else:
                        result = await self._execute_tool(tu)
                    state.messages.append(
                        self._provider.tool_result_to_message(result)
                    )
                    state.tool_call_count += 1
                    state.call_history.append(
                        CallKey(tu.name, tu.args_hash())
                    )
                    await self._hooks.on_tool_end(state, tu, result)

                    if (
                        tu.name == "emit_structured_output"
                        and isinstance(result.data, dict)
                        and result.data.get("accepted") is True
                    ):
                        state.final_structured_output = result.data.get("validated")
                        return self._finalize(state, "structured_submitted")

                    if reason := self._check_hard_guards(state):
                        return self._finalize(state, reason)

                state.turn_count += 1
        except asyncio.CancelledError:
            return self._finalize(state, "cancelled")
        finally:
            await self._hooks.on_run_end(state)

    async def _execute_tool(self, tool_use) -> ToolResult:
        # Merge system-managed scope values over LLM-supplied args
        # (Umbrella §3 C3 — workspace isolation enforcement).
        timeout = self._config.per_tool_timeout_overrides.get(
            tool_use.name, self._config.per_tool_timeout_sec,
        )
        args = {**tool_use.args, **self._tool_context}
        try:
            async with asyncio.timeout(timeout):
                raw = await self._tool_registry.execute(tool_use.name, args)
            data = self._truncate(raw, tool_use.name)
            return ToolResult(
                tool_use_id=tool_use.id, name=tool_use.name,
                data=data, is_error=False,
            )
        except asyncio.TimeoutError:
            return ToolResult(
                tool_use_id=tool_use.id, name=tool_use.name,
                data={"error": f"Tool timed out after {timeout}s"},
                is_error=True,
            )
        except Exception as e:
            return ToolResult(
                tool_use_id=tool_use.id, name=tool_use.name,
                data={"error": f"{type(e).__name__}: {e}"},
                is_error=True,
            )

    def _truncate(self, data: Any, tool_name: str) -> Any:
        max_chars = 50_000
        encoded = json.dumps(data, default=str)
        if len(encoded) > max_chars:
            return (
                encoded[: max_chars - 200]
                + f"\n\n[truncated: original {len(encoded)} chars]"
            )
        return data

    def _finalize(
        self,
        state: LoopState,
        reason: TerminationReason,
        *,
        final_text: str | None = None,
        structured: dict | None = None,
        error: str | None = None,
    ) -> LoopResult:
        return LoopResult(
            final_text=final_text,
            final_structured_output=structured or state.final_structured_output,
            termination_reason=reason,
            turn_count=state.turn_count,
            tool_call_count=state.tool_call_count,
            total_input_tokens=state.total_input_tokens,
            total_output_tokens=state.total_output_tokens,
            error=error,
        )

    def _check_hard_guards(self, state: LoopState) -> TerminationReason | None:
        if state.turn_count >= self._config.max_turns:
            return "max_turns"
        if state.tool_call_count >= self._config.max_tool_calls:
            return "max_tool_calls"
        if state.total_input_tokens >= self._config.max_total_input_tokens:
            return "max_input_tokens"
        if self._budget.should_stop(state):
            return "budget_exceeded"
        return None

    def _repeat_count(self, state: LoopState, tool_use) -> int:
        key = CallKey(tool_use.name, tool_use.args_hash())
        return state.call_history.count(key)

    def _check_soft_guards(self, repeat_count: int) -> TerminationReason | None:
        if repeat_count >= self._config.loop_detection_stop_threshold - 1:
            return "loop_detected_hard"
        return None

    def _should_warn_loop(self, repeat_count: int) -> bool:
        return repeat_count >= self._config.loop_detection_threshold - 1

    def _build_loop_warning(self, tool_use) -> ToolResult:
        return ToolResult(
            tool_use_id=tool_use.id, name=tool_use.name,
            data={
                "warning": (
                    f"You have called '{tool_use.name}' with the same "
                    "arguments repeatedly. Try a different approach."
                )
            },
            is_error=True,
        )
