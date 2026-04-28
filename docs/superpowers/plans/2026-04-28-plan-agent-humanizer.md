# Agent Humanizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert raw `AgentEvent` streams into honest, concise Korean status lines plus streaming Gemini "thought summaries", plumb them through SSE, and let users cancel mid-stream — all behind `FEATURE_AGENT_HUMANIZER`.

**Architecture:** A pure `humanize(event, agent_type) → StatusLine | None` function paired with a 300 ms debounce stream transformer. Five new `BaseEvent` subclasses (`ThoughtSummary`, `PhaseTransition`, `StatusLine`, `Retry`, `RouteDecision`) extend Plan 12's runtime without touching the existing 9. Two SSE surfaces (`/api/threads/:id/messages`, `/api/chat/message`) gain the same chunk vocabulary so the stub today and the real worker tomorrow share one wire format. The composer's send button toggles to a stop icon while streaming; click aborts SSE → row finalizes as a new `cancelled` message status.

**Tech Stack:** Python 3.12 (apps/worker, packages/llm) · TS / Hono 4 (apps/api) · Next.js 16 + next-intl (apps/web) · Drizzle + pgEnum (packages/db) · Zod (packages/shared) · pytest · vitest · Playwright.

**Spec:** `docs/superpowers/specs/2026-04-22-agent-humanizer-design.md` (resolutions 2026-04-28 in §13).

**Dependencies (already merged on `main`):**
- Plan 1 (foundation), Plan 12 (Agent Runtime Standard — `apps/worker/src/runtime/events.py` 9 types), Plan 13 (multi-LLM with `packages/llm/src/llm/{base,gemini,ollama}.py`), Plan 11A (`/api/chat/message` placeholder SSE in `apps/api/src/routes/chat.ts`), App Shell Phase 4 (`/api/threads/:id/messages` in `apps/api/src/routes/threads.ts` using `apps/api/src/lib/agent-pipeline.ts` stub, plus `apps/web/src/components/agent-panel/{status-line,thought-bubble,composer,conversation,message-bubble}.tsx`).

**Feature flag:** `FEATURE_AGENT_HUMANIZER`. Default off. When off:
- Worker code exists but no activity wires `humanized_event_stream`.
- API: `agent-pipeline.ts` stub keeps emitting today's chunks (`status`/`thought`/`text`/`citation`/`save_suggestion`/`done`). chat.ts placeholder reply unchanged.
- Web: graceful fallthrough — every new chunk type is ignored if absent, no UI regressions.

When on: full humanizer chain emits the richer SSE vocabulary; UI renders thought-summary deltas, single-line rolling status, and stop button.

**Out of scope (deferred to v0.2+):**
- `tool_count` / `token_count` suffix on the status line (per spec §13.2)
- Esc keybinding for cancel (per spec §13.3)
- Real worker→API integration for chat.ts (today both surfaces stub; this plan only widens the wire format)
- `RouteDecision` event payload generation (model router lives in a separate spec — we reserve the wire type only)

---

## File Structure

### Worker (Python, apps/worker)

| File | Status | Responsibility |
|---|---|---|
| `apps/worker/src/runtime/events.py` | modify | Add 5 `BaseEvent` subclasses + extend `AgentEvent` Annotated Union |
| `apps/worker/src/runtime/humanizer.py` | create | Pure `humanize()` + `TEMPLATES` registry + `truncate_phrase()` |
| `apps/worker/src/runtime/humanizer_stream.py` | create | `humanized_event_stream()` async generator + `StatusLineDebouncer` (300 ms window, immediate-flush exceptions) |
| `apps/worker/src/runtime/__init__.py` | modify | Re-export new event classes + humanizer fns |
| `apps/worker/tests/test_humanizer.py` | create | Unit tests per template (incl. truncation, `None` suppression) |
| `apps/worker/tests/test_humanizer_stream.py` | create | Integration: mock event sequence → expected stream of (passthrough + StatusLine) |
| `apps/worker/tests/test_humanizer_debounce.py` | create | Debounce window + immediate-flush behaviour |

### LLM (Python, packages/llm)

| File | Status | Responsibility |
|---|---|---|
| `packages/llm/src/llm/base.py` | modify | Abstract `thinking_summaries_supported(model_id)` + (optional) `stream_with_thoughts` interface stub |
| `packages/llm/src/llm/gemini.py` | modify | Plumb `thinking_summaries: "auto"` into `interactions.create(...)` calls used by Research/Librarian/Deep Research; surface delta as `ThoughtSummary` events |
| `packages/llm/src/llm/ollama.py` | modify | `thinking_summaries_supported` returns `False` (graceful skip) |
| `packages/llm/tests/test_gemini_thoughts.py` | create | Mocked SDK chunk → emitted `ThoughtSummary` event |

### Shared (TS, packages/shared)

| File | Status | Responsibility |
|---|---|---|
| `packages/shared/src/schemas/agent-events.ts` | create | Zod schemas for `StatusLine`, `ThoughtSummary`, `PhaseTransition`, `Retry`, `RouteDecision` |
| `packages/shared/src/index.ts` | modify | Re-export new schemas |
| `packages/shared/tests/agent-events.test.ts` | create | Round-trip parse for each schema |

### DB (packages/db)

| File | Status | Responsibility |
|---|---|---|
| `packages/db/src/schema/enums.ts` | modify | Add `'cancelled'` to `messageStatusEnum` |
| `packages/db/drizzle/0034_chat_messages_cancelled.sql` | create | `ALTER TYPE message_status ADD VALUE 'cancelled'` |

### API (Hono, apps/api)

| File | Status | Responsibility |
|---|---|---|
| `apps/api/src/lib/agent-pipeline.ts` | modify | `AgentChunkType` widens to include `phase_transition`, `retry`, `cost_delta` (placeholder), `cancelled`. Stub emits a few new chunks when flag on. |
| `apps/api/src/lib/feature-flags.ts` | modify or create | `isHumanizerEnabled()` reads `FEATURE_AGENT_HUMANIZER` |
| `apps/api/src/routes/threads.ts:288-345` | modify | Detect client abort → finalize with `streamStatus = "cancelled"`. Forward all new chunk types. |
| `apps/api/src/routes/chat.ts:346-420` | modify | Optional: when flag on, replace placeholder reply with stub-richer chunks (parity with threads.ts vocabulary). When off, exact current behaviour. |
| `apps/api/tests/routes/threads-cancel.test.js` | create | Cancel mid-stream → row status = `'cancelled'` |
| `apps/api/tests/routes/chat-humanizer.test.js` | create | With flag on, chat.ts emits `status_line`/`thought_summary`/`done`; with flag off, only `delta`/`cost`/`done` |

### Web (Next.js, apps/web)

| File | Status | Responsibility |
|---|---|---|
| `apps/web/src/components/agent-panel/composer.tsx` | modify | Receive `streaming: boolean` + `onStop: () => void`; render Stop icon while streaming |
| `apps/web/src/components/agent-panel/conversation.tsx` | modify | Default phrase `"Initializing…"`, accumulate `thought_summary` deltas, hide status line on `done`/`cancelled` |
| `apps/web/src/components/agent-panel/status-line.tsx` | modify | Receive optional `kind` for phase styling, accept i18n key fallback |
| `apps/web/src/components/agent-panel/thought-bubble.tsx` | modify | Accept streaming `summary` updates instead of single string |
| `apps/web/src/components/agent-panel/message-bubble.tsx` | modify | Render new `cancelled` status (greyed-out + "취소됨" footer) |
| `apps/web/src/lib/agent-stream-hook.ts` | modify (locate file) | Track new chunk types; expose `streaming` + `cancel()` |
| `apps/web/messages/ko/agentPanel.json` | modify | Add `status.initializing`, `status.cancelled`, `composer.stop` keys |
| `apps/web/messages/en/agentPanel.json` | modify | Same keys (parity) |
| `apps/web/tests/agent-panel/composer-stop.test.tsx` | create | Send→Stop toggle visual + click invokes `onStop` |
| `apps/web/tests/agent-panel/conversation-cancelled.test.tsx` | create | `cancelled` status renders correctly |
| `apps/web/e2e/agent-humanizer.spec.ts` | create | Smoke E2E (Playwright) — only runs when `NEXT_PUBLIC_FEATURE_AGENT_HUMANIZER=1` |

### Docs

| File | Status | Responsibility |
|---|---|---|
| `docs/agents/humanizer-templates.md` | create | Reviewable mapping table — every (agent, event, tool) → phrase |
| `docs/contributing/plans-status.md` | modify | Mark Plan Agent Humanizer 🟡 active → ✅ complete on merge |
| `docs/contributing/llm-antipatterns.md` | append (if footgun discovered during impl) | Only if a new repeated mistake surfaces — otherwise skip |

---

## Phase 1 — Worker: Event Schema Additions

### Task 1: Add 5 new `BaseEvent` subclasses + extend `AgentEvent` union

