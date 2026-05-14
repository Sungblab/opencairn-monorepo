"""AgentEvent model tests — construction, serialization, discriminated union parsing."""
from __future__ import annotations

import json

import pytest
from pydantic import TypeAdapter, ValidationError

from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    AwaitingInput,
    CustomEvent,
    Handoff,
    ModelEnd,
    ToolResult,
    ToolUse,
)

BASE = {"run_id": "r1", "workspace_id": "w1", "agent_name": "test", "seq": 0, "ts": 1700000000.0}


def test_agent_start_roundtrip() -> None:
    ev = AgentStart(**BASE, type="agent_start", scope="page", input={"q": "hi"})
    raw = ev.model_dump_json()
    parsed = TypeAdapter(AgentEvent).validate_json(raw)
    assert isinstance(parsed, AgentStart)
    assert parsed.scope == "page"


def test_agent_end_duration() -> None:
    ev = AgentEnd(**BASE, type="agent_end", output={"answer": "x"}, duration_ms=1234)
    assert ev.duration_ms == 1234


def test_model_end_cost() -> None:
    ev = ModelEnd(
        **BASE,
        type="model_end",
        model_id="gemini-3-pro",
        prompt_tokens=100,
        completion_tokens=50,
        cached_tokens=0,
        cost_krw=12,
        finish_reason="stop",
        latency_ms=800,
    )
    assert ev.cost_krw == 12


def test_tool_use_hash_is_string() -> None:
    ev = ToolUse(
        **BASE,
        type="tool_use",
        tool_call_id="call-1",
        tool_name="search_pages",
        input_args={"query": "test"},
        input_hash="abc123",
        concurrency_safe=True,
    )
    assert ev.input_hash == "abc123"


def test_tool_result_matches_use() -> None:
    ev = ToolResult(
        **BASE,
        type="tool_result",
        tool_call_id="call-1",
        ok=True,
        output=[{"id": "p1"}],
        duration_ms=42,
    )
    assert ev.ok is True


def test_handoff_has_child_run_id() -> None:
    ev = Handoff(
        **BASE,
        type="handoff",
        from_agent="compiler",
        to_agent="research",
        child_run_id="r2",
        scope="project",
        reason="page search needed",
    )
    assert ev.to_agent == "research"


def test_awaiting_input_has_interrupt_id() -> None:
    ev = AwaitingInput(
        **BASE,
        type="awaiting_input",
        interrupt_id="int-1",
        prompt="Approve?",
        schema=None,
    )
    assert ev.interrupt_id == "int-1"


def test_agent_error_retryable_flag() -> None:
    ev = AgentError(
        **BASE,
        type="agent_error",
        error_class="ToolTimeout",
        message="search timed out",
        retryable=True,
    )
    assert ev.retryable is True


def test_custom_event_label() -> None:
    ev = CustomEvent(**BASE, type="custom", label="progress", payload={"pct": 50})
    assert ev.label == "progress"


def test_discriminator_rejects_unknown_type() -> None:
    bad = json.dumps({**BASE, "type": "nonexistent"})
    with pytest.raises(ValidationError):
        TypeAdapter(AgentEvent).validate_json(bad)


def test_seq_monotonic_not_enforced_at_model_level() -> None:
    """seq is monotonic by convention; the model itself doesn't enforce sequencing."""
    ev1 = AgentStart(**{**BASE, "seq": 5}, type="agent_start", scope="page", input={})
    ev2 = AgentEnd(**{**BASE, "seq": 3}, type="agent_end", output={}, duration_ms=1)
    assert ev1.seq == 5
    assert ev2.seq == 3
