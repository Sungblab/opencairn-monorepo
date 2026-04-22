# Deep Research Phase A — `packages/llm` Interactions Wrapper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add async wrappers for the Google Gemini **Interactions API** (used by Deep Research / Deep Research Max `-04-2026` preview models) to `packages/llm`, so `apps/worker` can drive long-running, multi-turn research interactions via the standard `LLMProvider` surface.

**Architecture:** 4 new async methods on `LLMProvider` (default `NotImplementedError`) overridden by `GeminiProvider` as thin wrappers over `google-genai`'s `client.aio.interactions.*`. Ollama keeps the default `NotImplementedError`. New `packages/llm/src/llm/interactions.py` defines the shared dataclasses (`InteractionHandle`, `InteractionState`, `InteractionEvent`). No agent/workflow code is touched in this phase — that's Phase B.

**Tech Stack:** Python 3.12, `google-genai` SDK (async surface), `pytest` + `pytest-asyncio`, `unittest.mock` patches (no external network calls in tests, mirroring existing `packages/llm/tests/test_gemini.py` style).

**Spec:** `docs/superpowers/specs/2026-04-22-deep-research-integration-design.md` §4.4 + §6.

---

## File Structure

Each file has one clear responsibility. No file grows past ~200 lines.

- **Create `packages/llm/src/llm/interactions.py`** — dataclass types (`InteractionHandle`, `InteractionState`, `InteractionEvent`) + status literal. Zero provider logic.
- **Modify `packages/llm/src/llm/base.py`** — add 4 new `async` methods to `LLMProvider` with `raise NotImplementedError` defaults + import the new types.
- **Modify `packages/llm/src/llm/gemini.py`** — implement the 4 methods by delegating to `self._client.aio.interactions.*`.
- **Modify `packages/llm/src/llm/__init__.py`** — re-export the new public types.
- **Create `packages/llm/tests/test_interactions_types.py`** — pure dataclass round-trip tests (no mocks needed).
- **Create `packages/llm/tests/test_gemini_interactions.py`** — `GeminiProvider.start_interaction` / `get_interaction` / `stream_interaction` / `cancel_interaction` mocked-HTTP tests. Fixtures live under `packages/llm/tests/fixtures/interactions/` (new dir).
- **Modify `packages/llm/tests/test_ollama.py`** — 4 new tests verifying Ollama raises `NotImplementedError` on the new methods (defensive; Ollama does not support Deep Research).
- **Create `packages/llm/tests/fixtures/interactions/plan_response.json`** — fixture Google returns for collaborative planning step.
- **Create `packages/llm/tests/fixtures/interactions/running_state.json`** — fixture for `get_interaction` mid-execution.
- **Create `packages/llm/tests/fixtures/interactions/completed_state.json`** — fixture with text + image outputs.
- **Create `packages/llm/tests/fixtures/interactions/stream_events.jsonl`** — JSONL fixture of `thought_summary` → `text` → `image` event chain.

---

## Task 1: Add `InteractionHandle` / `InteractionState` / `InteractionEvent` dataclasses

**Files:**
- Create: `packages/llm/src/llm/interactions.py`
- Test: `packages/llm/tests/test_interactions_types.py`

- [ ] **Step 1: Write the failing tests**

Create `packages/llm/tests/test_interactions_types.py`:

