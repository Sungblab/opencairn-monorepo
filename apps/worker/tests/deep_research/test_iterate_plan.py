"""``iterate_deep_research_plan`` activity — user-feedback turn.

Differs from create_plan only in that ``previous_interaction_id`` is set
so Google chains against the prior plan.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from worker.activities.deep_research.iterate_plan import (
    IteratePlanInput,
    IteratePlanOutput,
    _run_iterate_plan,
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
            id="int-2", agent="deep-research-preview-04-2026"
        )
        self._states = list(states)
        self.start_calls: list[dict[str, Any]] = []

    async def start_interaction(self, **kwargs):
        self.start_calls.append(kwargs)
        return self._handle

    async def get_interaction(self, _interaction_id):
        return self._states.pop(0)


async def _fake_fetch(_user_id: str) -> bytes | None:
    return None


def test_iterate_passes_previous_interaction_id(monkeypatch):
    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake")
    provider = _FakeProvider(
        states=[
            _FakeState(
                id="int-2",
                status="completed",
                outputs=[{"type": "text", "text": "Plan v2"}],
            ),
        ]
    )

    result = asyncio.run(
        _run_iterate_plan(
            IteratePlanInput(
                run_id="run-1",
                user_id="user-1",
                feedback="Please add section C.",
                model="deep-research-preview-04-2026",
                billing_path="managed",
                previous_interaction_id="int-1",
            ),
            provider_factory=lambda _api_key: provider,
            fetch_byok_ciphertext=_fake_fetch,
            poll_interval_seconds=0,
        )
    )
    assert isinstance(result, IteratePlanOutput)
    assert result.plan_text == "Plan v2"
    assert provider.start_calls[0]["previous_interaction_id"] == "int-1"
    assert provider.start_calls[0]["collaborative_planning"] is True
    assert provider.start_calls[0]["background"] is True