**Files:**
- Modify: `apps/worker/src/runtime/events.py`
- Test: `apps/worker/tests/test_events_humanizer.py`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/tests/test_events_humanizer.py`:

```python
"""Tests for new humanizer-supporting AgentEvent subclasses."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from runtime.events import (
    AgentEvent,
    PhaseTransition,
    Retry,
    RouteDecision,
    StatusLine,
    ThoughtSummary,
)


def _base_kwargs(seq: int = 1) -> dict:
    return {
        "run_id": "run_abc",
        "workspace_id": "ws_1",
        "agent_name": "research",
        "seq": seq,
        "ts": 1714291200.0,
    }


def test_thought_summary_round_trip() -> None:
    ev = ThoughtSummary(**_base_kwargs(), text="사용자 의도 분석 중", delta_index=0)
    assert ev.type == "thought_summary"
    dumped = ev.model_dump()
    assert dumped["type"] == "thought_summary"
    # Parsing back via the discriminated union must yield the same subclass.
    from pydantic import TypeAdapter

    adapter = TypeAdapter(AgentEvent)
    parsed = adapter.validate_python(dumped)
    assert isinstance(parsed, ThoughtSummary)
    assert parsed.delta_index == 0


def test_phase_transition_optional_reason() -> None:
    ev = PhaseTransition(**_base_kwargs(), phase="search")
    assert ev.reason is None
    ev2 = PhaseTransition(**_base_kwargs(), phase="read", reason="cache miss")
    assert ev2.reason == "cache miss"


def test_status_line_kind_enum() -> None:
    ev = StatusLine(
        **_base_kwargs(),
        text="‘CNN’ 관련 문서 훑는 중…",
        kind="progress",
    )
    assert ev.kind == "progress"
    assert ev.debounced is False
    with pytest.raises(ValidationError):
        StatusLine(**_base_kwargs(), text="x", kind="not_a_kind")  # type: ignore[arg-type]


def test_retry_attempt_required() -> None:
    ev = Retry(
        **_base_kwargs(),
        tool_name="hybrid_search",
        attempt=2,
        reason="timeout",
    )
    assert ev.attempt == 2


def test_route_decision_carries_chosen_model() -> None:
    ev = RouteDecision(
        **_base_kwargs(), chosen_model="gemini-2.5-pro", reason="long context"
    )
    assert ev.chosen_model == "gemini-2.5-pro"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/worker
uv run pytest tests/test_events_humanizer.py -v
```

Expected: ImportError (`PhaseTransition`, `Retry`, etc. not found in `runtime.events`).

- [ ] **Step 3: Implement the new event classes**

Edit `apps/worker/src/runtime/events.py`. Add **after `CustomEvent`** (~line 95) and **before** the `AgentEvent` Annotated Union:

```python
class ThoughtSummary(BaseEvent):
    """Gemini thinking_summaries delta. Streamed character-by-character.

    delta_index is monotonic per turn so a re-ordering transport can rebuild
    the original sequence; downstream consumers (humanizer_stream, web) treat
    it as advisory only.
    """

    type: Literal["thought_summary"] = "thought_summary"
    text: str
    delta_index: int


class PhaseTransition(BaseEvent):
    """Agent-emitted phase boundary (search → read → synthesize → write …).

    Free-form `phase` string; humanizer maps known values to localised labels
    and falls back to the raw value otherwise.
    """

    type: Literal["phase_transition"] = "phase_transition"
    phase: str
    reason: str | None = None


class StatusLine(BaseEvent):
    """One-line user-visible status — derived by humanizer_stream from the
    upstream events. NEVER emitted directly by an agent; the runtime
    transformer owns this type.
    """

    type: Literal["status_line"] = "status_line"
    text: str
    kind: Literal["info", "progress", "error", "phase"]
    phase: str | None = None
    debounced: bool = False


class Retry(BaseEvent):
    """Same tool, same args, repeat attempt. A *different* tool / new path
    must be emitted as PhaseTransition instead — humanizer renders the two
    differently (status_line vs phase divider, spec §13.1).
    """

    type: Literal["retry"] = "retry"
    tool_name: str
    attempt: int
    reason: str


class RouteDecision(BaseEvent):
    """Reserved for the model-router spec. The wire type ships now so future
    UI work doesn't break SSE compatibility; payload semantics are owned
    elsewhere.
    """

    type: Literal["route_decision"] = "route_decision"
    chosen_model: str
    reason: str
```

Then update the `AgentEvent` Annotated Union (existing line ~97) to include all 5:

```python
AgentEvent = Annotated[
    Union[
        AgentStart,
        AgentEnd,
        AgentError,
        ModelEnd,
        ToolUse,
        ToolResult,
        Handoff,
        AwaitingInput,
        CustomEvent,
        ThoughtSummary,
        PhaseTransition,
        StatusLine,
        Retry,
        RouteDecision,
    ],
    Field(discriminator="type"),
]
```

And `__all__` (existing list, alphabetical):

```python
__all__ = [
    "AgentEnd",
    "AgentError",
    "AgentEvent",
    "AgentStart",
    "AwaitingInput",
    "BaseEvent",
    "CustomEvent",
    "Handoff",
    "ModelEnd",
    "PhaseTransition",
    "Retry",
    "RouteDecision",
    "Scope",
    "StatusLine",
    "ThoughtSummary",
    "ToolResult",
    "ToolUse",
]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/test_events_humanizer.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Verify no existing test regressed**

```bash
uv run pytest tests/ -q
```

Expected: 0 failures (previous baseline).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/events.py apps/worker/tests/test_events_humanizer.py
git commit -m "$(cat <<'EOF'
feat(worker): add ThoughtSummary/PhaseTransition/StatusLine/Retry/RouteDecision events

5 new BaseEvent subclasses extend the AgentEvent discriminated union without
touching the original 9. Spec § 9.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2: Re-export new events from `runtime/__init__.py`

**Files:**
- Modify: `apps/worker/src/runtime/__init__.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/worker/tests/test_events_humanizer.py`:

```python
def test_runtime_re_exports_new_events() -> None:
    import runtime

    for name in (
        "PhaseTransition",
        "Retry",
        "RouteDecision",
        "StatusLine",
        "ThoughtSummary",
    ):
        assert hasattr(runtime, name), f"runtime missing {name}"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_events_humanizer.py::test_runtime_re_exports_new_events -v
```

Expected: AssertionError (`runtime missing PhaseTransition`).

- [ ] **Step 3: Update `__init__.py`**

In `apps/worker/src/runtime/__init__.py`, extend the `from runtime.events import (…)` block:

```python
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    AwaitingInput,
    CustomEvent,
    Handoff,
    ModelEnd,
    PhaseTransition,
    Retry,
    RouteDecision,
    Scope,
    StatusLine,
    ThoughtSummary,
    ToolResult,
    ToolUse,
)
```

And add the 5 names to `__all__` (alphabetical).

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/test_events_humanizer.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/__init__.py apps/worker/tests/test_events_humanizer.py
git commit -m "$(cat <<'EOF'
feat(worker): re-export humanizer event classes from runtime facade

12 agents import from `runtime` only (CLAUDE.md rule); the new event types
must surface there too.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3: Verify TrajectoryWriter accepts new event types unchanged

**Files:**
- Test: `apps/worker/tests/test_trajectory_humanizer_events.py`

The trajectory writer serialises any `AgentEvent` via `model_dump()`. New subclasses should "just work" — this task locks that contract with a regression test (no production code changes needed).

- [ ] **Step 1: Write the regression test**

Create `apps/worker/tests/test_trajectory_humanizer_events.py`:

```python
"""Regression: TrajectoryWriter must serialise the 5 new event types."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from runtime.events import (
    AgentEnd,
    AgentStart,
    PhaseTransition,
    Retry,
    RouteDecision,
    StatusLine,
    ThoughtSummary,
)
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter


def _base(seq: int) -> dict:
    return {
        "run_id": "run_traj",
        "workspace_id": "ws_1",
        "agent_name": "research",
        "seq": seq,
        "ts": 1714291200.0,
    }


@pytest.mark.asyncio
async def test_writer_round_trips_new_events(tmp_path: Path) -> None:
    storage = LocalFSTrajectoryStorage(root=tmp_path)
    writer = TrajectoryWriter(
        storage=storage, run_id="run_traj", workspace_id="ws_1"
    )
    await writer.open()

    events = [
        AgentStart(
            **_base(1), scope="page", input={"q": "x"}, parent_run_id=None
        ),
        ThoughtSummary(**_base(2), text="…", delta_index=0),
        PhaseTransition(**_base(3), phase="search"),
        Retry(**_base(4), tool_name="hybrid_search", attempt=2, reason="timeout"),
        StatusLine(**_base(5), text="찾는 중", kind="progress"),
        RouteDecision(**_base(6), chosen_model="gemini-2.5-pro", reason="ctx"),
        AgentEnd(**_base(7), output={}, duration_ms=10),
    ]

    for ev in events:
        await writer.emit(ev)
    await writer.close()

    path = next(tmp_path.rglob("*.ndjson"))
    lines = path.read_text(encoding="utf-8").strip().split("\n")
    types = [json.loads(line)["type"] for line in lines]
    assert types == [
        "agent_start",
        "thought_summary",
        "phase_transition",
        "retry",
        "status_line",
        "route_decision",
        "agent_end",
    ]
```

- [ ] **Step 2: Run test to verify it passes**

```bash
uv run pytest tests/test_trajectory_humanizer_events.py -v
```

Expected: 1 passed (this is a regression test — no impl change needed).

If it fails: investigate why `TrajectoryWriter.emit()` doesn't accept the union. Likely a type-narrowing import that needs widening — fix in `trajectory.py`. Do NOT swallow the error.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/tests/test_trajectory_humanizer_events.py
git commit -m "$(cat <<'EOF'
test(worker): lock trajectory NDJSON contract for new humanizer events

NDJSON is the source of truth (spec §13.4) — verifies all 5 new event types
round-trip without writer changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Worker: Pure Humanizer Function

### Task 4: Skeleton `humanize()` + first template

**Files:**
- Create: `apps/worker/src/runtime/humanizer.py`
- Test: `apps/worker/tests/test_humanizer.py`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/tests/test_humanizer.py`:

```python
"""Pure-function humanize() unit tests. Templates are deterministic — no LLM."""
from __future__ import annotations

import pytest

from runtime.events import StatusLine, ToolUse
from runtime.humanizer import humanize


def _tool_use(*, tool_name: str, args: dict, agent: str = "research") -> ToolUse:
    return ToolUse(
        run_id="r",
        workspace_id="w",
        agent_name=agent,
        seq=1,
        ts=0.0,
        tool_call_id="tc1",
        tool_name=tool_name,
        input_args=args,
        input_hash="h",
        concurrency_safe=True,
    )


def test_research_hybrid_search_call_renders_progress() -> None:
    line = humanize(
        _tool_use(tool_name="hybrid_search", args={"query": "CNN이란?"}),
        agent_type="research",
    )
    assert line is not None
    assert isinstance(line, StatusLine)
    assert line.kind == "progress"
    assert line.text == "‘CNN이란?’ 관련 문서 훑는 중…"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/worker
uv run pytest tests/test_humanizer.py -v
```

Expected: ImportError (no `runtime.humanizer`).

- [ ] **Step 3: Implement minimal `humanize()`**

Create `apps/worker/src/runtime/humanizer.py`:

```python
"""Pure AgentEvent → StatusLine humanizer (Layer 3, spec §5).

This module MUST stay deterministic — no LLM calls, no I/O. If you find
yourself reaching for a model here, you have already lost (spec §8 anti-
pattern: "LLM이 progress 메시지 생성").
"""
from __future__ import annotations

from typing import Callable, Literal

from runtime.events import (
    AgentEvent,
    PhaseTransition,
    Retry,
    StatusLine,
    ToolResult,
    ToolUse,
)

PHRASE_MAX_CHARS = 60

StatusKind = Literal["info", "progress", "error", "phase"]

# Template signature: (event) -> phrase string OR None to suppress.
TemplateFn = Callable[[AgentEvent], str | None]


def _research_hybrid_search_call(e: ToolUse) -> str | None:
    q = e.input_args.get("query", "")
    return f"‘{q}’ 관련 문서 훑는 중…"


# Map (agent_type, event_type, tool_name_or_phase). Use "*" for wildcards
# on agent or tool_name; resolved by exact match first, then wildcard.
TEMPLATES: dict[tuple[str, str, str], TemplateFn] = {
    ("research", "tool_use", "hybrid_search"): _research_hybrid_search_call,
}


def _key_for(event: AgentEvent, agent_type: str) -> tuple[str, str, str]:
    """Compute the (agent, event_type, discriminator) key for lookup."""
    discriminator = ""
    if isinstance(event, ToolUse):
        discriminator = event.tool_name
    elif isinstance(event, ToolResult):
        discriminator = event.tool_name
    elif isinstance(event, PhaseTransition):
        discriminator = event.phase
    elif isinstance(event, Retry):
        discriminator = event.tool_name
    return (agent_type, event.type, discriminator)


def _kind_for(event: AgentEvent) -> StatusKind:
    if isinstance(event, PhaseTransition):
        return "phase"
    if isinstance(event, ToolResult) and not event.ok:
        return "error"
    return "progress"


def truncate_phrase(text: str, max_chars: int = PHRASE_MAX_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    # Reserve 1 char for the ellipsis; slice on graphemes via len() since
    # CPython's str length is code-point-based and Korean / Latin both fit
    # within the BMP for our templates.
    return text[: max_chars - 1] + "…"


def humanize(event: AgentEvent, agent_type: str) -> StatusLine | None:
    """Pure function. AgentEvent → StatusLine or None to suppress."""
    key = _key_for(event, agent_type)
    fn = TEMPLATES.get(key)
    if fn is None:
        # Try agent wildcard
        fn = TEMPLATES.get(("*",) + key[1:])
    if fn is None:
        # Try tool/phase wildcard
        fn = TEMPLATES.get((key[0], key[1], "*"))
    if fn is None:
        fn = TEMPLATES.get(("*", key[1], "*"))
    if fn is None:
        return None
    phrase = fn(event)
    if phrase is None:
        return None
    return StatusLine(
        run_id=event.run_id,
        workspace_id=event.workspace_id,
        agent_name=event.agent_name,
        seq=event.seq,
        ts=event.ts,
        text=truncate_phrase(phrase),
        kind=_kind_for(event),
        phase=event.phase if isinstance(event, PhaseTransition) else None,
    )


__all__ = ["humanize", "truncate_phrase", "TEMPLATES", "PHRASE_MAX_CHARS"]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/test_humanizer.py -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/humanizer.py apps/worker/tests/test_humanizer.py
git commit -m "$(cat <<'EOF'
feat(worker): humanizer skeleton + research hybrid_search template

Pure deterministic AgentEvent → StatusLine. Wildcard fallback registry
covers (agent, event, tool/phase) lookup. 60-char truncation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5: Fill in v0.1 templates (research / compiler / librarian + cross-agent error / retry)

**Files:**
- Modify: `apps/worker/src/runtime/humanizer.py`
- Test: append cases to `apps/worker/tests/test_humanizer.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/worker/tests/test_humanizer.py`:

```python
from runtime.events import PhaseTransition, Retry, ToolResult


def _tool_result(
    *, tool_name: str, output, ok: bool = True, agent: str = "research"
) -> ToolResult:
    return ToolResult(
        run_id="r",
        workspace_id="w",
        agent_name=agent,
        seq=2,
        ts=0.0,
        tool_call_id="tc1",
        tool_name=tool_name,
        ok=ok,
        output=output,
        duration_ms=12,
    )


def _phase(phase: str, agent: str = "compiler") -> PhaseTransition:
    return PhaseTransition(
        run_id="r",
        workspace_id="w",
        agent_name=agent,
        seq=3,
        ts=0.0,
        phase=phase,
    )


