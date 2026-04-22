"""Data types for the Google Gemini **Interactions API** (Deep Research).

These are the boundary types exchanged between ``packages/llm`` providers
and callers (agents, Temporal activities). They mirror the essentials of
``google.genai`` interaction objects without leaking SDK types outward —
callers see plain dataclasses, never vendor enums.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# Mirrors the SDK ``Interaction.status`` Literal verbatim — string values must
# match what ``google.genai._interactions.types.interaction.Interaction.status``
# emits, otherwise ``mypy``/``pyright`` will reject assignment from real
# responses and runtime equality checks against the SDK strings will silently
# diverge. Source of truth: SDK ``interaction.py``.
InteractionStatus = Literal[
    "in_progress",
    "requires_action",
    "completed",
    "failed",
    "cancelled",
    "incomplete",
]

# Mirrors the SDK ``InteractionSSEEvent`` ``event_type`` discriminator — one of
# the seven SSE variant names. Anything else means a new SDK version added a
# variant we haven't mapped yet. Source of truth: SDK ``interaction_sse_event.py``.
InteractionEventKind = Literal[
    "interaction.start",
    "interaction.complete",
    "interaction.status_update",
    "content.start",
    "content.delta",
    "content.stop",
    "error",
]


@dataclass
class InteractionHandle:
    """Opaque handle returned by ``start_interaction``."""

    id: str
    agent: str
    background: bool


@dataclass
class InteractionState:
    """Snapshot of an interaction at one point in time.

    ``error`` is intentionally kept on the boundary type even though the SDK
    ``Interaction`` schema has no ``error`` field: the server can still attach
    one via pydantic ``extra="allow"`` for non-spec failure modes, and the
    streaming ``ErrorEvent`` carries the same shape. Normal completed / failed
    interactions leave this ``None``.
    """

    id: str
    status: InteractionStatus
    outputs: list[dict[str, Any]] = field(default_factory=list)
    error: dict[str, Any] | None = None


@dataclass
class InteractionEvent:
    """One event from a streaming interaction.

    ``kind`` is the SDK ``event_type`` discriminator verbatim. ``payload``
    carries the variant-specific fields (``delta`` / ``interaction`` / ``error``
    / ``content`` / ``status``) as a plain dict — providers do
    ``model_dump()`` so callers never see SDK BaseModel instances.
    """

    event_id: str
    kind: InteractionEventKind
    payload: dict[str, Any]
