"""Tests for Temporal helpers."""
from __future__ import annotations

import pytest

from runtime.temporal import AgentAwaitingInputError, make_thread_id


def test_make_thread_id_standalone() -> None:
    assert make_thread_id("wf-1", "research", None) == "wf-1:research"


def test_make_thread_id_with_parent() -> None:
    assert make_thread_id("wf-1", "research", parent_run_id="r-parent") == "r-parent:research"


def test_awaiting_input_error_fields() -> None:
    err = AgentAwaitingInputError(interrupt_id="int-1", prompt="Approve?")
    assert err.interrupt_id == "int-1"
    assert err.prompt == "Approve?"
    assert str(err).startswith("AgentAwaitingInputError")


def test_awaiting_input_error_is_exception() -> None:
    with pytest.raises(AgentAwaitingInputError):
        raise AgentAwaitingInputError(interrupt_id="i", prompt="?")
