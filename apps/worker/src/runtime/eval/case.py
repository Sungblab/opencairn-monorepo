"""EvalCase data models."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ExpectedToolCall(BaseModel):
    tool_name: str
    args_match: dict[str, Any] | None = None
    args_ignore: list[str] = Field(default_factory=list)
    required: bool = True


class ExpectedHandoff(BaseModel):
    to_agent: str
    required: bool = True


class EvalCase(BaseModel):
    id: str
    description: str
    agent: str
    scope: Literal["page", "project", "workspace"]

    input: dict[str, Any]
    fixture: str | None = None

    expected_tools: list[ExpectedToolCall] = Field(default_factory=list)
    expected_handoffs: list[ExpectedHandoff] = Field(default_factory=list)
    forbidden_tools: list[str] = Field(default_factory=list)

    response_contains: list[str] = Field(default_factory=list)
    response_match_llm: str | None = None

    max_duration_ms: int = 60_000
    max_cost_krw: int = 1000
    max_tool_calls: int = 20


__all__ = ["EvalCase", "ExpectedHandoff", "ExpectedToolCall"]