def test_hybrid_search_result_count_phrase() -> None:
    line = humanize(_tool_result(tool_name="hybrid_search", output=[1, 2, 3]), "research")
    assert line is not None
    assert line.text == "3건 찾음"
    assert line.kind == "progress"


def test_hybrid_search_failure_renders_error() -> None:
    line = humanize(
        _tool_result(tool_name="hybrid_search", output=None, ok=False),
        "research",
    )
    assert line is not None
    assert line.text == "hybrid_search 실패 → 다른 방법 시도"
    assert line.kind == "error"


def test_research_fetch_page_call_quotes_title() -> None:
    line = humanize(
        _tool_use(
            tool_name="fetch_page",
            args={"page_title": "Plate v49 함정"},
        ),
        "research",
    )
    assert line is not None
    assert line.text == "노트 열어보는 중: ‘Plate v49 함정’"


def test_compiler_extract_concepts_call() -> None:
    line = humanize(
        _tool_use(tool_name="extract_concepts", args={}, agent="compiler"),
        "compiler",
    )
    assert line is not None
    assert line.text == "개념 추출 중…"


def test_compiler_phase_validate() -> None:
    line = humanize(_phase("validate"), "compiler")
    assert line is not None
    assert line.text == "스키마 검증 중…"
    assert line.kind == "phase"


def test_librarian_phase_rebuild_links() -> None:
    line = humanize(_phase("rebuild_links", agent="librarian"), "librarian")
    assert line is not None
    assert line.kind == "phase"
    assert "위키 링크" in line.text


def test_retry_renders_progress_one_liner() -> None:
    ev = Retry(
        run_id="r",
        workspace_id="w",
        agent_name="research",
        seq=4,
        ts=0.0,
        tool_name="hybrid_search",
        attempt=2,
        reason="timeout",
    )
    line = humanize(ev, "research")
    assert line is not None
    assert line.text == "API가 잠깐 느리네요, 재시도 중…"
    assert line.kind == "progress"


def test_model_end_is_suppressed() -> None:
    from runtime.events import ModelEnd

    ev = ModelEnd(
        run_id="r",
        workspace_id="w",
        agent_name="research",
        seq=5,
        ts=0.0,
        model_id="gemini-2.5-flash",
        prompt_tokens=10,
        completion_tokens=20,
        cost_krw=1,
        finish_reason="stop",
        latency_ms=100,
    )
    assert humanize(ev, "research") is None


def test_unknown_event_combo_returns_none() -> None:
    line = humanize(
        _tool_use(tool_name="completely_unknown_tool", args={}),
        "research",
    )
    assert line is None


def test_truncate_clamps_long_phrases() -> None:
    line = humanize(
        _tool_use(
            tool_name="hybrid_search",
            args={"query": "가" * 200},
        ),
        "research",
    )
    assert line is not None
    assert len(line.text) <= 60
    assert line.text.endswith("…")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_humanizer.py -v
```

Expected: 9 new failures.

- [ ] **Step 3: Add the templates**

In `apps/worker/src/runtime/humanizer.py`, replace the `_research_hybrid_search_call` definition + `TEMPLATES` dict with:

```python
def _research_hybrid_search_call(e: ToolUse) -> str | None:
    q = e.input_args.get("query", "")
    return f"‘{q}’ 관련 문서 훑는 중…"


def _research_hybrid_search_result(e: ToolResult) -> str | None:
    if not e.ok:
        # Falls through to the wildcard error template — keep deterministic.
        return None
    count = len(e.output) if hasattr(e.output, "__len__") else 0
    return f"{count}건 찾음"


def _research_fetch_page_call(e: ToolUse) -> str | None:
    title = e.input_args.get("page_title", "")
    return f"노트 열어보는 중: ‘{title}’"


def _compiler_extract_concepts_call(_e: ToolUse) -> str | None:
    return "개념 추출 중…"


def _compiler_phase_validate(_e: PhaseTransition) -> str | None:
    return "스키마 검증 중…"


def _librarian_phase_rebuild_links(_e: PhaseTransition) -> str | None:
    return "위키 링크 재구축 중 (길어질 수 있어요)…"


def _wildcard_tool_failure(e: ToolResult) -> str | None:
    if e.ok:
        return None
    return f"{e.tool_name} 실패 → 다른 방법 시도"


def _wildcard_retry(_e: Retry) -> str | None:
    return "API가 잠깐 느리네요, 재시도 중…"


TEMPLATES: dict[tuple[str, str, str], TemplateFn] = {
    # Research
    ("research", "tool_use", "hybrid_search"): _research_hybrid_search_call,
    ("research", "tool_result", "hybrid_search"): _research_hybrid_search_result,
    ("research", "tool_use", "fetch_page"): _research_fetch_page_call,
    # Compiler
    ("compiler", "tool_use", "extract_concepts"): _compiler_extract_concepts_call,
    ("compiler", "phase_transition", "validate"): _compiler_phase_validate,
    # Librarian
    ("librarian", "phase_transition", "rebuild_links"): _librarian_phase_rebuild_links,
    # Cross-agent fallback for tool failure / retry
    ("*", "tool_result", "*"): _wildcard_tool_failure,
    ("*", "retry", "*"): _wildcard_retry,
}
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/test_humanizer.py -v
```

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/humanizer.py apps/worker/tests/test_humanizer.py
git commit -m "$(cat <<'EOF'
feat(worker): v0.1 humanizer templates (research / compiler / librarian)

Covers spec §5.2 example map. Wildcard error / retry fallback.
Suppresses model_end + unknown combos (returns None).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6: Author `docs/agents/humanizer-templates.md`

**Files:**
- Create: `docs/agents/humanizer-templates.md`

This is a review-able document — content reviewers tweak phrases here, the code's `TEMPLATES` mirrors it. (No tests; doc-only.)

- [ ] **Step 1: Write the doc**

Create `docs/agents/humanizer-templates.md`:

```markdown
# Humanizer Template Reference

Mirror of `apps/worker/src/runtime/humanizer.py::TEMPLATES`. When phrases
change, update **both**: this doc (for review) and the source (for runtime).

## Style guide (spec §5.3 condensed)

- 한국어 존댓말 + 현재진행형 (`훑는 중`)
- 주어 생략 (에이전트가 default 주어)
- 60자 클램프 (over → `…`)
- 이모지 / 토큰 수 / raw tool name 노출 금지
- 결과 정직하게: 실패면 실패, 추측 금지

## v0.1 mappings

| Agent | Event | Tool / Phase | Phrase | Kind |
|---|---|---|---|---|
| research | tool_use | hybrid_search | `‘{query}’ 관련 문서 훑는 중…` | progress |
| research | tool_result | hybrid_search | `{count}건 찾음` (ok=True) | progress |
| research | tool_use | fetch_page | `노트 열어보는 중: ‘{page_title}’` | progress |
| compiler | tool_use | extract_concepts | `개념 추출 중…` | progress |
| compiler | phase_transition | validate | `스키마 검증 중…` | phase |
| librarian | phase_transition | rebuild_links | `위키 링크 재구축 중 (길어질 수 있어요)…` | phase |
| * | tool_result (ok=False) | * | `{tool_name} 실패 → 다른 방법 시도` | error |
| * | retry | * | `API가 잠깐 느리네요, 재시도 중…` | progress |

## Suppressed (returns `None`)

- `model_end` (every agent) — token counts belong in observability, not UX
- `agent_start` / `agent_end` — implicit in stream open / close
- Any (agent, event, tool) combination not in the table above

## Adding a template

1. Add the entry to `TEMPLATES` in `humanizer.py`
2. Add a row to this doc
3. Add a unit test to `tests/test_humanizer.py`
4. PR review checks: phrase ≤ 60 chars, no emoji, ko-only, current-progressive
```

- [ ] **Step 2: Commit**

```bash
git add docs/agents/humanizer-templates.md
git commit -m "$(cat <<'EOF'
docs(agents): humanizer template review reference

Mirrors apps/worker humanizer.py TEMPLATES so non-engineers can review
phrasing without reading Python.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Worker: Stream Transformer + Debounce

### Task 7: `StatusLineDebouncer` (300 ms window, immediate-flush exceptions)

**Files:**
- Create: `apps/worker/src/runtime/humanizer_stream.py` (initial — debouncer only)
- Test: `apps/worker/tests/test_humanizer_debounce.py`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/tests/test_humanizer_debounce.py`:

```python
"""StatusLineDebouncer — 300 ms coalesce + immediate flush for phase/error/retry."""
from __future__ import annotations

import asyncio

import pytest

from runtime.events import StatusLine
from runtime.humanizer_stream import StatusLineDebouncer


