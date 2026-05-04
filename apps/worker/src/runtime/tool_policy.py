"""Policy metadata and permission decisions for runtime tool calls."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, Field

PermissionMode = Literal["read_only", "ask", "auto"]
PermissionAction = Literal["allow", "deny", "needs_approval"]
ToolRisk = Literal["read", "write", "network", "external", "sensitive", "destructive"]


class ToolPolicy(BaseModel):
    """Static or dynamically evaluated policy for a tool invocation."""

    read_only: bool = False
    risk: ToolRisk = "sensitive"
    resource: str | None = None
    reason: str | None = None


class PermissionDecision(BaseModel):
    """PermissionBroker output before a tool handler is invoked."""

    action: PermissionAction
    reason: str
    display_args: dict[str, Any] = Field(default_factory=dict)
    policy: ToolPolicy


def _coerce_policy(value: Any) -> ToolPolicy:
    if isinstance(value, ToolPolicy):
        return value
    if isinstance(value, Mapping):
        return ToolPolicy.model_validate(dict(value))
    return ToolPolicy.model_validate(value)


def get_tool_policy(tool: Any, args: dict[str, Any]) -> ToolPolicy:
    """Resolve optional tool policy metadata without requiring a protocol change."""

    raw_policy = getattr(tool, "policy", None)
    if raw_policy is not None:
        if callable(raw_policy):
            return _coerce_policy(raw_policy(args))
        return _coerce_policy(raw_policy)

    has_read_only = hasattr(tool, "read_only")
    has_risk = hasattr(tool, "risk")
    has_resource = hasattr(tool, "resource")
    if has_read_only or has_risk or has_resource:
        return ToolPolicy(
            read_only=bool(getattr(tool, "read_only", False)),
            risk=getattr(tool, "risk", "sensitive"),
            resource=getattr(tool, "resource", None),
        )

    return ToolPolicy(read_only=False, risk="sensitive")


class PermissionBroker:
    """Evaluate whether a tool call can run in the configured permission mode."""

    def __init__(self, mode: PermissionMode = "ask") -> None:
        self.mode = mode

    def evaluate(
        self,
        tool: Any,
        args: dict[str, Any],
        *,
        context: dict[str, Any] | None = None,
    ) -> PermissionDecision:
        del context
        policy = get_tool_policy(tool, args)
        display_args = dict(args)

        if policy.risk == "destructive":
            return PermissionDecision(
                action="deny",
                reason="destructive tools are not allowed",
                display_args=display_args,
                policy=policy,
            )

        if self.mode == "read_only":
            if policy.read_only:
                return PermissionDecision(
                    action="allow",
                    reason="read_only mode allows read-only tool",
                    display_args=display_args,
                    policy=policy,
                )
            return PermissionDecision(
                action="deny",
                reason="read_only mode blocks non-read-only tool",
                display_args=display_args,
                policy=policy,
            )

        if self.mode == "ask":
            if policy.read_only:
                return PermissionDecision(
                    action="allow",
                    reason="ask mode allows read-only tool",
                    display_args=display_args,
                    policy=policy,
                )
            return PermissionDecision(
                action="needs_approval",
                reason="ask mode requires approval for non-read-only tool",
                display_args=display_args,
                policy=policy,
            )

        return PermissionDecision(
            action="allow",
            reason="auto mode allows registered non-destructive tool",
            display_args=display_args,
            policy=policy,
        )


__all__ = [
    "PermissionAction",
    "PermissionBroker",
    "PermissionDecision",
    "PermissionMode",
    "ToolPolicy",
    "ToolRisk",
    "get_tool_policy",
]