```python
from llm.interactions import (
    InteractionEvent,
    InteractionHandle,
    InteractionState,
)


def test_handle_has_id_agent_background():
    h = InteractionHandle(id="int_1", agent="deep-research-preview-04-2026", background=True)
    assert h.id == "int_1"
    assert h.agent == "deep-research-preview-04-2026"
    assert h.background is True


def test_state_has_status_outputs_error():
    s = InteractionState(
        id="int_1",
        status="completed",
        outputs=[{"type": "text", "text": "hi"}],
    )
    assert s.status == "completed"
    assert s.outputs == [{"type": "text", "text": "hi"}]
    assert s.error is None


def test_state_error_shape():
    s = InteractionState(
        id="int_1",
        status="failed",
        outputs=[],
        error={"code": "quota_exhausted", "message": "…"},
    )
    assert s.status == "failed"
    assert s.error == {"code": "quota_exhausted", "message": "…"}


def test_event_payload_is_dict():
    ev = InteractionEvent(
        event_id="ev_1",
        kind="thought_summary",
        payload={"text": "decomposing"},
    )
    assert ev.event_id == "ev_1"
    assert ev.kind == "thought_summary"
    assert ev.payload["text"] == "decomposing"
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd packages/llm
uv run pytest tests/test_interactions_types.py -v
```

Expected: `ModuleNotFoundError: No module named 'llm.interactions'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/llm/src/llm/interactions.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```
cd packages/llm
uv run pytest tests/test_interactions_types.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```
git add packages/llm/src/llm/interactions.py packages/llm/tests/test_interactions_types.py
git commit -m "feat(llm): add interactions api dataclass types"
```

---

## Task 2: Add base-class hooks on `LLMProvider` (all raise `NotImplementedError`)

**Files:**
- Modify: `packages/llm/src/llm/base.py`
- Test: `packages/llm/tests/test_base.py` (extend existing)

- [ ] **Step 1: Write the failing tests**

Append to `packages/llm/tests/test_base.py`:

```python
import pytest
from llm.base import LLMProvider, ProviderConfig


class _StubProvider(LLMProvider):
    async def generate(self, messages, **kwargs):
        return ""

    async def embed(self, inputs):
        return []


@pytest.mark.asyncio
async def test_start_interaction_default_raises():
    p = _StubProvider(ProviderConfig(provider="stub"))
    with pytest.raises(NotImplementedError):
        await p.start_interaction(input="x", agent="deep-research-preview-04-2026")


@pytest.mark.asyncio
async def test_get_interaction_default_raises():
    p = _StubProvider(ProviderConfig(provider="stub"))
    with pytest.raises(NotImplementedError):
        await p.get_interaction("int_1")


@pytest.mark.asyncio
async def test_stream_interaction_default_raises():
    p = _StubProvider(ProviderConfig(provider="stub"))
    with pytest.raises(NotImplementedError):
        async for _ in p.stream_interaction("int_1"):
            pass


@pytest.mark.asyncio
async def test_cancel_interaction_default_raises():
    p = _StubProvider(ProviderConfig(provider="stub"))
    with pytest.raises(NotImplementedError):
        await p.cancel_interaction("int_1")
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd packages/llm
uv run pytest tests/test_base.py -v -k interaction
```

Expected: 4 failures — `AttributeError: '_StubProvider' object has no attribute 'start_interaction'`.

- [ ] **Step 3: Write the minimal implementation**

Edit `packages/llm/src/llm/base.py`. At the top of the file, add the import right after the existing imports:

```python
from collections.abc import AsyncGenerator
from .interactions import InteractionEvent, InteractionHandle, InteractionState
```

Then inside `class LLMProvider`, **after the existing `generate_multimodal` method**, add:

```python
    # --- Interactions API (Deep Research) -------------------------------
    # Providers that support Google's Interactions API (Gemini) override
    # these. The default raises NotImplementedError so callers can ``try``
    # the call and fall back to UI-layer gating ("Gemini 키가 필요합니다").

    async def start_interaction(
        self,
        *,
        input: str,
        agent: str,
        collaborative_planning: bool = False,
        background: bool = False,
        stream: bool = False,
        previous_interaction_id: str | None = None,
        thinking_summaries: str | None = None,
        visualization: bool = False,
    ) -> InteractionHandle:
        raise NotImplementedError(
            f"{type(self).__name__} does not support the Interactions API"
        )

    async def get_interaction(self, interaction_id: str) -> InteractionState:
        raise NotImplementedError(
            f"{type(self).__name__} does not support the Interactions API"
        )

    async def stream_interaction(
        self,
        interaction_id: str,
        *,
        last_event_id: str | None = None,
    ) -> AsyncGenerator[InteractionEvent, None]:
        raise NotImplementedError(
            f"{type(self).__name__} does not support the Interactions API"
        )
        # Unreachable but required so the function is an async generator.
        if False:  # pragma: no cover
            yield  # type: ignore[unreachable]

    async def cancel_interaction(self, interaction_id: str) -> None:
        raise NotImplementedError(
            f"{type(self).__name__} does not support the Interactions API"
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

```
cd packages/llm
uv run pytest tests/test_base.py -v -k interaction
```

Expected: 4 passed.

- [ ] **Step 5: Re-export from `__init__.py`**

Edit `packages/llm/src/llm/__init__.py`. In the imports add:

```python
from .interactions import (
    InteractionEvent,
    InteractionEventKind,
    InteractionHandle,
    InteractionState,
    InteractionStatus,
)
```

And extend `__all__` by adding these 5 names to the list.

- [ ] **Step 6: Verify package import surface**

```
cd packages/llm
uv run python -c "from llm import InteractionHandle, InteractionState, InteractionEvent; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 7: Commit**

```
git add packages/llm/src/llm/base.py packages/llm/src/llm/__init__.py packages/llm/tests/test_base.py
git commit -m "feat(llm): add interactions api hooks on llmprovider base"
```

---

## Task 3: Verify `google-genai` SDK exposes `client.aio.interactions`

**Files:**
- Modify (if needed): `packages/llm/pyproject.toml`

- [ ] **Step 1: Probe the installed SDK**

```
cd packages/llm
uv run python -c "import google.genai as g; c = g.Client(api_key='test'); print(hasattr(c, 'aio'), hasattr(c.aio, 'interactions'))"
```

- [ ] **Step 2: Branch on result**

- **If both print `True True`** — SDK already supports Interactions. Skip to Step 5 (no dependency change).
- **If `hasattr(c.aio, 'interactions')` is `False`** — the installed version predates the 2026-04-21 Deep Research preview release. Continue to Step 3.

- [ ] **Step 3: Bump the SDK version**

Open `packages/llm/pyproject.toml`. Find the `google-genai` dependency line (under `[project]` `dependencies`). Change the version pin to the latest release that documents `interactions.*`. Look up the current latest with:

```
uv pip index versions google-genai
```

