"""Temporal integration helpers."""
from __future__ import annotations


def make_thread_id(workflow_id: str, agent_name: str, parent_run_id: str | None) -> str:
    """Agent thread_id naming convention.

    - Standalone:   "{workflow_id}:{agent_name}"
    - Sub-agent:    "{parent_run_id}:{agent_name}"

    Invariant: at most one Temporal activity writes to a given thread_id concurrently.
    """
    if parent_run_id:
        return f"{parent_run_id}:{agent_name}"
    return f"{workflow_id}:{agent_name}"


class AgentAwaitingInputError(Exception):
    """Raised inside an activity when the agent yields AwaitingInput.

    Must be added to Temporal RetryPolicy.non_retryable_error_types so the
    workflow wrapper catches it and waits for a signal instead of retrying.
    """

    def __init__(self, *, interrupt_id: str, prompt: str) -> None:
        super().__init__(f"AgentAwaitingInputError(interrupt_id={interrupt_id!r})")
        self.interrupt_id = interrupt_id
        self.prompt = prompt


__all__ = ["AgentAwaitingInputError", "make_thread_id"]
