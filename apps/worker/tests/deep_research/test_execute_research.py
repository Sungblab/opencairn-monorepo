"""``execute_deep_research`` — the 20-60 min executing phase.

The activity:
  1. Starts a non-collaborative interaction with previous_interaction_id
     set to the approved plan's id (the SDK's ``create`` returns an
     ``Interaction`` — there is no ``stream`` kwarg; streaming happens
     through the separate ``stream_interaction`` call).
  2. Consumes stream_interaction events; each is forwarded via on_event.
  3. Collects images + citations in order.
  4. After the stream closes, fetches the final state and returns the
     consolidated report.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, AsyncGenerator

import pytest

from worker.activities.deep_research.execute_research import (
    ExecuteResearchInput,
    ExecuteResearchOutput,
    _run_execute_research,
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


@dataclass
class _FakeEvent:
    event_id: str
    kind: str
    payload: dict[str, Any]


class _FakeProvider:
    def __init__(self, events: list[_FakeEvent], final_state: _FakeState) -> None:
        self._handle = _FakeHandle(
            id="int-exec", agent="deep-research-preview-04-2026"
        )
        self._events = list(events)
        self._final = final_state
        self.start_calls: list[dict[str, Any]] = []

    async def start_interaction(self, **kwargs):
        self.start_calls.append(kwargs)
        return self._handle

    async def stream_interaction(self, _interaction_id, *, last_event_id=None):
        events_copy = list(self._events)

        async def _gen() -> AsyncGenerator[_FakeEvent, None]:
            for ev in events_copy:
                yield ev

        return _gen()

    async def get_interaction(self, _interaction_id):
        return self._final


async def _fake_fetch(_user_id: str) -> bytes | None:
    return None


def test_happy_path_streams_and_collects(monkeypatch):
    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake")

    events = [
        _FakeEvent("1", "thought_summary", {"text": "considering X"}),
        _FakeEvent("2", "text", {"text": "Report body... "}),
        _FakeEvent(
            "3", "image", {"url": "gs://img/a.png", "mime_type": "image/png"}
        ),
        _FakeEvent("4", "text", {"text": "more body."}),
        _FakeEvent(
            "5",
            "citation",
            {"url": "https://example.com/s1", "title": "Source 1"},
        ),
        _FakeEvent("6", "status", {"status": "completed"}),
    ]
    final = _FakeState(
        id="int-exec",
        status="completed",
        outputs=[{"type": "text", "text": "Report body... more body."}],
    )
    provider = _FakeProvider(events, final)

    forwarded: list[tuple[str, dict]] = []
    heartbeats: list[None] = []

    async def on_event(kind, payload):
        forwarded.append((kind, payload))

    def on_heartbeat():
        heartbeats.append(None)

    result = asyncio.run(
        _run_execute_research(
            ExecuteResearchInput(
                run_id="run-1",
                user_id="user-1",
                approved_plan="Go do research.",
                model="deep-research-preview-04-2026",
                billing_path="managed",
                previous_interaction_id="int-plan",
            ),
            provider_factory=lambda _api_key: provider,
            fetch_byok_ciphertext=_fake_fetch,
            on_event=on_event,
            on_heartbeat=on_heartbeat,
        )
    )

    assert isinstance(result, ExecuteResearchOutput)
    assert result.interaction_id == "int-exec"
    assert result.report_text == "Report body... more body."
    assert [i["url"] for i in result.images] == ["gs://img/a.png"]
    assert [c["url"] for c in result.citations] == ["https://example.com/s1"]

    call = provider.start_calls[0]
    assert call["collaborative_planning"] is False
    assert call["background"] is True
    assert call["visualization"] == "auto"
    assert call["thinking_summaries"] == "auto"
    assert call["previous_interaction_id"] == "int-plan"
    assert "stream" not in call  # SDK drops stream kwarg — streaming is via stream_interaction()

    # status events are not forwarded; the other 5 are.
    assert len(forwarded) == 5
    # heartbeat called at least once (initial) plus once per event.
    assert len(heartbeats) >= 1


def test_failed_final_state_raises(monkeypatch):
    from temporalio.exceptions import ApplicationError

    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake")
    events = [_FakeEvent("1", "status", {"status": "failed"})]
    final = _FakeState(
        id="int-exec",
        status="failed",
        outputs=[],
        error={"code": "timeout", "message": "60min limit"},
    )
    provider = _FakeProvider(events, final)

    async def _noop(_kind, _payload):
        return

    with pytest.raises(ApplicationError) as excinfo:
        asyncio.run(
            _run_execute_research(
                ExecuteResearchInput(
                    run_id="run-1",
                    user_id="user-1",
                    approved_plan="plan",
                    model="deep-research-preview-04-2026",
                    billing_path="managed",
                    previous_interaction_id="int-plan",
                ),
                provider_factory=lambda _api_key: provider,
                fetch_byok_ciphertext=_fake_fetch,
                on_event=_noop,
                on_heartbeat=lambda: None,
            )
        )
    # timeout is retryable (different class of error from quota/auth).
    assert excinfo.value.type == "timeout"
    assert excinfo.value.non_retryable is False


def test_quota_exceeded_is_non_retryable(monkeypatch):
    from temporalio.exceptions import ApplicationError

    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake")
    events = [_FakeEvent("1", "status", {"status": "failed"})]
    final = _FakeState(
        id="int-exec",
        status="failed",
        outputs=[],
        error={"code": "quota_exceeded", "message": "over quota"},
    )
    provider = _FakeProvider(events, final)

    async def _noop(_kind, _payload):
        return

    with pytest.raises(ApplicationError) as excinfo:
        asyncio.run(
            _run_execute_research(
                ExecuteResearchInput(
                    run_id="run-1",
                    user_id="user-1",
                    approved_plan="plan",
                    model="deep-research-preview-04-2026",
                    billing_path="managed",
                    previous_interaction_id="int-plan",
                ),
                provider_factory=lambda _api_key: provider,
                fetch_byok_ciphertext=_fake_fetch,
                on_event=_noop,
                on_heartbeat=lambda: None,
            )
        )
    assert excinfo.value.type == "quota_exceeded"
    assert excinfo.value.non_retryable is True



# --- S4-008 regression: production wiring URL paths ---------------------


def test_default_persist_event_posts_to_api_internal_artifacts(monkeypatch):
    """Streamed artifacts must land at /api/internal/research/runs/:id/artifacts.

    The Hono router mounts internal routes at `/api/internal`, so the
    historical `/internal/...` form silently 404s and the worker's
    `except Exception: pass` swallows the failure (audit S4-008).
    """
    from worker.activities.deep_research import execute_research as mod

    captured: list[tuple[str, dict]] = []

    async def _capturing_post(path: str, body: dict) -> dict:
        captured.append((path, body))
        return {}

    class _StubActivityInfo:
        workflow_id = "run-abc"

    def _stub_info() -> _StubActivityInfo:
        return _StubActivityInfo()

    def _in_activity() -> bool:
        return False

    monkeypatch.setenv("INTERNAL_API_SECRET", "test-secret")
    monkeypatch.setattr(
        "worker.lib.api_client.post_internal", _capturing_post,
    )
    monkeypatch.setattr(mod.activity, "info", _stub_info)
    monkeypatch.setattr(mod.activity, "in_activity", _in_activity)

    asyncio.run(mod._default_persist_event("text_delta", {"text": "hello"}))

    assert len(captured) == 1
    path, body = captured[0]
    assert path == "/api/internal/research/runs/run-abc/artifacts"
    assert body == {"kind": "text_delta", "payload": {"text": "hello"}}