Update to the newest version (e.g. `"google-genai>=1.40.0"` — pick the exact version shown; don't hardcode this number from the plan).

- [ ] **Step 4: Resync and re-probe**

```
cd packages/llm
uv sync
uv run python -c "import google.genai as g; c = g.Client(api_key='test'); print(hasattr(c.aio, 'interactions'))"
```

Expected: `True`. If still `False`, **stop and record the open question in the plan's §Questions log** — possibly the SDK has not yet shipped this endpoint; coordinate with the user. Do NOT fabricate a client shim.

- [ ] **Step 5: Commit (if dependency changed)**

```
git add packages/llm/pyproject.toml packages/llm/uv.lock
git commit -m "chore(llm): bump google-genai to version supporting interactions api"
```

If no dependency change was needed, skip the commit.

---

## Task 4: Implement `GeminiProvider.start_interaction`

**Files:**
- Modify: `packages/llm/src/llm/gemini.py`
- Test: `packages/llm/tests/test_gemini_interactions.py` (new)
- Fixture: `packages/llm/tests/fixtures/interactions/plan_response.json` (new)

- [ ] **Step 1: Create the fixture**

Create directory `packages/llm/tests/fixtures/interactions/` and file `plan_response.json`:

```json
{
  "id": "int_plan_abc123",
  "agent": "deep-research-max-preview-04-2026",
  "status": "queued",
  "background": true
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/llm/tests/test_gemini_interactions.py`:

```python
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from llm.gemini import GeminiProvider
from llm.interactions import InteractionHandle

FIXTURES = Path(__file__).parent / "fixtures" / "interactions"


def _fixture_as_obj(name: str):
    """Return a MagicMock whose attributes match the JSON fixture keys."""
    data = json.loads((FIXTURES / name).read_text())
    m = MagicMock()
    for k, v in data.items():
        setattr(m, k, v)
    return m, data


@pytest.fixture
def provider(gemini_config):
    return GeminiProvider(gemini_config)


@pytest.mark.asyncio
async def test_start_interaction_returns_handle(provider):
    mock_response, raw = _fixture_as_obj("plan_response.json")
    with patch.object(
        provider._client.aio.interactions,
        "create",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        handle = await provider.start_interaction(
            input="Research Google TPUs history",
            agent="deep-research-max-preview-04-2026",
            collaborative_planning=True,
            background=True,
        )
    assert isinstance(handle, InteractionHandle)
    assert handle.id == raw["id"]
    assert handle.agent == raw["agent"]
    assert handle.background is True
    # Verify the SDK call carried our arguments
    call = mocked.await_args
    assert call.kwargs["input"] == "Research Google TPUs history"
    assert call.kwargs["agent"] == "deep-research-max-preview-04-2026"
    assert call.kwargs["background"] is True
    # collaborative_planning lives inside agent_config
    assert call.kwargs["agent_config"]["collaborative_planning"] is True


@pytest.mark.asyncio
async def test_start_interaction_forwards_previous_id(provider):
    mock_response, _ = _fixture_as_obj("plan_response.json")
    with patch.object(
        provider._client.aio.interactions,
        "create",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        await provider.start_interaction(
            input="edit: focus on TPU v5",
            agent="deep-research-max-preview-04-2026",
            collaborative_planning=True,
            previous_interaction_id="int_plan_abc123",
        )
    call = mocked.await_args
    assert call.kwargs["previous_interaction_id"] == "int_plan_abc123"
```

- [ ] **Step 3: Run the test to verify it fails**

```
cd packages/llm
uv run pytest tests/test_gemini_interactions.py -v
```

Expected: `NotImplementedError` (inherited default).

- [ ] **Step 4: Write the minimal implementation**

In `packages/llm/src/llm/gemini.py`, **add imports at the top** (merge with existing):

```python
from .interactions import (
    InteractionEvent,
    InteractionHandle,
    InteractionState,
)
```

Then **append** to the `GeminiProvider` class (after the existing methods, before the end of class):

```python
    # --- Interactions API (Deep Research) -------------------------------

    async def start_interaction(
        self,
        *,
        input: str,
        agent: str,
        collaborative_planning: bool = False,
        background: bool = False,
        stream: bool = False,
        previous_interaction_id: str | None = None,
        thinking_summaries: str | None = None,
        visualization: bool = False,
    ) -> InteractionHandle:
        agent_config: dict[str, Any] = {"type": agent}
        if collaborative_planning:
            agent_config["collaborative_planning"] = True
        if thinking_summaries is not None:
            agent_config["thinking_summaries"] = thinking_summaries
        if visualization:
            agent_config["visualization"] = True

        kwargs: dict[str, Any] = {
            "input": input,
            "agent": agent,
            "agent_config": agent_config,
            "background": background,
        }
        if stream:
            kwargs["stream"] = True
        if previous_interaction_id is not None:
            kwargs["previous_interaction_id"] = previous_interaction_id

        resp = await self._client.aio.interactions.create(**kwargs)
        return InteractionHandle(
            id=resp.id,
            agent=resp.agent,
            background=bool(resp.background),
        )
```

- [ ] **Step 5: Run the test to verify it passes**

```
cd packages/llm
uv run pytest tests/test_gemini_interactions.py -v
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```
git add packages/llm/src/llm/gemini.py packages/llm/tests/test_gemini_interactions.py packages/llm/tests/fixtures/interactions/plan_response.json
git commit -m "feat(llm): implement geminiprovider.start_interaction"
```

---

## Task 5: Implement `GeminiProvider.get_interaction`

**Files:**
- Modify: `packages/llm/src/llm/gemini.py`
- Modify: `packages/llm/tests/test_gemini_interactions.py`
- Fixtures: `packages/llm/tests/fixtures/interactions/running_state.json`, `completed_state.json`

- [ ] **Step 1: Create the fixtures**

`packages/llm/tests/fixtures/interactions/running_state.json`:

```json
{
  "id": "int_run_xyz789",
  "status": "running",
  "outputs": [],
  "error": null
}
```

`packages/llm/tests/fixtures/interactions/completed_state.json`:

```json
{
  "id": "int_run_xyz789",
  "status": "completed",
  "outputs": [
    {"type": "text", "text": "## TPU Generations\n..."},
    {"type": "image", "data": "BASE64PNG==", "mime_type": "image/png"}
  ],
  "error": null
}
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/llm/tests/test_gemini_interactions.py`:

```python
@pytest.mark.asyncio
async def test_get_interaction_running(provider):
    mock_response, raw = _fixture_as_obj("running_state.json")
    with patch.object(
        provider._client.aio.interactions,
        "get",
        new=AsyncMock(return_value=mock_response),
    ) as mocked:
        state = await provider.get_interaction("int_run_xyz789")
    assert state.id == raw["id"]
    assert state.status == "running"
    assert state.outputs == []
    assert state.error is None
    mocked.assert_awaited_once_with(interaction_id="int_run_xyz789")


@pytest.mark.asyncio
async def test_get_interaction_completed_with_outputs(provider):
    mock_response, raw = _fixture_as_obj("completed_state.json")
    with patch.object(
        provider._client.aio.interactions,
        "get",
        new=AsyncMock(return_value=mock_response),
    ):
        state = await provider.get_interaction("int_run_xyz789")
    assert state.status == "completed"
    assert len(state.outputs) == 2
    assert state.outputs[0]["type"] == "text"
    assert state.outputs[1]["type"] == "image"
```

- [ ] **Step 3: Run tests to verify they fail**

```
cd packages/llm
uv run pytest tests/test_gemini_interactions.py::test_get_interaction_running tests/test_gemini_interactions.py::test_get_interaction_completed_with_outputs -v
```

Expected: `NotImplementedError`.

- [ ] **Step 4: Write the minimal implementation**

In `packages/llm/src/llm/gemini.py`, append to `GeminiProvider` (after `start_interaction`):

```python
    async def get_interaction(self, interaction_id: str) -> InteractionState:
        resp = await self._client.aio.interactions.get(interaction_id=interaction_id)
        return InteractionState(
            id=resp.id,
            status=resp.status,
            outputs=list(resp.outputs or []),
            error=resp.error,
        )
```

- [ ] **Step 5: Run tests to verify they pass**

```
cd packages/llm
uv run pytest tests/test_gemini_interactions.py -v
```

Expected: 4 passed (2 from Task 4 + 2 new).

- [ ] **Step 6: Commit**

```
git add packages/llm/src/llm/gemini.py packages/llm/tests/test_gemini_interactions.py packages/llm/tests/fixtures/interactions/
git commit -m "feat(llm): implement geminiprovider.get_interaction"
```

---

## Task 6: Implement `GeminiProvider.stream_interaction`

**Files:**
- Modify: `packages/llm/src/llm/gemini.py`
- Modify: `packages/llm/tests/test_gemini_interactions.py`
- Fixture: `packages/llm/tests/fixtures/interactions/stream_events.jsonl`

- [ ] **Step 1: Create the fixture**

`packages/llm/tests/fixtures/interactions/stream_events.jsonl`:

```jsonl
{"event_id": "ev_0", "kind": "thought_summary", "payload": {"text": "Decomposing into sub-questions."}}
{"event_id": "ev_1", "kind": "text", "payload": {"delta": "TPU v1 launched in 2016..."}}
{"event_id": "ev_2", "kind": "image", "payload": {"data": "BASE64PNG==", "mime_type": "image/png"}}
{"event_id": "ev_3", "kind": "status", "payload": {"status": "completed"}}
```

- [ ] **Step 2: Write the failing test**

Append to `packages/llm/tests/test_gemini_interactions.py`:

```python
@pytest.mark.asyncio
async def test_stream_interaction_yields_events(provider):
    path = FIXTURES / "stream_events.jsonl"
    lines = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]

    async def _gen():
        for row in lines:
            ev = MagicMock()
            ev.event_id = row["event_id"]
            ev.kind = row["kind"]
            ev.payload = row["payload"]
            yield ev

    with patch.object(
        provider._client.aio.interactions,
        "stream",
        new=MagicMock(return_value=_gen()),
    ) as mocked:
        collected = []
        async for ev in provider.stream_interaction("int_run_xyz789"):
            collected.append(ev)

    assert [e.event_id for e in collected] == ["ev_0", "ev_1", "ev_2", "ev_3"]
    assert collected[0].kind == "thought_summary"
    assert collected[2].payload["mime_type"] == "image/png"
    mocked.assert_called_once()
    call_kwargs = mocked.call_args.kwargs
    assert call_kwargs["interaction_id"] == "int_run_xyz789"


