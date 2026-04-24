"""Tests for :func:`llm.embed_helper.embed_many`.

These are pure-Python — no Temporal, no network — because ``embed_many``
must stay orchestration-free. The worker-side integration (batch_submit
callback wired to a Temporal child workflow) is tested separately in
``apps/worker/tests/``.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from llm.base import EmbedInput, LLMProvider, ProviderConfig
from llm.batch_types import BatchNotSupported
from llm.embed_helper import (
    DEFAULT_MIN_ITEMS,
    ENV_BATCH_ENABLED_COMPILER,
    ENV_BATCH_ENABLED_LIBRARIAN,
    ENV_BATCH_MIN_ITEMS,
    embed_many,
)


class _StubProvider(LLMProvider):
    def __init__(self, *, supports_batch: bool):
        super().__init__(
            ProviderConfig(provider="stub", api_key="x", model="m", embed_model="e")
        )
        self._supports = supports_batch
        # Track calls — we need both "was it awaited" and the ability to
        # override behaviour per-subclass, so wrap the real impl in a mock.
        self.embed_mock = AsyncMock(wraps=self._embed_impl)

    @property
    def supports_batch_embed(self) -> bool:
        return self._supports

    async def generate(self, messages, **kwargs):
        raise NotImplementedError

    async def embed(self, inputs):
        return await self.embed_mock(inputs)

    async def _embed_impl(self, inputs):
        return [[0.1] * 4 for inp in inputs if inp.text]


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch):
    # Each test picks the flag state it wants; clearing avoids accidental
    # inheritance from a developer's shell.
    monkeypatch.delenv(ENV_BATCH_ENABLED_COMPILER, raising=False)
    monkeypatch.delenv(ENV_BATCH_ENABLED_LIBRARIAN, raising=False)
    monkeypatch.delenv(ENV_BATCH_MIN_ITEMS, raising=False)


async def _noop_submit(inputs, *, workspace_id):
    raise AssertionError("batch_submit should not be called in this test")


@pytest.mark.asyncio
async def test_empty_inputs_returns_empty_without_calling_provider():
    p = _StubProvider(supports_batch=True)
    out = await embed_many(p, [], workspace_id=None)
    assert out == []
    p.embed_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_batch_submit_takes_sync_path(monkeypatch):
    # Callers running outside the worker (scripts, tests) pass
    # batch_submit=None and always hit the sync path.
    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    p = _StubProvider(supports_batch=True)
    out = await embed_many(
        p,
        [EmbedInput(text="a"), EmbedInput(text="b")],
        workspace_id="ws1",
    )
    assert out == [[0.1] * 4, [0.1] * 4]
    p.embed_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_flag_off_takes_sync_path():
    p = _StubProvider(supports_batch=True)
    submit = AsyncMock()
    out = await embed_many(
        p,
        [EmbedInput(text=str(i)) for i in range(20)],
        workspace_id="ws1",
        batch_submit=submit,
    )
    assert len(out) == 20
    submit.assert_not_awaited()
    p.embed_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_below_min_items_takes_sync_path(monkeypatch):
    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    p = _StubProvider(supports_batch=True)
    submit = AsyncMock()
    # Below DEFAULT_MIN_ITEMS=8 — batch is lost cost-wise and ingest loses
    # to 24h SLA for no gain.
    items = [EmbedInput(text=str(i)) for i in range(DEFAULT_MIN_ITEMS - 1)]
    await embed_many(p, items, workspace_id="ws1", batch_submit=submit)
    submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_provider_unsupported_takes_sync_path(monkeypatch):
    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    p = _StubProvider(supports_batch=False)
    submit = AsyncMock()
    items = [EmbedInput(text=str(i)) for i in range(10)]
    await embed_many(p, items, workspace_id="ws1", batch_submit=submit)
    submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_eligible_takes_batch_path(monkeypatch):
    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    p = _StubProvider(supports_batch=True)
    submit = AsyncMock(return_value=[[0.5] * 4 for _ in range(10)])
    items = [EmbedInput(text=str(i)) for i in range(10)]
    out = await embed_many(
        p,
        items,
        workspace_id="ws1",
        batch_submit=submit,
    )
    submit.assert_awaited_once()
    assert out == [[0.5] * 4 for _ in range(10)]
    # Sync path must NOT be touched when the batch path succeeded.
    p.embed_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_batch_not_supported_falls_back_to_sync(monkeypatch):
    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    p = _StubProvider(supports_batch=True)

    async def raising_submit(inputs, *, workspace_id):
        raise BatchNotSupported("no credential for batch")

    items = [EmbedInput(text=str(i)) for i in range(10)]
    out = await embed_many(
        p,
        items,
        workspace_id=None,
        batch_submit=raising_submit,
    )
    assert len(out) == 10
    p.embed_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_batch_runtime_error_falls_back_to_sync(monkeypatch):
    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    p = _StubProvider(supports_batch=True)

    async def exploding_submit(inputs, *, workspace_id):
        raise RuntimeError("workflow retry exhausted")

    items = [EmbedInput(text=str(i)) for i in range(10)]
    out = await embed_many(
        p, items, workspace_id=None, batch_submit=exploding_submit
    )
    assert len(out) == 10
    p.embed_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_fallback_emits_structured_event_with_reason(monkeypatch, caplog):
    """Plan 3b observability: every fallback produces one structured
    ``batch_embed.fallback`` WARNING so ops dashboards can count
    fallback rate per reason. Two branches:
      - BatchNotSupported → reason=provider_unsupported
      - other Exception  → reason=batch_failed
    """
    import logging

    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    p = _StubProvider(supports_batch=True)

    async def raising_submit(inputs, *, workspace_id):
        raise BatchNotSupported("no credential for batch")

    items = [EmbedInput(text=str(i)) for i in range(10)]
    with caplog.at_level(logging.WARNING, logger="batch_embed.fallback"):
        await embed_many(
            p, items, workspace_id="ws-42", batch_submit=raising_submit
        )

    records = [
        r
        for r in caplog.records
        if r.__dict__.get("event") == "batch_embed.fallback"
    ]
    assert len(records) == 1
    assert records[0].__dict__["reason"] == "provider_unsupported"
    assert records[0].__dict__["input_count"] == 10
    assert records[0].__dict__["workspace_id"] == "ws-42"
    assert records[0].levelno == logging.WARNING

    caplog.clear()

    async def exploding_submit(inputs, *, workspace_id):
        raise RuntimeError("workflow retry exhausted")

    with caplog.at_level(logging.WARNING, logger="batch_embed.fallback"):
        await embed_many(
            p, items, workspace_id="ws-42", batch_submit=exploding_submit
        )

    records = [
        r
        for r in caplog.records
        if r.__dict__.get("event") == "batch_embed.fallback"
    ]
    assert len(records) == 1
    assert records[0].__dict__["reason"] == "batch_failed"


@pytest.mark.asyncio
async def test_per_agent_flag_independence(monkeypatch):
    # Librarian ON but caller passes the Compiler flag — must not batch.
    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    monkeypatch.delenv(ENV_BATCH_ENABLED_COMPILER, raising=False)
    p = _StubProvider(supports_batch=True)
    submit = AsyncMock(return_value=[[0.5] * 4 for _ in range(10)])
    items = [EmbedInput(text=str(i)) for i in range(10)]
    await embed_many(
        p,
        items,
        workspace_id=None,
        batch_submit=submit,
        flag_env=ENV_BATCH_ENABLED_COMPILER,
    )
    submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_custom_min_items_threshold(monkeypatch):
    monkeypatch.setenv(ENV_BATCH_ENABLED_LIBRARIAN, "true")
    monkeypatch.setenv(ENV_BATCH_MIN_ITEMS, "3")
    p = _StubProvider(supports_batch=True)
    submit = AsyncMock(return_value=[[0.5] * 4 for _ in range(3)])
    items = [EmbedInput(text=str(i)) for i in range(3)]
    out = await embed_many(p, items, workspace_id=None, batch_submit=submit)
    submit.assert_awaited_once()
    assert len(out) == 3


@pytest.mark.asyncio
async def test_sync_fallback_aligns_missing_text_items(monkeypatch):
    p = _StubProvider(supports_batch=False)
    # Items 0 and 2 have text, item 1 has no text — provider.embed will
    # return 2 vectors and the helper must slot None at index 1.
    items = [EmbedInput(text="a"), EmbedInput(text=None), EmbedInput(text="b")]
    out = await embed_many(p, items, workspace_id=None)
    assert len(out) == 3
    assert out[0] is not None
    assert out[1] is None
    assert out[2] is not None


@pytest.mark.asyncio
async def test_sync_fallback_bulk_failure_retries_per_item(monkeypatch):
    """Regression guard — in master (pre-3b), each concept's embed was
    isolated via a caller-side try/except. After Plan 3b we issue one
    bulk provider.embed call. If that raises we MUST retry per item so
    a single poison input doesn't wipe out every concept extracted from
    a note. Otherwise one transient 5xx drops the whole note to zero
    concepts silently.
    """
    call_log: list[int] = []

    class PartiallyFailingProvider(_StubProvider):
        async def _embed_impl(self, inputs):
            call_log.append(len(inputs))
            # Bulk call (3 items) raises — simulates one of them being
            # too long / malformed so the whole batch rejects.
            if len(inputs) > 1:
                raise RuntimeError("bulk too large")
            # Per-item: first one succeeds, second raises, third succeeds.
            if inputs[0].text == "bad":
                raise RuntimeError("individually rejected")
            return [[0.1] * 4]

    p = PartiallyFailingProvider(supports_batch=False)
    items = [
        EmbedInput(text="good"),
        EmbedInput(text="bad"),
        EmbedInput(text="also-good"),
    ]
    out = await embed_many(p, items, workspace_id=None)
    # Expectation: the failing bulk call triggers per-item retry; "good"
    # and "also-good" still embed, only "bad" becomes None.
    assert out[0] is not None
    assert out[1] is None
    assert out[2] is not None
    # The bulk attempt (3) + per-item retries (3) = 4 calls total.
    assert call_log == [3, 1, 1, 1]


@pytest.mark.asyncio
async def test_sync_fallback_all_items_fail_returns_all_none(monkeypatch):
    class ExplodingProvider(_StubProvider):
        async def _embed_impl(self, inputs):
            raise RuntimeError("network down")

    p = ExplodingProvider(supports_batch=False)
    items = [EmbedInput(text="a"), EmbedInput(text="b")]
    out = await embed_many(p, items, workspace_id=None)
    # Bulk fails → per-item also fails for each → all None (but we did
    # try per-item before giving up; that's the key difference vs the
    # bulk-only sync path).
    assert out == [None, None]
