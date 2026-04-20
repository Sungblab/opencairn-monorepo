"""Hook system — 3-tier ABCs (agent/model/tool), scope-based registry, onion execution.

Short-circuit semantics:
  - before_* returning non-None: skip subsequent hooks + skip real execution, use value as result
  - after_* returning non-None: transform result, pass to outer hooks
  - on_error returning non-None: suppress error, use value as result
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel

from runtime.tools import ToolContext


class ModelRequest(BaseModel):
    """Provider-agnostic LLM request passed through hooks."""

    model_id: str
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]] = []
    temperature: float | None = None
    max_tokens: int | None = None


class ModelResponse(BaseModel):
    """Provider-agnostic LLM response."""

    text: str
    model_id: str
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int = 0
    cost_krw: int
    finish_reason: str = "stop"
    latency_ms: int = 0
    raw: Any = None  # provider-specific payload


class AgentHook(ABC):
    @abstractmethod
    async def before_agent(
        self, ctx: ToolContext, input: dict[str, Any]
    ) -> dict[str, Any] | None: ...
    @abstractmethod
    async def after_agent(
        self, ctx: ToolContext, output: dict[str, Any]
    ) -> dict[str, Any] | None: ...


class ModelHook(ABC):
    @abstractmethod
    async def before_model(
        self, ctx: ToolContext, request: ModelRequest
    ) -> ModelRequest | None: ...
    @abstractmethod
    async def after_model(
        self, ctx: ToolContext, response: ModelResponse
    ) -> ModelResponse | None: ...
    @abstractmethod
    async def on_model_error(
        self, ctx: ToolContext, error: Exception
    ) -> ModelResponse | None: ...


class ToolHook(ABC):
    @abstractmethod
    async def before_tool(
        self, ctx: ToolContext, tool_name: str, args: dict[str, Any]
    ) -> Any | None: ...
    @abstractmethod
    async def after_tool(
        self, ctx: ToolContext, tool_name: str, result: Any
    ) -> Any | None: ...
    @abstractmethod
    async def on_tool_error(
        self, ctx: ToolContext, tool_name: str, error: Exception
    ) -> Any | None: ...


Hook = AgentHook | ModelHook | ToolHook
HookScope = Literal["global", "agent", "run"]


@dataclass
class _Registration:
    hook: Hook
    scope: HookScope
    agent_filter: tuple[str, ...] | None
    run_id: str | None


class HookRegistry:
    def __init__(self) -> None:
        self._regs: list[_Registration] = []

    def register(
        self,
        hook: Hook,
        *,
        scope: HookScope,
        agent_filter: list[str] | None = None,
        run_id: str | None = None,
    ) -> None:
        self._regs.append(
            _Registration(
                hook=hook,
                scope=scope,
                agent_filter=tuple(agent_filter) if agent_filter else None,
                run_id=run_id,
            )
        )

    def resolve(self, ctx: ToolContext) -> HookChain:
        """Resolve chain without an agent_name filter. Matches global + run scope only."""
        return self.resolve_for_agent(ctx, agent_name=None)

    def resolve_for_agent(self, ctx: ToolContext, agent_name: str | None) -> HookChain:
        matched: list[_Registration] = []
        for r in self._regs:
            if r.scope == "global":
                matched.append(r)
            elif r.scope == "agent":
                if agent_name is not None and r.agent_filter and agent_name in r.agent_filter:
                    matched.append(r)
            elif r.scope == "run":
                if r.run_id == ctx.run_id:
                    matched.append(r)
        # Preserve onion ordering: global -> agent -> run
        order = {"global": 0, "agent": 1, "run": 2}
        matched.sort(key=lambda r: order[r.scope])
        return HookChain(matched)


class HookChain:
    """Executes a matched set of hooks with short-circuit + onion semantics."""

    def __init__(self, regs: list[_Registration]) -> None:
        self._regs = regs

    def _agent_hooks(self) -> list[AgentHook]:
        return [r.hook for r in self._regs if isinstance(r.hook, AgentHook)]

    def _model_hooks(self) -> list[ModelHook]:
        return [r.hook for r in self._regs if isinstance(r.hook, ModelHook)]

    def _tool_hooks(self) -> list[ToolHook]:
        return [r.hook for r in self._regs if isinstance(r.hook, ToolHook)]

    async def run_before_agent(
        self, ctx: ToolContext, input: dict[str, Any]
    ) -> dict[str, Any] | None:
        for h in self._agent_hooks():
            result = await h.before_agent(ctx, input)
            if result is not None:
                return result
        return None

    async def run_after_agent(
        self, ctx: ToolContext, output: dict[str, Any]
    ) -> dict[str, Any]:
        # Reverse order for "after" (onion)
        current = output
        for h in reversed(self._agent_hooks()):
            result = await h.after_agent(ctx, current)
            if result is not None:
                current = result
        return current

    async def run_before_model(
        self, ctx: ToolContext, request: ModelRequest
    ) -> ModelResponse | ModelRequest:
        """Returns ModelResponse to short-circuit, or (possibly modified) ModelRequest to proceed.

        Always returns a value so the caller can both detect short-circuit and receive
        hook-modified request. Distinguish via isinstance.
        """
        current_req = request
        for h in self._model_hooks():
            out = await h.before_model(ctx, current_req)
            if isinstance(out, ModelResponse):
                return out
            if isinstance(out, ModelRequest):
                current_req = out
        return current_req

    async def run_after_model(
        self, ctx: ToolContext, response: ModelResponse
    ) -> ModelResponse:
        current = response
        for h in reversed(self._model_hooks()):
            out = await h.after_model(ctx, current)
            if out is not None:
                current = out
        return current

    async def run_on_model_error(
        self, ctx: ToolContext, error: Exception
    ) -> ModelResponse | None:
        for h in self._model_hooks():
            recovered = await h.on_model_error(ctx, error)
            if recovered is not None:
                return recovered
        return None

    async def run_before_tool(
        self, ctx: ToolContext, tool_name: str, args: dict[str, Any]
    ) -> Any | None:
        for h in self._tool_hooks():
            result = await h.before_tool(ctx, tool_name, args)
            if result is not None:
                return result
        return None

    async def run_after_tool(
        self, ctx: ToolContext, tool_name: str, result: Any
    ) -> Any:
        current = result
        for h in reversed(self._tool_hooks()):
            out = await h.after_tool(ctx, tool_name, current)
            if out is not None:
                current = out
        return current

    async def run_on_tool_error(
        self, ctx: ToolContext, tool_name: str, error: Exception
    ) -> Any | None:
        for h in self._tool_hooks():
            recovered = await h.on_tool_error(ctx, tool_name, error)
            if recovered is not None:
                return recovered
        return None


__all__ = [
    "AgentHook",
    "Hook",
    "HookChain",
    "HookRegistry",
    "HookScope",
    "ModelHook",
    "ModelRequest",
    "ModelResponse",
    "ToolHook",
]