@pytest.mark.asyncio
async def test_stream_interaction_forwards_last_event_id(provider):
    async def _empty():
        if False:
            yield

    with patch.object(
        provider._client.aio.interactions,
        "stream",
        new=MagicMock(return_value=_empty()),
    ) as mocked:
        async for _ in provider.stream_interaction("int_run_xyz789", last_event_id="ev_2"):
            pass
    assert mocked.call_args.kwargs["last_event_id"] == "ev_2"
```

- [ ] **Step 3: Run tests to verify they fail**

```
cd packages/llm
uv run pytest tests/test_gemini_interactions.py -v -k stream
```

Expected: `NotImplementedError`.

- [ ] **Step 4: Write the minimal implementation**

In `packages/llm/src/llm/gemini.py`, append to `GeminiProvider`:

```python
    async def stream_interaction(
        self,
        interaction_id: str,
        *,
        last_event_id: str | None = None,
    ) -> AsyncGenerator[InteractionEvent, None]:
        kwargs: dict[str, Any] = {"interaction_id": interaction_id}
        if last_event_id is not None:
            kwargs["last_event_id"] = last_event_id
        async for raw in self._client.aio.interactions.stream(**kwargs):
            yield InteractionEvent(
                event_id=raw.event_id,
                kind=raw.kind,
                payload=dict(raw.payload or {}),
            )
