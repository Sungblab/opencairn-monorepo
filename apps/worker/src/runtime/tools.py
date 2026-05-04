"""Tool system — @tool decorator, ToolContext, registry."""
from __future__ import annotations

import inspect
import json
from collections.abc import Awaitable, Callable  # noqa: TC003
from typing import Any, Protocol, get_type_hints, runtime_checkable

import xxhash
from pydantic import BaseModel, ConfigDict, create_model

from runtime.events import AgentEvent, Scope  # noqa: TC001
from runtime.tool_policy import ToolPolicy, ToolRisk  # noqa: TC001


class ToolContext(BaseModel):
    """Runtime injects this per invocation. Excluded from tool input schema."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    workspace_id: str
    project_id: str | None
    page_id: str | None
    user_id: str
    run_id: str
    scope: Scope
    emit: Callable[[AgentEvent], Awaitable[None]]


@runtime_checkable
class Tool(Protocol):
    name: str
    description: str
    allowed_agents: tuple[str, ...]  # empty tuple = all agents
    allowed_scopes: tuple[Scope, ...]  # empty tuple = all scopes

    def supports_parallel(self, args: dict[str, Any]) -> bool: ...
    def input_schema(self) -> dict[str, Any]: ...
    def redact(self, args: dict[str, Any]) -> dict[str, Any]: ...
    async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any: ...


_REGISTRY: dict[str, Tool] = {}


def get_tool(name: str) -> Tool:
    return _REGISTRY[name]


def get_tools_for_agent(agent_name: str, scope: Scope) -> list[Tool]:
    out: list[Tool] = []
    for t in _REGISTRY.values():
        if t.allowed_agents and agent_name not in t.allowed_agents:
            continue
        if t.allowed_scopes and scope not in t.allowed_scopes:
            continue
        out.append(t)
    return out


def hash_input(args: dict[str, Any]) -> str:
    """Stable 64-bit hex hash of args (key-order independent)."""
    canonical = json.dumps(args, sort_keys=True, default=str)
    return xxhash.xxh64(canonical.encode()).hexdigest()


def _build_input_model(func: Callable[..., Any], excluded_params: set[str]) -> type[BaseModel]:
    """Build a Pydantic model from function signature, excluding ToolContext params."""
    hints = get_type_hints(func)
    sig = inspect.signature(func)
    fields: dict[str, Any] = {}
    for name, param in sig.parameters.items():
        if name in excluded_params or name == "return":
            continue
        annotation = hints.get(name, Any)
        default = param.default if param.default is not inspect.Parameter.empty else ...
        fields[name] = (annotation, default)
    model = create_model(f"{func.__name__}_Input", **fields)  # type: ignore[call-overload]
    return model


def _find_context_params(func: Callable[..., Any]) -> set[str]:
    hints = get_type_hints(func)
    return {name for name, t in hints.items() if t is ToolContext}


def tool(
    *,
    name: str | None = None,
    parallel: bool | Callable[[dict[str, Any]], bool] = False,
    redact_fields: tuple[str, ...] = (),
    allowed_agents: tuple[str, ...] = (),
    allowed_scopes: tuple[Scope, ...] = (),
    read_only: bool = False,
    risk: ToolRisk = "sensitive",
    resource: str | None = None,
    policy: ToolPolicy | Callable[[dict[str, Any]], ToolPolicy] | None = None,
) -> Callable[[Callable[..., Awaitable[Any]]], Tool]:
    """Decorate an async function to register it as a Tool.

    - Function signature -> Pydantic input schema (ToolContext params excluded)
    - Docstring first paragraph -> description
    - `parallel`: bool for static, callable(args) -> bool for dynamic
    - `redact_fields`: field names replaced with "[REDACTED]" in trajectory
    - `allowed_agents`: tuple of agent names that can use this tool (empty = all)
    - `allowed_scopes`: scope whitelist
    - `read_only` / `risk` / `resource` / `policy`: optional policy metadata
    """

    def decorator(func: Callable[..., Awaitable[Any]]) -> Tool:
        tool_name = name or func.__name__
        if tool_name in _REGISTRY:
            raise ValueError(f"Tool '{tool_name}' already registered")

        doc = inspect.getdoc(func) or ""
        description = doc.split("\n\n", 1)[0].strip() or tool_name

        ctx_params = _find_context_params(func)
        input_model = _build_input_model(func, excluded_params=ctx_params)

        class _ConcreteTool:
            def __init__(self) -> None:
                self.name = tool_name
                self.description = description
                self.allowed_agents = allowed_agents
                self.allowed_scopes = allowed_scopes
                self._input_model = input_model
                self._ctx_params = ctx_params
                self._func = func
                self._parallel_spec = parallel
                self._redact_fields = redact_fields
                self.read_only = read_only
                self.risk = risk
                self.resource = resource
                if policy is not None:
                    self.policy = policy

            def supports_parallel(self, args: dict[str, Any]) -> bool:
                if callable(self._parallel_spec):
                    return bool(self._parallel_spec(args))
                return bool(self._parallel_spec)

            def input_schema(self) -> dict[str, Any]:
                return self._input_model.model_json_schema()

            def redact(self, args: dict[str, Any]) -> dict[str, Any]:
                if not self._redact_fields:
                    return dict(args)
                return {
                    k: ("[REDACTED]" if k in self._redact_fields else v) for k, v in args.items()
                }

            async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any:
                validated = self._input_model.model_validate(args)
                kwargs = validated.model_dump()
                for p in self._ctx_params:
                    kwargs[p] = ctx
                return await self._func(**kwargs)

        concrete = _ConcreteTool()
        _REGISTRY[tool_name] = concrete
        return concrete  # type: ignore[return-value]

    return decorator


def _clear_registry_for_tests() -> None:
    """TEST ONLY — reset the registry between tests."""
    _REGISTRY.clear()


__all__ = [
    "Tool",
    "ToolContext",
    "_clear_registry_for_tests",
    "get_tool",
    "get_tools_for_agent",
    "hash_input",
    "tool",
]
