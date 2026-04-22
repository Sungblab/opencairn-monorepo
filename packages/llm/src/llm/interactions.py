"""Data types for the Google Gemini **Interactions API** (Deep Research).

These are the boundary types exchanged between ``packages/llm`` providers
and callers (agents, Temporal activities). They mirror the essentials of
``google.genai`` interaction objects without leaking SDK types outward —
callers see plain dataclasses, never vendor enums.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

InteractionStatus = Literal[
    "queued", "running", "completed", "failed", "cancelled"
]

InteractionEventKind = Literal[
    "thought_summary", "text", "image", "status"
]


@dataclass
class InteractionHandle:
    """Opaque handle returned by ``start_interaction``."""

    id: str
    agent: str
    background: bool


@dataclass
class InteractionState:
    """Snapshot of an interaction at one point in time."""

    id: str
    status: InteractionStatus
    outputs: list[dict[str, Any]] = field(default_factory=list)
    error: dict[str, Any] | None = None


@dataclass
class InteractionEvent:
    """One event from a streaming interaction."""

    event_id: str
    kind: InteractionEventKind
    payload: dict[str, Any]