```

Also add `from collections.abc import AsyncGenerator` to `gemini.py`'s top imports if not already present.

- [ ] **Step 5: Run tests to verify they pass**

```
cd packages/llm
uv run pytest tests/test_gemini_interactions.py -v
```

Expected: 6 passed.

- [ ] **Step 6: Commit**

```
git add packages/llm/src/llm/gemini.py packages/llm/tests/test_gemini_interactions.py packages/llm/tests/fixtures/interactions/stream_events.jsonl
git commit -m "feat(llm): implement geminiprovider.stream_interaction"
```

---

## Task 7: Implement `GeminiProvider.cancel_interaction`

**Files:**
- Modify: `packages/llm/src/llm/gemini.py`
- Modify: `packages/llm/tests/test_gemini_interactions.py`

- [ ] **Step 1: Write the failing test**

Append to `packages/llm/tests/test_gemini_interactions.py`:

```python
@pytest.mark.asyncio
async def test_cancel_interaction_calls_sdk(provider):
    with patch.object(
        provider._client.aio.interactions,
        "cancel",
        new=AsyncMock(return_value=None),
    ) as mocked:
        result = await provider.cancel_interaction("int_run_xyz789")
    assert result is None
    mocked.assert_awaited_once_with(interaction_id="int_run_xyz789")
