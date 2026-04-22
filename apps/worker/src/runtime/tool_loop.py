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
