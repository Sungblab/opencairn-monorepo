"""AgentEvent schema — 9 event types + discriminated union.

All events flow through hooks and land in NDJSON trajectory + Postgres summary.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field


class BaseEvent(BaseModel):
    """Common fields on every event. seq is monotonic per run_id."""

    run_id: str
    workspace_id: str
    agent_name: str
    seq: int
    ts: float
    parent_seq: int | None = None


Scope = Literal["page", "project", "workspace"]


class AgentStart(BaseEvent):
    type: Literal["agent_start"] = "agent_start"
    scope: Scope
    input: dict[str, Any]
    parent_run_id: str | None = None


class AgentEnd(BaseEvent):
    type: Literal["agent_end"] = "agent_end"
    output: dict[str, Any]
    duration_ms: int


class AgentError(BaseEvent):
    type: Literal["agent_error"] = "agent_error"
    error_class: str
    message: str
    retryable: bool


class ModelEnd(BaseEvent):
    type: Literal["model_end"] = "model_end"
    model_id: str
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int = 0
    cost_krw: int
    finish_reason: str
    latency_ms: int


class ToolUse(BaseEvent):
    type: Literal["tool_use"] = "tool_use"
    tool_call_id: str
    tool_name: str
    input_args: dict[str, Any]
    input_hash: str
    concurrency_safe: bool


class ToolResult(BaseEvent):
    type: Literal["tool_result"] = "tool_result"
    tool_call_id: str
    ok: bool
    output: Any
    duration_ms: int
    cached: bool = False


class Handoff(BaseEvent):
    type: Literal["handoff"] = "handoff"
    from_agent: str
    to_agent: str
    child_run_id: str
    scope: Scope
    reason: str


class AwaitingInput(BaseEvent):
    type: Literal["awaiting_input"] = "awaiting_input"
    interrupt_id: str
    prompt: str
    schema: dict[str, Any] | None = None


class CustomEvent(BaseEvent):
    type: Literal["custom"] = "custom"
    label: str
    payload: dict[str, Any]


AgentEvent = Annotated[
    AgentStart
    | AgentEnd
    | AgentError
    | ModelEnd
    | ToolUse
    | ToolResult
    | Handoff
    | AwaitingInput
    | CustomEvent,
    Field(discriminator="type"),
]


__all__ = [
    "AgentEnd",
    "AgentError",
    "AgentEvent",
    "AgentStart",
    "AwaitingInput",
    "BaseEvent",
    "CustomEvent",
    "Handoff",
    "ModelEnd",
    "Scope",
    "ToolResult",
    "ToolUse",
]