```

- [ ] **Step 2: Run test to verify it fails**

```
cd packages/llm
uv run pytest tests/test_gemini_interactions.py::test_cancel_interaction_calls_sdk -v
```

Expected: `NotImplementedError`.

- [ ] **Step 3: Write the minimal implementation**

In `packages/llm/src/llm/gemini.py`, append:

```python
    async def cancel_interaction(self, interaction_id: str) -> None:
        await self._client.aio.interactions.cancel(interaction_id=interaction_id)
```

- [ ] **Step 4: Run test to verify it passes**

```
cd packages/llm
uv run pytest tests/test_gemini_interactions.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```
git add packages/llm/src/llm/gemini.py packages/llm/tests/test_gemini_interactions.py
git commit -m "feat(llm): implement geminiprovider.cancel_interaction"
```

---

## Task 8: Add defensive `NotImplementedError` tests for Ollama

**Files:**
- Modify: `packages/llm/tests/test_ollama.py`

- [ ] **Step 1: Write the failing tests**

Append to `packages/llm/tests/test_ollama.py`:

```python
import pytest
from llm.ollama import OllamaProvider


@pytest.fixture
def ollama_provider(ollama_config):
    return OllamaProvider(ollama_config)


@pytest.mark.asyncio
async def test_ollama_start_interaction_raises(ollama_provider):
    with pytest.raises(NotImplementedError):
        await ollama_provider.start_interaction(
            input="x", agent="deep-research-preview-04-2026",
        )


@pytest.mark.asyncio
async def test_ollama_get_interaction_raises(ollama_provider):
    with pytest.raises(NotImplementedError):
        await ollama_provider.get_interaction("int_1")


@pytest.mark.asyncio
async def test_ollama_stream_interaction_raises(ollama_provider):
    with pytest.raises(NotImplementedError):
        async for _ in ollama_provider.stream_interaction("int_1"):
            pass


@pytest.mark.asyncio
async def test_ollama_cancel_interaction_raises(ollama_provider):
    with pytest.raises(NotImplementedError):
        await ollama_provider.cancel_interaction("int_1")
```