def _line(text: str, kind: str = "progress", seq: int = 1) -> StatusLine:
    return StatusLine(
        run_id="r",
        workspace_id="w",
        agent_name="research",
        seq=seq,
        ts=0.0,
        text=text,
        kind=kind,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_two_lines_within_window_emit_only_last() -> None:
    deb = StatusLineDebouncer(window_ms=50)
    out: list[StatusLine] = []
    out.extend([line async for line in deb.feed(_line("a", seq=1))])
    out.extend([line async for line in deb.feed(_line("b", seq=2))])
    # Within window, both feeds should not have produced output yet.
    assert out == []
    out.extend([line async for line in deb.drain()])
    assert len(out) == 1
    assert out[0].text == "b"
    assert out[0].debounced is True


@pytest.mark.asyncio
async def test_window_elapsed_emits_first_then_second() -> None:
    deb = StatusLineDebouncer(window_ms=20)
    out: list[StatusLine] = []
    out.extend([line async for line in deb.feed(_line("a", seq=1))])
    await asyncio.sleep(0.05)
    out.extend([line async for line in deb.feed(_line("b", seq=2))])
    out.extend([line async for line in deb.drain()])
    assert [l.text for l in out] == ["a", "b"]


@pytest.mark.asyncio
async def test_phase_kind_flushes_immediately() -> None:
    deb = StatusLineDebouncer(window_ms=200)
    out: list[StatusLine] = []
    out.extend([line async for line in deb.feed(_line("a", seq=1))])
    out.extend(
        [line async for line in deb.feed(_line("phase!", kind="phase", seq=2))]
    )
    # Pending "a" must flush first, then phase.
    assert [l.text for l in out] == ["a", "phase!"]


@pytest.mark.asyncio
async def test_error_kind_flushes_immediately() -> None:
    deb = StatusLineDebouncer(window_ms=200)
    out: list[StatusLine] = []
    out.extend([line async for line in deb.feed(_line("a", seq=1))])
    out.extend([line async for line in deb.feed(_line("oops", kind="error", seq=2))])
    assert [l.text for l in out] == ["a", "oops"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_humanizer_debounce.py -v
```

Expected: ImportError (no `runtime.humanizer_stream`).

- [ ] **Step 3: Implement `StatusLineDebouncer`**

Create `apps/worker/src/runtime/humanizer_stream.py`:

```python
"""Stream transformer wrapping AgentEvent → AgentEvent + debounced StatusLine.

Debounce semantics (spec §6):
  · same-kind progress lines within `window_ms` collapse to the latest
  · `phase`, `error`, plus Retry / RouteDecision flush immediately, with
    any pending progress line flushed *first* (FIFO preserved).
"""
from __future__ import annotations

import time
from typing import AsyncIterator

from runtime.events import AgentEvent, StatusLine

DEFAULT_WINDOW_MS = 300

_IMMEDIATE_KINDS = frozenset({"phase", "error"})


class StatusLineDebouncer:
    def __init__(self, window_ms: int = DEFAULT_WINDOW_MS) -> None:
        self._window_s = window_ms / 1000.0
        self._pending: StatusLine | None = None
        self._pending_at: float = 0.0

    def _now(self) -> float:
        return time.monotonic()

    async def feed(self, line: StatusLine) -> AsyncIterator[StatusLine]:
        if line.kind in _IMMEDIATE_KINDS:
            if self._pending is not None:
                yield self._pending
                self._pending = None
            yield line
            return

        # Progress / info lines — replace pending if still inside window.
        if self._pending is not None:
            if self._now() - self._pending_at < self._window_s:
                # Replace silently; mark debounced so the UI can decide to
                # animate the swap.
                self._pending = line.model_copy(update={"debounced": True})
                self._pending_at = self._now()
                return
            # Window elapsed — emit pending, latch new.
            yield self._pending
        self._pending = line
        self._pending_at = self._now()

    async def drain(self) -> AsyncIterator[StatusLine]:
        if self._pending is not None:
            yield self._pending.model_copy(update={"debounced": True})
            self._pending = None


__all__ = ["StatusLineDebouncer", "DEFAULT_WINDOW_MS"]
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/test_humanizer_debounce.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/humanizer_stream.py apps/worker/tests/test_humanizer_debounce.py
git commit -m "$(cat <<'EOF'
feat(worker): StatusLineDebouncer — 300ms coalesce + immediate-flush exceptions

Spec §6 rate control. Pending progress line flushes ahead of any phase/
error so user sees both transitions in order.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 8: `humanized_event_stream()` async generator

**Files:**
- Modify: `apps/worker/src/runtime/humanizer_stream.py`
- Modify: `apps/worker/src/runtime/__init__.py` (re-export)
- Test: `apps/worker/tests/test_humanizer_stream.py`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/tests/test_humanizer_stream.py`:

```python
"""humanized_event_stream — passthrough + StatusLine emission."""
from __future__ import annotations

from typing import AsyncIterator

import pytest

from runtime.events import (
    AgentEnd,
    AgentEvent,
    AgentStart,
    PhaseTransition,
    Retry,
    StatusLine,
    ToolResult,
    ToolUse,
)
from runtime.humanizer_stream import humanized_event_stream


def _b(seq: int) -> dict:
    return {
        "run_id": "r",
        "workspace_id": "w",
        "agent_name": "research",
        "seq": seq,
        "ts": 0.0,
    }


async def _yields(seq: list[AgentEvent]) -> AsyncIterator[AgentEvent]:
    for e in seq:
        yield e


@pytest.mark.asyncio
async def test_passthrough_plus_status_lines() -> None:
    src = [
        AgentStart(**_b(1), scope="page", input={}),
        ToolUse(
            **_b(2),
            tool_call_id="tc",
            tool_name="hybrid_search",
            input_args={"query": "X"},
            input_hash="h",
            concurrency_safe=True,
        ),
        ToolResult(
            **_b(3),
            tool_call_id="tc",
            tool_name="hybrid_search",
            ok=True,
            output=[1, 2],
            duration_ms=10,
        ),
        AgentEnd(**_b(4), output={}, duration_ms=20),
    ]
    out: list[AgentEvent] = []
    async for ev in humanized_event_stream(_yields(src), agent_type="research"):
        out.append(ev)
    types = [e.type for e in out]
    # Original 4 events MUST be present in order; status_line is interleaved.
    src_seq = [e for e in out if e.type != "status_line"]
    assert [e.type for e in src_seq] == [
        "agent_start",
        "tool_use",
        "tool_result",
        "agent_end",
    ]
    assert "status_line" in types
    # The two ToolUse/Result lines map to two status lines, but debounce
    # collapses them — accept either 1 or 2 lines in the output (final
    # drain always emits the latest).
    status_lines = [e for e in out if isinstance(e, StatusLine)]
    assert 1 <= len(status_lines) <= 2


@pytest.mark.asyncio
async def test_unknown_combo_does_not_emit_status_line() -> None:
    src = [
        AgentStart(**_b(1), scope="page", input={}),
        ToolUse(
            **_b(2),
            tool_call_id="tc",
            tool_name="totally_unknown",
            input_args={},
            input_hash="h",
            concurrency_safe=True,
        ),
        AgentEnd(**_b(3), output={}, duration_ms=5),
    ]
    out: list[AgentEvent] = []
    async for ev in humanized_event_stream(_yields(src), agent_type="research"):
        out.append(ev)
    assert not any(isinstance(e, StatusLine) for e in out)


@pytest.mark.asyncio
async def test_phase_flushes_pending_progress_in_order() -> None:
    src = [
        ToolUse(
            **_b(1),
            tool_call_id="tc",
            tool_name="hybrid_search",
            input_args={"query": "X"},
            input_hash="h",
            concurrency_safe=True,
        ),
        PhaseTransition(**_b(2), agent_name="compiler", phase="validate"),
        AgentEnd(**_b(3), output={}, duration_ms=5),
    ]
    out: list[AgentEvent] = []
    async for ev in humanized_event_stream(_yields(src), agent_type="research"):
        out.append(ev)
    status_lines = [e for e in out if isinstance(e, StatusLine)]
    # First line is the (debounced or fresh) hybrid_search progress; second
    # is the compiler validate phase. Order must be progress-then-phase.
    kinds = [l.kind for l in status_lines]
    assert kinds[-1] == "phase"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_humanizer_stream.py -v
```

Expected: ImportError (`humanized_event_stream` undefined).

- [ ] **Step 3: Implement `humanized_event_stream`**

Append to `apps/worker/src/runtime/humanizer_stream.py`:

```python
from typing import AsyncIterator
from runtime.humanizer import humanize


async def humanized_event_stream(
    events: AsyncIterator[AgentEvent],
    agent_type: str,
    *,
    window_ms: int = DEFAULT_WINDOW_MS,
) -> AsyncIterator[AgentEvent]:
    """Wrap an AgentEvent stream, yielding originals plus debounced StatusLines.

    The transformer is *additive*: every upstream event is forwarded
    unmodified, and StatusLine events are interleaved at debounce flush
    points. Trajectory writers / token counters / API SSE all see one
    coherent stream.
    """
    debouncer = StatusLineDebouncer(window_ms=window_ms)
    async for event in events:
        # Always pass the upstream event through.
        yield event
        # Skip humanizing StatusLines (they've already been humanized) and
        # ThoughtSummary deltas (forwarded raw to the renderer).
        if event.type in ("status_line", "thought_summary", "route_decision"):
            continue
        line = humanize(event, agent_type)
        if line is None:
            continue
        async for flushed in debouncer.feed(line):
            yield flushed
    async for flushed in debouncer.drain():
        yield flushed
```

Update `apps/worker/src/runtime/__init__.py` to re-export:

```python
from runtime.humanizer import humanize, truncate_phrase
from runtime.humanizer_stream import (
    DEFAULT_WINDOW_MS,
    StatusLineDebouncer,
    humanized_event_stream,
)
```

…and add `"humanize"`, `"humanized_event_stream"`, `"StatusLineDebouncer"`, `"DEFAULT_WINDOW_MS"`, `"truncate_phrase"` to `__all__` (alphabetical).

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/test_humanizer_stream.py tests/test_humanizer_debounce.py tests/test_humanizer.py -v
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/humanizer_stream.py apps/worker/src/runtime/__init__.py apps/worker/tests/test_humanizer_stream.py
git commit -m "$(cat <<'EOF'
feat(worker): humanized_event_stream additive transformer

Forwards every upstream AgentEvent and interleaves debounced StatusLine
events. Re-exported from runtime facade alongside humanize().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 9: Worker baseline regression — full pytest suite

- [ ] **Step 1: Run the entire worker suite**

```bash
cd apps/worker
uv run pytest -q
```

Expected: green (no regression vs Plan 8 baseline 65/65 + later additions).

- [ ] **Step 2: If anything fails, investigate root cause** — do NOT skip or mock around it. Most likely culprit: a fixture that loads the AgentEvent union and now sees 14 types instead of 9.

- [ ] **Step 3: Commit any baseline fix separately** (if needed):

```bash
git commit -m "fix(worker): adjust <fixture> for expanded AgentEvent union"
```

---

## Phase 4 — LLM: Gemini Thinking Summaries

### Task 10: `LLMProvider.thinking_summaries_supported(model_id)`

**Files:**
- Modify: `packages/llm/src/llm/base.py`
- Test: `packages/llm/tests/test_thinking_supported.py`

- [ ] **Step 1: Write the failing test**

Create `packages/llm/tests/test_thinking_supported.py`:

```python
"""Provider-level thinking_summaries capability flag."""
from __future__ import annotations

import pytest

from llm.base import LLMProvider


def test_provider_must_implement_thinking_summaries_supported() -> None:
    # Abstract method check — concrete providers without an override fail.
    class Stub(LLMProvider):
        provider_name = "stub"

        async def chat(self, **_kw):  # type: ignore[override]
            raise NotImplementedError

    with pytest.raises(TypeError):
        Stub()  # type: ignore[abstract]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/llm
uv run pytest tests/test_thinking_supported.py -v
```

Expected: test passes if Stub raises TypeError; if not, fail (because the abstract isn't there yet — `Stub()` instantiates, no error).

- [ ] **Step 3: Add the abstract method**

In `packages/llm/src/llm/base.py`, add to the `LLMProvider` class:

```python
from abc import abstractmethod


class LLMProvider(...):  # existing
    ...

    @abstractmethod
    def thinking_summaries_supported(self, model_id: str) -> bool:
        """Return True if `model_id` exposes streaming thought summaries.

        Callers (Research / Librarian / Deep Research) gate the
        `thinking_summaries: "auto"` config on this — passing the option to a
        provider that doesn't support it must be a silent no-op, not an
        error (spec §4.3).
        """
```

> **Locate the actual `LLMProvider` class signature** in `base.py` and add the method as a sibling of the existing abstract methods. Match the file's existing style (e.g., async vs sync — sync is correct here, it's a capability check, not an I/O call).

- [ ] **Step 4: Run test to verify it passes**

```bash
uv run pytest tests/test_thinking_supported.py -v
```

Expected: 1 passed.

- [ ] **Step 5: Don't commit yet** — concrete providers below need the override before the suite is green.

### Task 11: Gemini provider implements `thinking_summaries_supported` + plumbs `thinking_summaries: "auto"`

**Files:**
- Modify: `packages/llm/src/llm/gemini.py`
- Test: `packages/llm/tests/test_gemini_thoughts.py`

- [ ] **Step 1: Write the failing test**

Create `packages/llm/tests/test_gemini_thoughts.py`:

```python
"""GeminiProvider — capability flag + thinking_summaries plumbing."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from llm.gemini import GeminiProvider


def test_supported_models() -> None:
    p = GeminiProvider(api_key="dummy")
    assert p.thinking_summaries_supported("gemini-2.5-pro") is True
    assert p.thinking_summaries_supported("gemini-2.5-flash") is True
    assert p.thinking_summaries_supported("gemini-1.5-pro") is False


@pytest.mark.asyncio
async def test_thinking_summaries_flag_threaded_into_request() -> None:
    p = GeminiProvider(api_key="dummy")

    captured: dict = {}

    async def fake_create(**kwargs):
        captured.update(kwargs)
        chunk = MagicMock()
        chunk.event_type = "content.delta"
        chunk.delta.type = "text"
        chunk.delta.text = "hi"

        async def _aiter():
            yield chunk

        return _aiter()

    p._client = MagicMock()
    p._client.interactions.create = fake_create  # type: ignore[attr-defined]

    out: list[dict] = []
    async for ev in p.stream_with_thoughts(
        model_id="gemini-2.5-pro",
        prompt=[{"role": "user", "parts": ["hi"]}],
    ):
        out.append(ev)

    # The agent_config must carry "thinking_summaries": "auto".
    assert captured.get("agent_config", {}).get("thinking_summaries") == "auto"
    assert any(e["kind"] == "text" and e["text"] == "hi" for e in out)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_gemini_thoughts.py -v
```

Expected: AttributeError (`stream_with_thoughts` undefined) or method missing.

- [ ] **Step 3: Implement on `GeminiProvider`**

> **Locate the `GeminiProvider` class** in `packages/llm/src/llm/gemini.py`. The existing chat / generate methods already use `client.interactions.create(...)` with streaming. Add:

```python
SUPPORTED_THINKING_MODELS = frozenset({"gemini-2.5-pro", "gemini-2.5-flash"})


class GeminiProvider(LLMProvider):  # existing class — extend
    # ... existing methods unchanged

    def thinking_summaries_supported(self, model_id: str) -> bool:
        return model_id in SUPPORTED_THINKING_MODELS

    async def stream_with_thoughts(
        self,
        *,
        model_id: str,
        prompt,
        **kwargs,
    ):
        """Async iterator yielding {kind: "thought_summary"|"text", ...} dicts.

        The shape is provider-agnostic so the worker can fan out to
        ThoughtSummary / model_end events without leaking SDK types.
        """
        agent_config = kwargs.pop("agent_config", {})
        if self.thinking_summaries_supported(model_id):
            agent_config = {**agent_config, "thinking_summaries": "auto"}
        else:
            # Silently drop — not all model_ids accept the option.
            agent_config = {**agent_config}
        stream = await self._client.interactions.create(
            input=prompt,
            model=model_id,
            agent_config=agent_config,
            stream=True,
            **kwargs,
        )
        delta_index = 0
        async for chunk in stream:
            if getattr(chunk, "event_type", None) != "content.delta":
                continue
            delta = chunk.delta
            kind = getattr(delta, "type", None)
            if kind == "thought_summary":
                yield {
                    "kind": "thought_summary",
                    "text": delta.content.text,
                    "delta_index": delta_index,
                }
                delta_index += 1
            elif kind == "text":
                yield {"kind": "text", "text": delta.text}
```

> **Important:** if your branch's `gemini.py` exposes a sync `genai.GenerativeModel` rather than the new `interactions` API, see `docs/contributing/llm-antipatterns.md` §13 — the SDK signature must be verified against `model_validate` fixtures, not assumed from this plan. Open `packages/llm/src/llm/gemini.py` first and adapt the `_client.interactions.create` call to match the existing helper.

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/test_gemini_thoughts.py tests/test_thinking_supported.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit Task 10 + Task 11 together**

```bash
git add packages/llm/src/llm/base.py packages/llm/src/llm/gemini.py packages/llm/tests/test_thinking_supported.py packages/llm/tests/test_gemini_thoughts.py
git commit -m "$(cat <<'EOF'
feat(llm): gemini thinking_summaries plumbing + capability flag

LLMProvider grows abstract thinking_summaries_supported(model_id).
GeminiProvider yields {kind: "thought_summary"|"text", ...} chunks via new
stream_with_thoughts(); flag dropped silently for unsupported model_ids.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 12: Ollama provider stub override

**Files:**
- Modify: `packages/llm/src/llm/ollama.py`
- Test: append to `packages/llm/tests/test_thinking_supported.py`

- [ ] **Step 1: Write the failing test**

Append to `packages/llm/tests/test_thinking_supported.py`:

```python
def test_ollama_provider_returns_false_until_qwq_added() -> None:
    from llm.ollama import OllamaProvider

    p = OllamaProvider(base_url="http://localhost:11434")
    # Ollama models are not modelled here yet — return False uniformly.
    assert p.thinking_summaries_supported("llama3:8b") is False
    assert p.thinking_summaries_supported("qwq:32b") is False
```

- [ ] **Step 2: Run test to verify it fails**

```bash
uv run pytest tests/test_thinking_supported.py::test_ollama_provider_returns_false_until_qwq_added -v
```

Expected: TypeError (abstract method not implemented).

- [ ] **Step 3: Implement on `OllamaProvider`**

```python
class OllamaProvider(LLMProvider):
    # ... existing methods

    def thinking_summaries_supported(self, model_id: str) -> bool:
        # No reasoning-trace surface from Ollama yet (QwQ / DeepSeek-R1
        # ship `<think>` tags in completion text but the SDK doesn't split
        # them into a structured stream). Spec §4.3 says graceful skip.
        return False
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest tests/ -v
```

Expected: green for the LLM package.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/ollama.py packages/llm/tests/test_thinking_supported.py
git commit -m "$(cat <<'EOF'
feat(llm): ollama provider declines thinking_summaries (graceful skip)

Spec §4.3 — option dropped silently for providers without a structured
reasoning-trace surface. QwQ/DeepSeek-R1 emit <think> in completion text
but no split stream, so v0.1 returns False uniformly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Shared Zod Contract

### Task 13: Zod schemas for new agent events

**Files:**
- Create: `packages/shared/src/schemas/agent-events.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/agent-events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/agent-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PhaseTransitionSchema,
  RetrySchema,
  RouteDecisionSchema,
  StatusLineSchema,
  ThoughtSummarySchema,
} from "../src/schemas/agent-events";

describe("agent-events Zod schemas", () => {
  it("StatusLine round-trips with required fields", () => {
    const parsed = StatusLineSchema.parse({
      type: "status_line",
      text: "찾는 중",
      kind: "progress",
    });
    expect(parsed.kind).toBe("progress");
    expect(parsed.debounced).toBe(false);
  });

  it("StatusLine rejects unknown kind", () => {
    expect(() =>
      StatusLineSchema.parse({ type: "status_line", text: "x", kind: "wat" }),
    ).toThrow();
  });

  it("ThoughtSummary requires delta_index", () => {
    expect(() =>
      ThoughtSummarySchema.parse({ type: "thought_summary", text: "..." }),
    ).toThrow();
    expect(
      ThoughtSummarySchema.parse({
        type: "thought_summary",
        text: "...",
        delta_index: 0,
      }).delta_index,
    ).toBe(0);
  });

  it("PhaseTransition allows null reason", () => {
    expect(
      PhaseTransitionSchema.parse({ type: "phase_transition", phase: "search" })
        .reason,
    ).toBeNull();
  });

  it("Retry requires attempt + reason", () => {
    expect(
      RetrySchema.parse({
        type: "retry",
        tool_name: "hybrid_search",
        attempt: 2,
        reason: "timeout",
      }).attempt,
    ).toBe(2);
  });

  it("RouteDecision carries chosen_model", () => {
    expect(
      RouteDecisionSchema.parse({
        type: "route_decision",
        chosen_model: "gemini-2.5-pro",
        reason: "ctx",
      }).chosen_model,
    ).toBe("gemini-2.5-pro");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/shared test -- agent-events
```

Expected: import error / file not found.

- [ ] **Step 3: Implement the schemas**

Create `packages/shared/src/schemas/agent-events.ts`:

```ts
import { z } from "zod";

// Wire schemas mirror apps/worker/src/runtime/events.py:
//   ThoughtSummary / PhaseTransition / StatusLine / Retry / RouteDecision
// The Python side is the source of truth; this module exists so the API
// (Hono) and Web (Next.js) get end-to-end TypeScript narrowing on what
// crosses the SSE boundary. Keep field names snake_case to match Python's
// JSON output — do NOT camelCase here, otherwise the wire format diverges.

export const StatusLineKindEnum = z.enum(["info", "progress", "error", "phase"]);
export type StatusLineKind = z.infer<typeof StatusLineKindEnum>;

export const StatusLineSchema = z.object({
  type: z.literal("status_line"),
  text: z.string(),
  kind: StatusLineKindEnum,
  phase: z.string().nullable().optional(),
  debounced: z.boolean().default(false),
});
export type StatusLineMessage = z.infer<typeof StatusLineSchema>;

export const ThoughtSummarySchema = z.object({
  type: z.literal("thought_summary"),
  text: z.string(),
  delta_index: z.number().int().nonnegative(),
});
export type ThoughtSummaryMessage = z.infer<typeof ThoughtSummarySchema>;

export const PhaseTransitionSchema = z.object({
  type: z.literal("phase_transition"),
  phase: z.string(),
  reason: z.string().nullable().default(null),
});
export type PhaseTransitionMessage = z.infer<typeof PhaseTransitionSchema>;

export const RetrySchema = z.object({
  type: z.literal("retry"),
  tool_name: z.string(),
  attempt: z.number().int().min(1),
  reason: z.string(),
});
export type RetryMessage = z.infer<typeof RetrySchema>;

export const RouteDecisionSchema = z.object({
  type: z.literal("route_decision"),
  chosen_model: z.string(),
  reason: z.string(),
});
export type RouteDecisionMessage = z.infer<typeof RouteDecisionSchema>;

export const HumanizerEventSchema = z.discriminatedUnion("type", [
  StatusLineSchema,
  ThoughtSummarySchema,
  PhaseTransitionSchema,
  RetrySchema,
  RouteDecisionSchema,
]);
export type HumanizerEvent = z.infer<typeof HumanizerEventSchema>;
```

Edit `packages/shared/src/index.ts`. Append:

```ts
export * from "./schemas/agent-events";
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @opencairn/shared test
```

Expected: all green incl. 6 new agent-events tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/agent-events.ts packages/shared/src/index.ts packages/shared/tests/agent-events.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): zod schemas for humanizer wire types

5 schemas (StatusLine/ThoughtSummary/PhaseTransition/Retry/RouteDecision)
plus discriminated union. Field names snake_case to match python json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — DB: `cancelled` Message Status

### Task 14: Add `'cancelled'` to `messageStatusEnum`

**Files:**
- Modify: `packages/db/src/schema/enums.ts`
- Create: `packages/db/drizzle/0034_chat_messages_cancelled.sql`

- [ ] **Step 1: Edit the enum**

In `packages/db/src/schema/enums.ts`, replace the `messageStatusEnum` definition:

```ts
// Streaming persistence states for chat-messages.ts `status` column.
//   `streaming` → placeholder inserted before SSE emits, so a crash mid-
//                 stream leaves a row we can recover instead of a ghost.
//   `complete`  → stream ended cleanly (the steady-state value).
//   `failed`    → pipeline threw; partial buffer preserved for retry UI.
//   `cancelled` → user pressed Stop; partial buffer preserved (humanizer
//                 spec §13.3). Distinct from `failed` so the renderer can
//                 mark the row "취소됨" rather than "오류" — they look
//                 the same on the wire (no exception) but differ in UX.
export const messageStatusEnum = pgEnum("message_status", [
  "streaming",
  "complete",
  "failed",
  "cancelled",
]);
```

- [ ] **Step 2: Generate migration**

```bash
pnpm db:generate
```

Drizzle should produce a migration adding the enum value. **If the generator names it something other than `0034_chat_messages_cancelled.sql`, rename the file** (`mv packages/db/drizzle/0034_<auto>.sql packages/db/drizzle/0034_chat_messages_cancelled.sql`) and update `packages/db/drizzle/meta/_journal.json` so the entry's `tag` matches.

- [ ] **Step 3: Verify migration content**

The generated SQL should be roughly:

```sql
ALTER TYPE "public"."message_status" ADD VALUE 'cancelled';
```

If Drizzle generated a more complex migration (drop+recreate), edit it down to the single ADD VALUE statement — Postgres supports this transactionally without table rewrite.

- [ ] **Step 4: Apply locally**

```bash
pnpm --filter @opencairn/db migrate
```

Expected: migration applies. Validate via psql:

```bash
psql $DATABASE_URL -c "SELECT enum_range(NULL::message_status);"
```

Expected output includes `cancelled`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/enums.ts packages/db/drizzle/0034_chat_messages_cancelled.sql packages/db/drizzle/meta/_journal.json
git commit -m "$(cat <<'EOF'
feat(db): add 'cancelled' to message_status enum (migration 0034)

User-initiated cancel needs to be distinguishable from pipeline failure;
spec §13.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — API: SSE Wiring

### Task 15: `FEATURE_AGENT_HUMANIZER` flag helper

**Files:**
- Modify or create: `apps/api/src/lib/feature-flags.ts`
- Test: `apps/api/tests/lib/feature-flags.test.js`

> **Check first** whether `apps/api/src/lib/feature-flags.ts` already exists from earlier plans (Plan 3b / Plan 7 / Deep Research all introduced flags). If yes, append the new helper. If not, create the file.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/lib/feature-flags.test.js`:

```js
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isHumanizerEnabled } from "../../src/lib/feature-flags.js";

describe("feature-flags humanizer", () => {
  let prev;
  beforeEach(() => {
    prev = process.env.FEATURE_AGENT_HUMANIZER;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.FEATURE_AGENT_HUMANIZER;
    else process.env.FEATURE_AGENT_HUMANIZER = prev;
  });

  it("returns false when env var unset", () => {
    delete process.env.FEATURE_AGENT_HUMANIZER;
    expect(isHumanizerEnabled()).toBe(false);
  });

  it("returns true for '1'", () => {
    process.env.FEATURE_AGENT_HUMANIZER = "1";
    expect(isHumanizerEnabled()).toBe(true);
  });

  it("returns true for 'true' (case-insensitive)", () => {
    process.env.FEATURE_AGENT_HUMANIZER = "TRUE";
    expect(isHumanizerEnabled()).toBe(true);
  });

  it("returns false for '0' or 'false'", () => {
    process.env.FEATURE_AGENT_HUMANIZER = "0";
    expect(isHumanizerEnabled()).toBe(false);
    process.env.FEATURE_AGENT_HUMANIZER = "false";
    expect(isHumanizerEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

If `apps/api/src/lib/feature-flags.ts` doesn't exist, create it. Otherwise append:

```ts
export function isHumanizerEnabled(): boolean {
  const raw = process.env.FEATURE_AGENT_HUMANIZER;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}
```

- [ ] **Step 3: Run test**

```bash
pnpm --filter @opencairn/api test -- feature-flags
```

Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/feature-flags.ts apps/api/tests/lib/feature-flags.test.js
git commit -m "$(cat <<'EOF'
feat(api): isHumanizerEnabled() flag helper

Reads FEATURE_AGENT_HUMANIZER env. Default off — no behaviour change until
explicitly enabled per spec rollout (§12).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 16: Widen `AgentChunkType` in `agent-pipeline.ts` + emit new chunks behind flag

**Files:**
- Modify: `apps/api/src/lib/agent-pipeline.ts`

- [ ] **Step 1: Read current shape**

Open `apps/api/src/lib/agent-pipeline.ts` (already read during planning). Current `AgentChunkType` is:

```ts
export type AgentChunkType =
  | "status"
  | "thought"
  | "text"
  | "citation"
  | "save_suggestion"
  | "done";
```

- [ ] **Step 2: Add new types + flag-gated stub emissions**

Replace the type union and the stub generator:

```ts
import { isHumanizerEnabled } from "./feature-flags";

export type AgentChunkType =
  | "status"
  | "status_line"        // humanizer: full StatusLine (kind/phase/debounced)
  | "thought"
  | "thought_summary"    // gemini delta
  | "phase_transition"
  | "retry"
  | "route_decision"
  | "text"
  | "citation"
  | "save_suggestion"
  | "cancelled"
  | "done";
```

Then update `runAgent`:

```ts
export async function* runAgent(opts: {
  threadId: string;
  userMessage: { content: string; scope?: unknown };
  mode: ChatMode;
}): AsyncGenerator<AgentChunk> {
  const humanizer = isHumanizerEnabled();

  if (humanizer) {
    // Stub-richer flow: emit one phase_transition + status_line + thought
    // delta sequence so the wire format is exercised end-to-end without a
    // real worker. Real worker integration replaces the body of this branch.
    yield {
      type: "phase_transition",
      payload: { phase: "search", reason: null },
    };
    yield {
      type: "status_line",
      payload: {
        text: "관련 문서 훑는 중…",
        kind: "progress",
        debounced: false,
      },
    };
    for (const ch of "사용자의 질문 분석") {
      yield {
        type: "thought_summary",
        payload: { text: ch, delta_index: 0 },
      };
      await new Promise((r) => setTimeout(r, 4));
    }
  } else {
    // Pre-humanizer behaviour (Phase 4 stub).
    yield { type: "status", payload: { phrase: "관련 문서 훑는 중..." } };
    yield {
      type: "thought",
      payload: { summary: "사용자의 질문 분석 중", tokens: 120 },
    };
  }

  const body = `(stub agent response to: ${opts.userMessage.content})`;
  for (const ch of body) {
    yield { type: "text", payload: { delta: ch } };
    await new Promise((r) => setTimeout(r, 4));
  }
  if (
    process.env.AGENT_STUB_EMIT_SAVE_SUGGESTION === "1" &&
    opts.userMessage.content.includes("/test-save")
  ) {
    yield {
      type: "save_suggestion",
      payload: {
        title: "Test note from chat",
        body_markdown: "# Test note\n\nGenerated by stub flag.",
      },
    };
  }
  yield { type: "done", payload: {} };
}
```

(Keep `createStreamingAgentMessage` and `finalizeAgentMessage` unchanged — they continue to handle `'streaming' | 'complete' | 'failed'`. `'cancelled'` is added in Task 17.)

- [ ] **Step 3: Update `finalizeAgentMessage` to accept `'cancelled'`**

```ts
export async function finalizeAgentMessage(
  messageId: string,
  content: object,
  status: "complete" | "failed" | "cancelled",
) {
  const [row] = await db
    .update(chatMessages)
    .set({ content, status })
    .where(eq(chatMessages.id, messageId))
    .returning();
  return row;
}
```

- [ ] **Step 4: Quick smoke test**

```bash
pnpm --filter @opencairn/api typecheck
pnpm --filter @opencairn/api test -- agent-pipeline 2>/dev/null || true
```

Expected: typecheck green. (If a test for `agent-pipeline.ts` exists, it should still pass; new chunk types are additive.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/agent-pipeline.ts
git commit -m "$(cat <<'EOF'
feat(api): widen agent-pipeline AgentChunkType for humanizer wire format

Adds status_line/thought_summary/phase_transition/retry/route_decision/
cancelled chunk types. Stub gates new emissions behind FEATURE_AGENT_HUMANIZER;
flag off → exact pre-existing chunks (no regression).

finalizeAgentMessage now accepts 'cancelled' status (matches DB enum 0034).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 17: `threads.ts` — detect client abort → `streamStatus = "cancelled"`

**Files:**
- Modify: `apps/api/src/routes/threads.ts:286-330`
- Test: `apps/api/tests/routes/threads-cancel.test.js`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/routes/threads-cancel.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { db, chatMessages, eq } from "@opencairn/db";

import {
  __setRunAgentImpl,
  postMessage as _unused, // ensure module loads
} from "../../src/routes/threads.js";

describe("threads.ts cancel handling", () => {
  it("aborting the request mid-stream finalizes the row as 'cancelled'", async () => {
    // Mock runAgent to yield deltas slowly so the abort lands mid-stream.
    __setRunAgentImpl(async function* () {
      for (let i = 0; i < 100; i++) {
        yield { type: "text", payload: { delta: "x" } };
        await new Promise((r) => setTimeout(r, 5));
      }
      yield { type: "done", payload: {} };
    });

    const ac = new AbortController();
    const reqPromise = fetch("http://test/api/threads/<seeded-thread>/messages", {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ content: "go" }),
    }).catch((err) => err);

    setTimeout(() => ac.abort(), 30);
    await reqPromise;

    // Inspect DB — the streaming agent row should now have status='cancelled'.
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.role, "agent"));
    const last = rows[rows.length - 1];
    expect(last.status).toBe("cancelled");
  });
});
```

> The test depends on the API test harness's app instance + seeded thread. If your harness uses a different fetch pattern (Hono direct invocation, supertest), adapt accordingly — the assertion is what matters: `status === "cancelled"` after a mid-stream abort.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/api test -- threads-cancel
```

Expected: `last.status === "complete"` or `"failed"` instead of `"cancelled"`.

- [ ] **Step 3: Edit `threads.ts`**

In `apps/api/src/routes/threads.ts`, replace the streaming block around lines 286-333:

```ts
const buffer: string[] = [];
const meta: Record<string, unknown> = {};
let streamStatus: "complete" | "failed" | "cancelled" = "complete";
try {
  for await (const chunk of runAgentImpl({
    threadId: id,
    userMessage: { content, scope },
    mode,
  })) {
    if (closed) {
      // Client disconnected — record this as a user-initiated cancel.
      // Distinguishing cancel from a generic SSE drop is intentional: a
      // browser tab close, a `fetch` abort, and an explicit Stop click
      // all path through here. Treating them all as `cancelled` is fine
      // for accounting (no partial-credit refund logic in v0.1) and
      // keeps the schema honest — `failed` should mean the worker threw,
      // not "we lost the socket".
      streamStatus = "cancelled";
      break;
    }
    if (chunk.type === "text") {
      const p = chunk.payload as { delta: string };
      buffer.push(p.delta);
    } else if (chunk.type === "status") {
      meta.status = chunk.payload;
    } else if (chunk.type === "status_line") {
      // The renderer treats status_line and the legacy `status` chunk
      // the same way — store under one key. Latest wins.
      meta.status = chunk.payload;
    } else if (chunk.type === "thought") {
      meta.thought = chunk.payload;
    } else if (chunk.type === "thought_summary") {
      const p = chunk.payload as { text: string; delta_index: number };
      const prev = (meta.thought_summary as string | undefined) ?? "";
      meta.thought_summary = prev + p.text;
    } else if (chunk.type === "phase_transition") {
      meta.phase = (chunk.payload as { phase: string }).phase;
    } else if (chunk.type === "retry") {
      meta.last_retry = chunk.payload;
    } else if (chunk.type === "citation") {
      meta.citations = [
        ...((meta.citations as unknown[]) ?? []),
        chunk.payload,
      ];
    } else if (chunk.type === "save_suggestion") {
      meta.save_suggestion = chunk.payload;
    }
    send(chunk.type, chunk.payload);
  }
} catch (err) {
  streamStatus = "failed";
  send("error", {
    message: err instanceof Error ? err.message : "agent_failed",
  });
} finally {
  await finalizeAgentMessage(
    agentId,
    { body: buffer.join(""), ...meta },
    streamStatus,
  );
}

if (streamStatus === "cancelled") {
  send("cancelled", { id: agentId });
}
send("done", { id: agentId, status: streamStatus });
cleanup();
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter @opencairn/api test -- threads-cancel
```

Expected: passes.

- [ ] **Step 5: Run the broader threads test file** to ensure no regression:

```bash
pnpm --filter @opencairn/api test -- threads
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/threads.ts apps/api/tests/routes/threads-cancel.test.js
git commit -m "$(cat <<'EOF'
feat(api): threads SSE cancel → status='cancelled' + new chunk pass-through

Client abort now finalizes the agent row as cancelled (DB enum 0034).
Forwards status_line/thought_summary/phase_transition/retry into the meta
sidecar so re-renders survive a refresh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 18: `chat.ts` — flag-gated humanizer chunks (parity with threads.ts)

**Files:**
- Modify: `apps/api/src/routes/chat.ts:346-420`
- Test: `apps/api/tests/routes/chat-humanizer.test.js`

> Plan 11A's `/api/chat/message` is a placeholder — its long-term fate is to be replaced by a real worker call. Until then, when the flag is on, emit the same chunk vocabulary as `agent-pipeline.ts` so the web client can be developed/tested against one wire format.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/routes/chat-humanizer.test.js`:

```js
import { describe, expect, it, beforeEach, afterEach } from "vitest";
// Pseudocode harness — adapt to whatever pattern apps/api uses.
import { app } from "../../src/app.js";

async function collectSSE(res) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = block.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event: "));
      const dataLine = lines.find((l) => l.startsWith("data: "));
      if (eventLine && dataLine) {
        events.push({
          event: eventLine.slice(7),
          data: JSON.parse(dataLine.slice(6)),
        });
      }
    }
  }
  return events;
}

describe("chat.ts /message flag-gated humanizer", () => {
  let prev;
  beforeEach(() => {
    prev = process.env.FEATURE_AGENT_HUMANIZER;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.FEATURE_AGENT_HUMANIZER;
    else process.env.FEATURE_AGENT_HUMANIZER = prev;
  });

  it("flag off — emits delta + cost + done only", async () => {
    process.env.FEATURE_AGENT_HUMANIZER = "0";
    const res = await app.request("/api/chat/message", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ conversationId: "<seeded>", content: "hi" }),
    });
    const events = await collectSSE(res);
    const types = new Set(events.map((e) => e.event));
    expect(types.has("delta")).toBe(true);
    expect(types.has("cost")).toBe(true);
    expect(types.has("done")).toBe(true);
    expect(types.has("status_line")).toBe(false);
  });

  it("flag on — emits status_line + thought_summary + done", async () => {
    process.env.FEATURE_AGENT_HUMANIZER = "1";
    const res = await app.request("/api/chat/message", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ conversationId: "<seeded>", content: "hi" }),
    });
    const events = await collectSSE(res);
    const types = new Set(events.map((e) => e.event));
    expect(types.has("status_line")).toBe(true);
    expect(types.has("thought_summary")).toBe(true);
    expect(types.has("done")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/api test -- chat-humanizer
```

Expected: failure on the second case (`status_line` not present).

- [ ] **Step 3: Edit `chat.ts`**

In `apps/api/src/routes/chat.ts:346-420`, modify the `streamSSE` body to gate humanizer emissions:

```ts
import { isHumanizerEnabled } from "../lib/feature-flags";

// ... existing imports above
```

Replace the streamSSE callback body:

```ts
return streamSSE(c, async (stream) => {
  const reply = "(11A placeholder reply)";

  if (isHumanizerEnabled()) {
    await stream.writeSSE({
      event: "status_line",
      data: JSON.stringify({
        text: "관련 문서 훑는 중…",
        kind: "progress",
        debounced: false,
      }),
    });
    for (const ch of "사용자의 질문 분석") {
      await stream.writeSSE({
        event: "thought_summary",
        data: JSON.stringify({ text: ch, delta_index: 0 }),
      });
      await stream.sleep(2);
    }
  }

  for (const ch of reply) {
    await stream.writeSSE({
      event: "delta",
      data: JSON.stringify({ delta: ch }),
    });
    await stream.sleep(2);
  }

  // ... rest of the existing block (insert assistant row + cost + done)
  //     unchanged
});
```

(Keep the conversation_messages insert + cost emission + done event exactly as they are today. The humanizer additions are purely *prepended* status/thought events.)

- [ ] **Step 4: Run test**

```bash
pnpm --filter @opencairn/api test -- chat-humanizer
```

Expected: 2 passed.

- [ ] **Step 5: Run the full chat test file** to verify no regression on Plan 11A:

```bash
pnpm --filter @opencairn/api test -- chat
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/chat.ts apps/api/tests/routes/chat-humanizer.test.js
git commit -m "$(cat <<'EOF'
feat(api): chat.ts flag-gated humanizer chunk emission

When FEATURE_AGENT_HUMANIZER=1, /api/chat/message prepends one status_line
+ thought_summary delta sequence to the existing delta/cost/done payload.
Flag off keeps Plan 11A behaviour exactly. Worker integration replaces the
canned chunks later — wire format is now stable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — Web: Composer Stop Button + Cancellation UI

### Task 19: `composer.tsx` — send→stop icon toggle

**Files:**
- Modify: `apps/web/src/components/agent-panel/composer.tsx`
- Test: `apps/web/tests/agent-panel/composer-stop.test.tsx`

- [ ] **Step 1: Read current composer**

```bash
cat apps/web/src/components/agent-panel/composer.tsx
```

Current props (per repo memory): `onSubmit`, `placeholder`, etc. We add `streaming: boolean` and `onStop: () => void`.

- [ ] **Step 2: Write the failing test**

Create `apps/web/tests/agent-panel/composer-stop.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { Composer } from "../../src/components/agent-panel/composer";

const messages = {
  agentPanel: {
    composer: {
      placeholder: "메시지 입력",
      send: "전송",
      stop: "중단",
    },
  },
};

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("Composer streaming toggle", () => {
  it("renders Send button when not streaming", () => {
    render(
      wrap(<Composer onSubmit={vi.fn()} streaming={false} onStop={vi.fn()} />),
    );
    expect(screen.getByRole("button", { name: "전송" })).toBeInTheDocument();
  });

  it("renders Stop button when streaming and click invokes onStop", () => {
    const onStop = vi.fn();
    render(
      wrap(<Composer onSubmit={vi.fn()} streaming={true} onStop={onStop} />),
    );
    const stop = screen.getByRole("button", { name: "중단" });
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test -- composer-stop
```

Expected: prop type errors / button not found.

- [ ] **Step 4: Edit `composer.tsx`**

Add the props and conditional rendering. The exact JSX depends on the existing structure — locate the action button and swap it:

```tsx
import { Send, Square } from "lucide-react";
// ... rest of imports

interface ComposerProps {
  onSubmit: (text: string) => void;
  // existing optional props ...
  streaming?: boolean;
  onStop?: () => void;
}

export function Composer({
  onSubmit,
  streaming = false,
  onStop,
  ...rest
}: ComposerProps) {
  const t = useTranslations("agentPanel.composer");
  // ... existing input state etc.

  return (
    <form onSubmit={handleSubmit} /* ... */>
      {/* existing textarea / chip row / etc. */}
      <button
        type={streaming ? "button" : "submit"}
        onClick={streaming ? onStop : undefined}
        aria-label={streaming ? t("stop") : t("send")}
        disabled={streaming ? !onStop : !canSend}
        className={cn(
          "rounded-full p-2",
          streaming
            ? "bg-destructive/90 text-destructive-foreground hover:bg-destructive"
            : "bg-primary text-primary-foreground disabled:opacity-50",
        )}
      >
        {streaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Run test**

```bash
pnpm --filter @opencairn/web test -- composer-stop
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/agent-panel/composer.tsx apps/web/tests/agent-panel/composer-stop.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): composer send→stop button toggle while streaming

Cursor / Claude.ai pattern (spec §13.3) — same button slot, icon swap.
streaming=false → Send / submit; streaming=true → Square / onStop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 20: Wire Stop click to abort the SSE stream

**Files:**
- Modify: `apps/web/src/components/agent-panel/agent-panel.tsx`
- Modify: `apps/web/src/lib/agent-stream-hook.ts` (or wherever the streaming hook lives — search first)

- [ ] **Step 1: Locate the streaming hook**

```bash
grep -rn "AbortController\|new EventSource\|fetch.*threads/.*messages" apps/web/src/components/agent-panel/ apps/web/src/lib/ | head
```

Identify the file that owns the fetch + AbortController for `/api/threads/:id/messages`. Likely `apps/web/src/lib/agent-stream.ts` or hook variant.

- [ ] **Step 2: Add `cancel()` to the hook's public API**

In the streaming hook, ensure the `AbortController` is held in state and exposed:

```ts
export function useAgentStream(...): {
  // ... existing return
  streaming: boolean;
  cancel: () => void;
} {
  const abortRef = useRef<AbortController | null>(null);
  const [streaming, setStreaming] = useState(false);

  async function send(...) {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setStreaming(true);
    try {
      const res = await fetch("...", { signal: abortRef.current.signal });
      // ... existing parse loop
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return { /* existing */, streaming, cancel };
}
```

- [ ] **Step 3: Wire into the panel**

In `apps/web/src/components/agent-panel/agent-panel.tsx`:

```tsx
const { send, streaming, cancel } = useAgentStream(...);
// ...
<Composer onSubmit={send} streaming={streaming} onStop={cancel} />
```

- [ ] **Step 4: Manual smoke**

```bash
pnpm dev
```

Open the agent panel, send a long message, and verify the Send icon swaps to Stop mid-stream and clicking it ends the stream.

- [ ] **Step 5: Existing test suite check**

```bash
pnpm --filter @opencairn/web test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/agent-panel/agent-panel.tsx apps/web/src/lib/agent-stream*.ts
git commit -m "$(cat <<'EOF'
feat(web): wire composer Stop to agent-stream AbortController

Single AbortController per panel instance. Stop click aborts the in-flight
fetch; finally-block resets streaming state and the icon swaps back to Send.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 21: Render `cancelled` message bubble + i18n key

**Files:**
- Modify: `apps/web/src/components/agent-panel/message-bubble.tsx`
- Modify: `apps/web/messages/ko/agentPanel.json`
- Modify: `apps/web/messages/en/agentPanel.json`
- Test: `apps/web/tests/agent-panel/conversation-cancelled.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/agent-panel/conversation-cancelled.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { MessageBubble } from "../../src/components/agent-panel/message-bubble";

const messages = {
  agentPanel: {
    bubble: {
      cancelled: "취소됨",
      thought_label: "생각",
      thought_seconds: "{seconds}s",
    },
    actions: {
      regenerate: "다시 생성",
    },
  },
};

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("MessageBubble cancelled status", () => {
  it("renders 취소됨 footer and dims body for cancelled agent message", () => {
    render(
      wrap(
        <MessageBubble
          msg={{
            id: "m1",
            role: "agent",
            status: "cancelled",
            content: { body: "partial response..." },
            mode: "auto",
            createdAt: new Date().toISOString(),
          } as any}
          onRegenerate={vi.fn()}
          onSaveSuggestion={vi.fn()}
          onFeedback={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText("취소됨")).toBeInTheDocument();
    expect(screen.getByText("partial response...")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/web test -- conversation-cancelled
```

Expected: text "취소됨" not found.

- [ ] **Step 3: Edit `message-bubble.tsx`**

Locate the agent-message rendering branch. Add:

```tsx
const t = useTranslations("agentPanel.bubble");
const isCancelled = msg.status === "cancelled";

// ... existing body render

{isCancelled ? (
  <div className="mt-1 text-xs text-muted-foreground italic">
    {t("cancelled")}
  </div>
) : null}
```

Apply muted styling to the body when `isCancelled` (e.g., `className={cn(..., isCancelled && "opacity-70")}`).

- [ ] **Step 4: Add i18n keys**

`apps/web/messages/ko/agentPanel.json` — under `bubble`:

```json
"cancelled": "취소됨"
```

`apps/web/messages/en/agentPanel.json` — under `bubble`:

```json
"cancelled": "Cancelled"
```

- [ ] **Step 5: Verify parity**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: parity check passes.

- [ ] **Step 6: Run test**

```bash
pnpm --filter @opencairn/web test -- conversation-cancelled
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/agent-panel/message-bubble.tsx apps/web/messages/ko/agentPanel.json apps/web/messages/en/agentPanel.json apps/web/tests/agent-panel/conversation-cancelled.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): render 'cancelled' message status with muted body + 취소됨 footer

Distinct from 'failed' (errors get an alert affordance); 'cancelled' just
indicates user intent and preserves the partial buffer per spec §13.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Web: Status Line + Thought Streaming Polish

### Task 22: Status line "Initializing…" default + clamp

**Files:**
- Modify: `apps/web/src/components/agent-panel/conversation.tsx:68-79`
- Modify: `apps/web/src/components/agent-panel/status-line.tsx`
- Modify: `apps/web/messages/ko/agentPanel.json`
- Modify: `apps/web/messages/en/agentPanel.json`

- [ ] **Step 1: Add the i18n key**

`agentPanel.json` (both ko/en) — under `status`:

```json
"status": {
  "initializing": "준비 중…"
}
```

EN: `"initializing": "Initializing…"`

- [ ] **Step 2: Edit `conversation.tsx`**

Around lines 68-79:

```tsx
const t = useTranslations("agentPanel");

// ...
{live ? (
  <div className="flex flex-col gap-2">
    <span className="text-[10px] uppercase text-muted-foreground">
      {t("agent_label")}
    </span>
    {live.thought ? <ThoughtBubble {...live.thought} /> : null}
    {live.status?.phrase ? (
      <StatusLine phrase={live.status.phrase} kind={live.status.kind} />
    ) : (
      <StatusLine phrase={t("status.initializing")} kind="info" />
    )}
    <p className="whitespace-pre-wrap text-sm">{live.body}</p>
  </div>
) : null}
```

- [ ] **Step 3: Edit `status-line.tsx`** to accept `kind` and adjust styling for `phase`/`error`:

```tsx
export function StatusLine({
  phrase,
  kind = "progress",
}: {
  phrase: string;
  kind?: "info" | "progress" | "error" | "phase";
}) {
  const dot =
    kind === "error"
      ? "bg-destructive"
      : kind === "phase"
        ? "bg-primary"
        : "bg-foreground";
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-40",
            dot,
          )}
        />
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", dot)} />
      </span>
      <span className="line-clamp-1 max-w-[60ch]">{phrase}</span>
    </div>
  );
}
```

(Phrase is server-truncated to 60 chars; `line-clamp-1` + `max-w-[60ch]` is a belt-and-suspenders for long EN phrases or future mistakes.)

- [ ] **Step 4: i18n parity**

```bash
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web typecheck
```

Expected: green.

- [ ] **Step 5: Manual smoke**

Toggle `FEATURE_AGENT_HUMANIZER=1` in `.env.local`, restart `pnpm dev`, send a message — verify the dot flashes during Initializing then swaps colours on phase transitions.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/agent-panel/conversation.tsx apps/web/src/components/agent-panel/status-line.tsx apps/web/messages/ko/agentPanel.json apps/web/messages/en/agentPanel.json
git commit -m "$(cat <<'EOF'
feat(web): status-line default 'Initializing…' + kind-aware dot colour

Spec §13.2 single rolling line. Adds kind ('info'|'progress'|'error'|'phase')
prop so phase transitions get a primary-coloured dot and error states get
destructive. line-clamp-1 + max-w-60ch backs up the server-side 60-char
truncate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 23: ThoughtBubble streaming text accumulation

**Files:**
- Modify: `apps/web/src/components/agent-panel/thought-bubble.tsx`
- Modify: the conversation hook that feeds it (search for where `live.thought` is built)

- [ ] **Step 1: Find the live-state shape**

```bash
grep -rn "live.thought\|setLive\|live: {" apps/web/src/components/agent-panel/ apps/web/src/lib/ | head
```

The Phase 4 hook today probably maps `chunk.type === "thought"` → `live.thought = payload`. We need to ALSO handle `chunk.type === "thought_summary"` and accumulate `payload.text` into `live.thought.summary`.

- [ ] **Step 2: Edit the hook to accumulate `thought_summary`**

In whatever hook owns the SSE parse loop:

```ts
case "thought_summary": {
  const p = data as { text: string; delta_index: number };
  setLive((prev) => ({
    ...prev,
    thought: {
      summary: ((prev?.thought?.summary as string | undefined) ?? "") + p.text,
      tokens: prev?.thought?.tokens,
    },
  }));
  break;
}
case "thought": {
  // Legacy single-shot — keep as-is for back-compat with stub off-path.
  setLive((prev) => ({ ...prev, thought: data as any }));
  break;
}
```

- [ ] **Step 3: Make `ThoughtBubble` re-render efficiently**

`thought-bubble.tsx` already takes `summary: string` and `tokens?: number`. No code change needed — React reconciles when `summary` grows. Just make sure the bubble defaults to `open={true}` while streaming so the user actually sees the thought:

```tsx
const [open, setOpen] = useState(true); // was false — open by default for streaming
```

(The user can collapse manually.)

- [ ] **Step 4: Manual smoke**

With flag on, send a message and watch the thought bubble fill character-by-character.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agent-panel/thought-bubble.tsx apps/web/src/lib/<stream-hook>.ts
git commit -m "$(cat <<'EOF'
feat(web): accumulate thought_summary deltas + open ThoughtBubble by default

Stream-fills the bubble character-by-character (Gemini 60 tok/s ≈ 1 char/
20ms). Manual collapse still works.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 10 — E2E + Plans Status

### Task 24: Playwright smoke E2E (flag on)

**Files:**
- Create: `apps/web/e2e/agent-humanizer.spec.ts`

> The smoke runs only when `NEXT_PUBLIC_FEATURE_AGENT_HUMANIZER=1` is set in the test env. CI invocation is outside this plan's scope (orchestrator chooses).

- [ ] **Step 1: Write the smoke**

Create `apps/web/e2e/agent-humanizer.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("agent humanizer (flag on)", () => {
  test.skip(
    process.env.NEXT_PUBLIC_FEATURE_AGENT_HUMANIZER !== "1",
    "humanizer flag off",
  );

  test("status_line renders, then thought streams, then send→stop toggles", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    // Open the agent panel — adapt selector to your UI's affordance.
    await page.getByRole("button", { name: /agent|에이전트/i }).click();

    const composer = page.getByPlaceholder(/메시지 입력|message/i);
    await composer.fill("안녕");

    const send = page.getByRole("button", { name: /전송|send/i });
    await Promise.all([
      send.click(),
      // While streaming, the same slot becomes Stop.
      page.getByRole("button", { name: /중단|stop/i }).waitFor({ state: "visible" }),
    ]);

    // Status line shows up and changes from initializing to a phrase.
    await expect(page.locator("text=훑는 중").first()).toBeVisible({
      timeout: 5_000,
    });

    // Thought bubble (open by default) accumulates >1 char.
    const thought = page.locator("[data-testid='thought-summary']");
    if (await thought.count()) {
      await expect.poll(async () => (await thought.textContent())?.length ?? 0).toBeGreaterThan(3);
    }

    // Stream resolves; Send returns.
    await page.getByRole("button", { name: /전송|send/i }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
  });

  test("Stop click finalises message as cancelled (visual marker)", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /agent|에이전트/i }).click();
    const composer = page.getByPlaceholder(/메시지 입력|message/i);
    await composer.fill("긴 답변 내놔");

    await page.getByRole("button", { name: /전송|send/i }).click();
    await page.getByRole("button", { name: /중단|stop/i }).click();

    await expect(page.getByText("취소됨")).toBeVisible({ timeout: 10_000 });
  });
});
```

> **Note:** the `data-testid='thought-summary'` selector needs to be added to `thought-bubble.tsx`'s body `<p>` if you want the count poll to work. If you'd rather not add a test id, drop that block and rely on visible text alone.

- [ ] **Step 2: Add the data-testid**

In `apps/web/src/components/agent-panel/thought-bubble.tsx`, on the open `<p>`:

```tsx
<p data-testid="thought-summary" className="border-t border-border px-2 py-1 text-muted-foreground">
  {summary}
</p>
```

- [ ] **Step 3: Run locally with flag**

```bash
NEXT_PUBLIC_FEATURE_AGENT_HUMANIZER=1 FEATURE_AGENT_HUMANIZER=1 pnpm --filter @opencairn/web test:e2e -- agent-humanizer
```

Expected: 2 passed (or both skipped if flag isn't propagated).

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/agent-humanizer.spec.ts apps/web/src/components/agent-panel/thought-bubble.tsx
git commit -m "$(cat <<'EOF'
test(web): playwright e2e for humanizer happy path + stop→cancelled

Skipped unless NEXT_PUBLIC_FEATURE_AGENT_HUMANIZER=1. Two scenarios:
status_line → thought stream → done, and stop mid-stream → 취소됨 footer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 25: Update `docs/contributing/plans-status.md`

**Files:**
- Modify: `docs/contributing/plans-status.md`

- [ ] **Step 1: Locate and edit**

Find the active/upcoming plans table or list. Add the entry:

```markdown
- 🟡 Active: Agent Humanizer (`feat/plan-agent-humanizer`, plan `docs/superpowers/plans/2026-04-28-plan-agent-humanizer.md`).
  Spec resolved 2026-04-28. Worker pure humanizer + stream transformer + Gemini thinking_summaries plumbing + composer Stop button. Flag `FEATURE_AGENT_HUMANIZER` default off. Depends on Plan 11A + App Shell Phase 4 (both merged).
```

When the plan completes, flip 🟡 → ✅ and link the merge SHA.

- [ ] **Step 2: Commit**

```bash
git add docs/contributing/plans-status.md
git commit -m "$(cat <<'EOF'
docs(plans): track Agent Humanizer plan as active

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 11 — Final Verification

### Task 26: Full-suite green check + flag-off regression

- [ ] **Step 1: Worker**

```bash
cd apps/worker
uv run pytest -q
```

Expected: green.

- [ ] **Step 2: LLM**

```bash
cd packages/llm
uv run pytest -q
```

Expected: green.

- [ ] **Step 3: Shared**

```bash
pnpm --filter @opencairn/shared test
pnpm --filter @opencairn/shared typecheck
```

Expected: green.

- [ ] **Step 4: API (flag off)**

```bash
unset FEATURE_AGENT_HUMANIZER
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/api typecheck
```

Expected: green. **Critical regression check** — the flag-off path MUST keep emitting the original Plan 11A `delta`/`cost`/`done` only.

- [ ] **Step 5: API (flag on)**

```bash
FEATURE_AGENT_HUMANIZER=1 pnpm --filter @opencairn/api test
```

Expected: green incl. flag-on chat-humanizer + threads-cancel cases.

- [ ] **Step 6: Web**

```bash
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web build
```

Expected: green.

- [ ] **Step 7: DB sanity**

```bash
psql $DATABASE_URL -c "SELECT enum_range(NULL::message_status);"
```

Expected: `{streaming,complete,failed,cancelled}`.

- [ ] **Step 8: If any check fails** — investigate root cause, do not skip. Common pitfalls (spec §11 + repo memory):
  - Forgetting to add the new event class to `AgentEvent` Annotated Union → `TypeAdapter(AgentEvent).validate_python(...)` fails on round-trip
  - i18n key added in ko but not en → parity fails
  - Drizzle migration named with auto-generated suffix instead of `0034_chat_messages_cancelled.sql` → `_journal.json` mismatch
  - Test imports using `.ts` extension instead of `.js` (apps/api ESM convention per memory) → ESM resolver throws

### Task 27: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin docs/plan-agent-humanizer
```

- [ ] **Step 2: Open PR via gh**

```bash
gh pr create --title "feat: agent humanizer (worker + api + web, flag-gated)" --body "$(cat <<'EOF'
## Summary
- Pure `humanize()` Layer 3 (worker) — deterministic AgentEvent → StatusLine
- 5 new BaseEvent subclasses in `events.py` — backwards-compatible additive
- Gemini `thinking_summaries: "auto"` plumbing + Ollama graceful skip
- Composer send→stop toggle (Cursor / Claude.ai pattern)
- New `cancelled` message status (DB migration 0034)
- Flag `FEATURE_AGENT_HUMANIZER` default OFF — flag-off path keeps Plan 11A behaviour byte-for-byte

Spec: `docs/superpowers/specs/2026-04-22-agent-humanizer-design.md` (resolutions 2026-04-28 §13)
Plan: `docs/superpowers/plans/2026-04-28-plan-agent-humanizer.md`

## Test plan
- [ ] `apps/worker` pytest green (incl. 6 new humanizer files)
- [ ] `packages/llm` pytest green (incl. thinking_summaries tests)
- [ ] `packages/shared` vitest green (Zod schemas)
- [ ] `apps/api` vitest green with flag OFF (regression) AND flag ON (humanizer chunks)
- [ ] `apps/web` typecheck + vitest + i18n:parity + build green
- [ ] Manual: send a message with flag=1 → status_line + thought stream + send→stop
- [ ] Manual: click Stop mid-stream → row.status='cancelled' + 취소됨 footer rendered
- [ ] Manual: flag=0 → behaviour identical to pre-PR baseline

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3:** Mark plan ✅ in `docs/contributing/plans-status.md` once the PR merges (separate commit on `main`).

---

## Self-Review Checklist (run before handoff)

- [x] **Spec coverage** — every § in `2026-04-22-agent-humanizer-design.md` maps to at least one task:
  - §3 4-Layer architecture: Layer 1 (existing) → Tasks 1-3 sit on it; Layer 2 → Tasks 11-12; Layer 3 → Tasks 4-9; Layer 4 (system prompt tone) intentionally **out of scope** for v0.1 — system-prompt tweaks are agent-by-agent and shipped with each agent's own activity, noted under "Out of scope".
  - §4 Thought summaries plumbing → Tasks 10-12.
  - §5 Humanizer pure function → Tasks 4-6.
  - §6 Rate control / debounce → Tasks 7-8.
  - §7 Tone → noted as out of scope (per-agent system prompts).
  - §8 Anti-patterns → encoded as test cases (`test_unknown_combo_returns_none`, `test_model_end_is_suppressed`) and the doc.
  - §9 Data model additions → Tasks 1, 2, 13.
  - §10 Integration points → Tasks 4-9 (worker), 13 (shared), 16-18 (api), 19-23 (web), 25 (docs).
  - §11 Testing strategy → unit + integration + E2E tasks throughout.
  - §12 Rollout v0.1 → flag default OFF, only Research/Compiler/Librarian templates ship.
  - §13.1 retry hybrid → Task 1 (Retry vs PhaseTransition events), Task 5 (templates).
  - §13.2 single rolling line → Task 22 (default phrase, kind-aware dot).
  - §13.3 cancel composer toggle → Tasks 14, 17, 19, 20, 21.
  - §13.4 NDJSON only → Task 3 (regression lock); no DB sidecar work.
  - §14 Success metrics → measured post-rollout, not part of plan.

- [x] **Placeholder scan** — no "TBD"/"TODO" inside step bodies. Two annotations marked "out of scope" in the header are explicit deferrals, not placeholders.

- [x] **Type consistency** — `humanize()` signature stays `(event, agent_type) → StatusLine | None` across Tasks 4, 5, 8. `streaming: boolean` + `onStop: () => void` Composer prop stays consistent in Tasks 19-20. `messageStatusEnum` adds exactly `'cancelled'` (Task 14) and is consumed in Tasks 16, 17, 21.

- [x] **Repo conventions honored** —
  - apps/api ESM imports: tests use `.js` extension (per repo memory `feedback_apps_api_import_convention.md`)
  - Co-Authored-By trailer on every commit (per memory `feedback_opencairn_commit_coauthor.md`)
  - i18n parity required (CLAUDE.md i18n rule)
  - 2026-04-28 absolute date everywhere (no "today" / "next week")
  - Drizzle migration numbered 0034 (next after 0033)

- [x] **Worktree** — plan was authored in `.worktrees/plan-agent-humanizer-doc` on `docs/plan-agent-humanizer` per parallel-session rule.
