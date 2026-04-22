"""``create_deep_research_plan`` activity — first turn of a run.

The activity:
  1. Resolves the API key (byok or managed).
  2. Calls ``GeminiProvider.start_interaction(collaborative_planning=True)``.
  3. Polls ``get_interaction`` every 5 s (0 s in tests) until completed.
  4. Returns the plan text + interaction id.

Tests use a fake provider + factory so we don't hit Google.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import pytest

from worker.activities.deep_research.create_plan import (
    CreatePlanInput,
    CreatePlanOutput,
    _run_create_plan,
)


@dataclass
class _FakeHandle:
    id: str
    agent: str
    background: bool = True


@dataclass
class _FakeState:
    id: str
    status: str
    outputs: list[dict[str, Any]]
    error: dict[str, Any] | None = None


class _FakeProvider:
    def __init__(self, states: list[_FakeState]) -> None:
        self._handle = _FakeHandle(
            id="int-1", agent="deep-research-preview-04-2026"
        )
        self._states = list(states)
        self.start_calls: list[dict[str, Any]] = []

    async def start_interaction(self, **kwargs):
        self.start_calls.append(kwargs)
        return self._handle

    async def get_interaction(self, interaction_id: str):
        assert interaction_id == "int-1"
        return self._states.pop(0)


async def _fake_fetch(_user_id: str) -> bytes | None:
    # Managed path in all these tests; byok fetcher is unused.
    return None


def test_happy_path_returns_plan(monkeypatch):
    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake-managed")

    provider = _FakeProvider(
        states=[
            _FakeState(id="int-1", status="running", outputs=[]),
            _FakeState(
                id="int-1",
                status="completed",
                outputs=[{"type": "text", "text": "Plan: do A, then B."}],
            ),
        ]
    )

    result = asyncio.run(
        _run_create_plan(
            CreatePlanInput(
                run_id="run-1",
                user_id="user-1",
                topic="What is X?",
                model="deep-research-preview-04-2026",
                billing_path="managed",
            ),
            provider_factory=lambda _api_key: provider,
            fetch_byok_ciphertext=_fake_fetch,
            poll_interval_seconds=0,
        )
    )

    assert isinstance(result, CreatePlanOutput)
    assert result.interaction_id == "int-1"
    assert "do A" in result.plan_text
    # collaborative_planning + background must be True for the planning step.
    assert provider.start_calls[0]["collaborative_planning"] is True
    assert provider.start_calls[0]["background"] is True


def test_fails_fast_on_failed_status(monkeypatch):
    from temporalio.exceptions import ApplicationError

    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake-managed")
    provider = _FakeProvider(
        states=[
            _FakeState(
                id="int-1",
                status="failed",
                outputs=[],
                error={"code": "quota_exceeded", "message": "over quota"},
            ),
        ]
    )

    with pytest.raises(ApplicationError) as excinfo:
        asyncio.run(
            _run_create_plan(
                CreatePlanInput(
                    run_id="run-1",
                    user_id="user-1",
                    topic="X?",
                    model="deep-research-preview-04-2026",
                    billing_path="managed",
                ),
                provider_factory=lambda _api_key: provider,
                fetch_byok_ciphertext=_fake_fetch,
                poll_interval_seconds=0,
            )
        )
    assert excinfo.value.non_retryable is True
    assert "quota_exceeded" in str(excinfo.value)


def test_key_resolution_failure_is_non_retryable(monkeypatch):
    from temporalio.exceptions import ApplicationError

    monkeypatch.delenv("GEMINI_MANAGED_API_KEY", raising=False)
    provider = _FakeProvider(states=[])

    with pytest.raises(ApplicationError) as excinfo:
        asyncio.run(
            _run_create_plan(
                CreatePlanInput(
                    run_id="run-1",
                    user_id="user-1",
                    topic="X?",
                    model="deep-research-preview-04-2026",
                    billing_path="managed",
                ),
                provider_factory=lambda _api_key: provider,
                fetch_byok_ciphertext=_fake_fetch,
                poll_interval_seconds=0,
            )
        )
    assert excinfo.value.non_retryable is True


def test_empty_plan_is_non_retryable_error(monkeypatch):
    from temporalio.exceptions import ApplicationError

    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake-managed")
    provider = _FakeProvider(
        states=[_FakeState(id="int-1", status="completed", outputs=[])]
    )

    with pytest.raises(ApplicationError) as excinfo:
        asyncio.run(
            _run_create_plan(
                CreatePlanInput(
                    run_id="run-1",
                    user_id="user-1",
                    topic="X?",
                    model="deep-research-preview-04-2026",
                    billing_path="managed",
                ),
                provider_factory=lambda _api_key: provider,
                fetch_byok_ciphertext=_fake_fetch,
                poll_interval_seconds=0,
            )
        )
    assert excinfo.value.non_retryable is True
    assert excinfo.value.type == "empty_plan"