(If `ollama_provider` fixture already exists in the file, reuse it — don't duplicate.)

- [ ] **Step 2: Run tests to verify they pass (Ollama inherits the base default)**

```
cd packages/llm
uv run pytest tests/test_ollama.py -v -k interaction
```

Expected: 4 passed — no implementation change needed. These are **regression guards** so someone doesn't accidentally add a half-baked Ollama implementation.

- [ ] **Step 3: Commit**

```
git add packages/llm/tests/test_ollama.py
git commit -m "test(llm): pin ollama interactions api to notimplementederror"
```

---

## Task 9: Full suite + type check

- [ ] **Step 1: Run the full `packages/llm` test suite**

```
cd packages/llm
uv run pytest -v
```

Expected: all tests pass. Record total count.

- [ ] **Step 2: Type-check** (if the project uses mypy/pyright; if not, skip)

```
cd packages/llm
uv run python -c "from llm import InteractionHandle, InteractionState, InteractionEvent, LLMProvider; print('types ok')"
```

Expected: `types ok`.

- [ ] **Step 3: If anything fails, fix in-place**

Do NOT commit broken state. Each prior commit must continue to pass; this step is the green-bar gate for the whole phase.

---

## Task 10: Phase A documentation delta

**Files:**
- Modify: `docs/contributing/plans-status.md` (add Phase A entry)
- Modify (minor): `docs/superpowers/specs/2026-04-22-deep-research-integration-design.md` — Open Question #1 resolved

- [ ] **Step 1: Update plans-status.md**

Open `docs/contributing/plans-status.md`. Add under the appropriate section:

```markdown
### Deep Research integration (Spec A)

- ✅ Phase A — `packages/llm` Interactions wrapper (YYYY-MM-DD)  ← fill today's date
- 🟡 Phase B — DB + Temporal workflow (next)
- 🟡 Phase C — apps/api routes + SSE
- 🟡 Phase D — apps/web /research + Plate research-meta
- 🟡 Phase E — i18n + feature flag + E2E + 출시
```

- [ ] **Step 2: Close Open Question #1 in the spec**

In `docs/superpowers/specs/2026-04-22-deep-research-integration-design.md`, §11 Open Questions, replace the #1 entry with:

```markdown
1. ~~google-genai SDK 버전~~ — 해결됨 (Phase A, YYYY-MM-DD). 설치된 SDK 버전이 `client.aio.interactions.*` 를 지원함을 테스트로 확정. 정확한 버전은 `packages/llm/uv.lock` 참고.
```

(Fill YYYY-MM-DD with today's date.)

- [ ] **Step 3: Commit docs**

```
git add docs/contributing/plans-status.md docs/superpowers/specs/2026-04-22-deep-research-integration-design.md
git commit -m "docs(docs): record deep research phase a completion"
```

---

## Task 11: Open PR (optional — user may prefer merge-to-branch)

- [ ] **Step 1: Confirm with user**

Ask: "Phase A 완료. 현재 브랜치에서 계속 작업하며 B로 넘어갈까요, 아니면 PR 열어 리뷰받고 머지 먼저 할까요?"

- [ ] **Step 2: If PR requested**

```
git push -u origin HEAD
gh pr create --title "feat(llm): deep research phase a — interactions api wrapper" --body "$(cat <<'EOF'
## Summary
- Adds `InteractionHandle` / `InteractionState` / `InteractionEvent` dataclass types to `packages/llm`
- `LLMProvider` base gains 4 new async hooks, default `NotImplementedError`
- `GeminiProvider` implements all 4 by delegating to `client.aio.interactions.*`
- `OllamaProvider` inherits the `NotImplementedError` defaults; regression tests pin that behavior

Spec: [docs/superpowers/specs/2026-04-22-deep-research-integration-design.md](../blob/HEAD/docs/superpowers/specs/2026-04-22-deep-research-integration-design.md)
Plan: [docs/superpowers/plans/2026-04-22-deep-research-phase-a-llm-wrapper.md](../blob/HEAD/docs/superpowers/plans/2026-04-22-deep-research-phase-a-llm-wrapper.md)

## Test plan
- [x] `uv run pytest packages/llm -v` — all green
- [x] Ollama providers raise `NotImplementedError` (regression pinned)
- [x] No network calls in tests (all `client.aio.interactions.*` mocked)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

**Spec coverage (§4.4 of spec):**
- `InteractionHandle` / `InteractionState` / `InteractionEvent` dataclasses → Task 1 ✅
- `start_interaction` / `get_interaction` / `stream_interaction` / `cancel_interaction` on base → Task 2 ✅
- Gemini implementations → Tasks 4–7 ✅
- Ollama `NotImplementedError` → Task 8 ✅
- Re-export from `__init__.py` → Task 2 Step 5 ✅

**Placeholder scan:** None. Every step has exact code, exact commands, exact paths.

**Type consistency:**
- `InteractionHandle(id, agent, background)` — same signature used in Task 1 fixture, Task 4 test, Task 4 implementation ✅
- `InteractionState(id, status, outputs, error)` — consistent across Tasks 1, 5 ✅
- `InteractionEvent(event_id, kind, payload)` — consistent across Tasks 1, 6 ✅
- SDK call `client.aio.interactions.create/get/stream/cancel` — same 4 method names throughout Tasks 4–7 ✅
- Parameter name `interaction_id` (snake_case) passed as kwarg — consistent ✅

**Out of scope (intentionally):**
- No Temporal activity wiring (that's Phase B Task 1+)
- No API route changes (that's Phase C)
- No UI changes (that's Phase D)
- No feature flag gating (that's Phase E; base `NotImplementedError` is the natural "off" state)
