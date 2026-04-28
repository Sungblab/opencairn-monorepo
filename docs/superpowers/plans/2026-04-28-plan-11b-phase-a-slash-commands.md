# Plan 11B Phase A — Slash Commands (DocEditorAgent + LLM-only commands) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation of Plan 11B's slash-command flow — `DocEditorAgent` (runtime.Agent subclass) + 4 LLM-only commands (`/improve`, `/translate`, `/summarize`, `/expand`) + Plate slash AI section + inline `InlineDiffSheet` review UX + `doc_editor_calls` audit row, behind `FEATURE_DOC_EDITOR_SLASH`.

**Architecture:** Worker hosts `DocEditorAgent` subclassing `runtime.Agent`; each command is a `CommandSpec` with its own system prompt + structured-output schema (no tools yet — RAG is Phase B). API exposes `POST /api/notes/:id/doc-editor/commands/:commandName` as SSE that streams `delta`, `doc_editor_result` (full hunks), `cost`, `done`. Web slash menu adds an "AI" section, calls the SSE endpoint, renders results in an inline Sheet (`InlineDiffSheet`) with per-hunk preview + accept-all/reject-all; accepted hunks apply via Plate range-replace transforms. Tab Mode `diff` and per-hunk granular accept/reject are deferred to Phase C.

**Tech Stack:** Drizzle ORM + Postgres (`doc_editor_calls` table), Hono 4 SSE, Python 3.12 + Temporal + `runtime.Agent` (worker), `packages/llm` Gemini/Ollama provider, Plate v49 + shadcn Sheet + zustand (web), Vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-04-21-plan-11b-chat-editor-knowledge-loop-design.md` §6 (Slash Commands)

**Dependencies:**
- ✅ Plan 4 Phase B — `runtime.Agent` pattern + `apps/worker/src/runtime/`
- ✅ Plan 12 — agent runtime + `ToolContext` + `AgentEvent` discriminated union
- ✅ Plan 11A — chat SSE patterns (we mirror the SSE event shape)
- ✅ Plan 2A — Plate slash menu (`apps/web/src/components/editor/plugins/slash.tsx`)
- ✅ Plan 2D — Plate v49 element interface conventions

**Out of scope (deferred to Plan 11B Phase B+):**
- `/cite`, `/factcheck` — Phase B (depends on `ResearchAgent.hybrid_search` exposed as builtin tool)
- Tab Mode `diff` viewer with per-hunk granular accept/reject — Phase C
- Save suggestion (§4) — Phase D
- Page provenance (§5) — Phase E
- Related pages (§7) — Phase F
- Insert-mode toggle (`/summarize` 아래 삽입) — folded into Phase C with the real Diff View

**Migration number:** Run `pnpm db:generate` at implementation time. As of plan writing (2026-04-28) parallel sessions hold 0032/0033/0034 — expect to land on 0035 or later. Do not hard-code. If `pnpm db:generate` produces a colliding number, reorder before merge.

---

## File Map

### packages/db
- **Create** `src/schema/doc-editor-calls.ts` — Drizzle table for billing/usage audit.
- **Modify** `src/index.ts` — re-export `docEditorCalls` + `DocEditorCallInsert` type.
- **Create** `tests/doc-editor-calls.test.ts` — schema sanity test.
- **Auto-generated** `drizzle/<NNNN>_doc_editor_calls.sql` (number assigned at `pnpm db:generate`).

### packages/shared
- **Create** `src/doc-editor.ts` — Zod schemas for command name union, selection, request body, SSE event union.
- **Modify** `src/index.ts` — re-export.
- **Create** `tests/doc-editor.test.ts`.

### apps/worker
- **Create** `src/worker/agents/doc_editor/__init__.py`
- **Create** `src/worker/agents/doc_editor/agent.py` — `DocEditorAgent(runtime.Agent)`.
- **Create** `src/worker/agents/doc_editor/commands/__init__.py`
- **Create** `src/worker/agents/doc_editor/commands/spec.py` — `CommandSpec` dataclass + registry.
- **Create** `src/worker/agents/doc_editor/commands/improve.py`
- **Create** `src/worker/agents/doc_editor/commands/translate.py`
- **Create** `src/worker/agents/doc_editor/commands/summarize.py`
- **Create** `src/worker/agents/doc_editor/commands/expand.py`
- **Create** `src/worker/activities/doc_editor_activity.py` — Temporal activity wrapper (returns `DocEditorOutput`).
- **Create** `src/worker/workflows/doc_editor_workflow.py` — minimal workflow that invokes the activity (so the API can call via Temporal client; matches Compiler/ResearchAgent pattern).
- **Modify** `src/worker/temporal_main.py` — register workflow + activity (flag-gated).
- **Create** `tests/agents/test_doc_editor_agent.py`
- **Create** `tests/agents/test_doc_editor_commands.py`
- **Create** `tests/activities/test_doc_editor_activity.py`

### apps/api
- **Create** `src/routes/doc-editor.ts` — `POST /api/notes/:noteId/doc-editor/commands/:commandName` SSE.
- **Create** `src/lib/doc-editor-sse.ts` — small SSE encoder (mirrors chat.ts patterns).
- **Modify** `src/app.ts` — mount `/api/notes/:noteId/doc-editor` router behind `FEATURE_DOC_EDITOR_SLASH`.
- **Create** `tests/doc-editor.test.ts`

### apps/web
- **Create** `src/lib/api/doc-editor.ts` — typed SSE client that yields parsed events.
- **Create** `src/hooks/useDocEditorCommand.ts` — invokes SSE + accumulates state.
- **Create** `src/components/editor/doc-editor/InlineDiffSheet.tsx` — Sheet with hunk list + accept-all / reject-all + cost badge.
- **Create** `src/components/editor/doc-editor/applyHunks.ts` — Plate range-replace transform (pure, unit-testable).
- **Modify** `src/components/editor/plugins/slash.tsx` — add "AI" section (4 commands + `/translate` language submenu).
- **Create** `src/components/editor/doc-editor/__tests__/applyHunks.test.ts`
- **Create** `src/components/editor/doc-editor/__tests__/InlineDiffSheet.test.tsx`
- **Create** `messages/ko/doc-editor.json`
- **Create** `messages/en/doc-editor.json`
- **Modify** `src/lib/i18n.ts` — register namespace.

### docs
- **Modify** `docs/architecture/api-contract.md` — add `/api/notes/:id/doc-editor/commands/:command` row.
- **Modify** `docs/contributing/plans-status.md` — add Plan 11B Phase A entry.
- **Modify** `docs/contributing/llm-antipatterns.md` — record Plate range-replace + SSE-from-Temporal-stream gotchas (only if encountered during implementation; otherwise skip).

---

## Task 1: DB schema — `doc_editor_calls`

**Files:**
- Create: `packages/db/src/schema/doc-editor-calls.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/tests/doc-editor-calls.test.ts`

- [ ] **Step 1: Write failing schema test**

```ts
// packages/db/tests/doc-editor-calls.test.ts
import { describe, it, expect } from "vitest";
import { docEditorCalls } from "../src/schema/doc-editor-calls";

describe("docEditorCalls schema", () => {
  it("declares the columns slash-command billing requires", () => {
    const cols = Object.keys(docEditorCalls);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "noteId",
        "userId",
        "workspaceId",
        "command",
        "tokensIn",
        "tokensOut",
        "costKrw",
        "status",
        "errorCode",
        "createdAt",
      ]),
    );
  });
});
```

- [ ] **Step 2: Verify it fails**

```
pnpm --filter @opencairn/db test -- doc-editor-calls
```
Expected: FAIL — `Cannot find module '../src/schema/doc-editor-calls'`.

- [ ] **Step 3: Implement the schema**

```ts
// packages/db/src/schema/doc-editor-calls.ts
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { notes } from "./notes";
import { workspaces } from "./workspaces";
import { user } from "./users";

// Plan 11B Phase A — every slash-command invocation appends one row, ok or
// failed. We store workspace_id denormalized so usage rollups don't need
// to join through notes. `cost_krw` mirrors the convention used by
// `conversation_messages.cost_krw` (numeric(12,4)).
export const docEditorCalls = pgTable(
  "doc_editor_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    command: text("command").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costKrw: numeric("cost_krw", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("doc_editor_calls_user_recent_idx").on(t.userId, t.createdAt),
    index("doc_editor_calls_note_recent_idx").on(t.noteId, t.createdAt),
    check(
      "doc_editor_calls_status_check",
      sql`${t.status} IN ('ok', 'failed')`,
    ),
  ],
);

export type DocEditorCall = typeof docEditorCalls.$inferSelect;
export type DocEditorCallInsert = typeof docEditorCalls.$inferInsert;
```

- [ ] **Step 4: Re-export**

In `packages/db/src/index.ts`, add:

```ts
export * from "./schema/doc-editor-calls";
```

- [ ] **Step 5: Verify test passes**

```
pnpm --filter @opencairn/db test -- doc-editor-calls
```
Expected: PASS.

- [ ] **Step 6: Generate migration**

```
pnpm db:generate
```

A new file appears under `packages/db/drizzle/` (`<NNNN>_doc_editor_calls.sql` or similar). Inspect the SQL — it should contain `CREATE TABLE doc_editor_calls (...)` and the two indexes + CHECK. If a parallel session has bumped the number such that two PRs would collide, rename to the next free slot.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/doc-editor-calls.ts packages/db/src/index.ts packages/db/drizzle/<NNNN>_doc_editor_calls.sql packages/db/tests/doc-editor-calls.test.ts
git commit -m "feat(db): add doc_editor_calls table for Plan 11B Phase A slash-command audit"
```

---

## Task 2: Shared Zod — DocEditor command + SSE event union

**Files:**
- Create: `packages/shared/src/doc-editor.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/tests/doc-editor.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/tests/doc-editor.test.ts
import { describe, it, expect } from "vitest";
import {
  docEditorCommandSchema,
  docEditorRequestSchema,
  docEditorSseEventSchema,
} from "../src/doc-editor";

describe("doc-editor zod", () => {
  it("only accepts the v1 command set", () => {
    expect(docEditorCommandSchema.safeParse("improve").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("translate").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("summarize").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("expand").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("cite").success).toBe(false);
    expect(docEditorCommandSchema.safeParse("factcheck").success).toBe(false);
  });

  it("requires non-empty selection text", () => {
    const ok = docEditorRequestSchema.safeParse({
      selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
      documentContextSnippet: "some surrounding context",
    });
    expect(ok.success).toBe(true);

    const bad = docEditorRequestSchema.safeParse({
      selection: { blockId: "b1", start: 0, end: 0, text: "" },
      documentContextSnippet: "",
    });
    expect(bad.success).toBe(false);
  });

  it("doc_editor_result hunks carry blockId + range + replacement", () => {
    const ev = docEditorSseEventSchema.safeParse({
      type: "doc_editor_result",
      output_mode: "diff",
      payload: {
        hunks: [
          {
            blockId: "b1",
            originalRange: { start: 0, end: 5 },
            originalText: "hello",
            replacementText: "Hello there",
          },
        ],
        summary: "1 sentence rewritten",
      },
    });
    expect(ev.success).toBe(true);
  });
});
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/shared test -- doc-editor
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

```ts
// packages/shared/src/doc-editor.ts
import { z } from "zod";

// v1 command set — Plan 11B Phase A. /cite + /factcheck land in Phase B
// when ResearchAgent.hybrid_search is exposed as a builtin tool.
export const docEditorCommandSchema = z.enum([
  "improve",
  "translate",
  "summarize",
  "expand",
]);
export type DocEditorCommand = z.infer<typeof docEditorCommandSchema>;

export const docEditorSelectionSchema = z.object({
  blockId: z.string().min(1).max(64),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string().min(1).max(4000),
});
export type DocEditorSelection = z.infer<typeof docEditorSelectionSchema>;

export const docEditorRequestSchema = z
  .object({
    selection: docEditorSelectionSchema,
    language: z.string().min(2).max(20).optional(),
    documentContextSnippet: z.string().max(4000).default(""),
  })
  .refine((v) => v.selection.end > v.selection.start, {
    message: "selection range invalid",
  });
export type DocEditorRequest = z.infer<typeof docEditorRequestSchema>;

export const docEditorHunkSchema = z.object({
  blockId: z.string().min(1),
  originalRange: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
  originalText: z.string(),
  replacementText: z.string(),
});
export type DocEditorHunk = z.infer<typeof docEditorHunkSchema>;

export const docEditorDiffPayloadSchema = z.object({
  hunks: z.array(docEditorHunkSchema).min(1),
  summary: z.string().max(280),
});
export type DocEditorDiffPayload = z.infer<typeof docEditorDiffPayloadSchema>;

// SSE wire format. `delta` carries token-by-token text only (UI may
// optionally render a running preview); the authoritative result is
// `doc_editor_result`. `cost` mirrors chat.ts.
export const docEditorSseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({
    type: z.literal("doc_editor_result"),
    output_mode: z.enum(["diff"]),
    payload: docEditorDiffPayloadSchema,
  }),
  z.object({
    type: z.literal("cost"),
    tokens_in: z.number().int().nonnegative(),
    tokens_out: z.number().int().nonnegative(),
    cost_krw: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "llm_failed",
      "selection_race",
      "command_unknown",
      "internal",
    ]),
    message: z.string(),
  }),
  z.object({ type: z.literal("done") }),
]);
export type DocEditorSseEvent = z.infer<typeof docEditorSseEventSchema>;
```

- [ ] **Step 4: Re-export**

```ts
// packages/shared/src/index.ts
export * from "./doc-editor";
```

- [ ] **Step 5: Verify pass**

```
pnpm --filter @opencairn/shared test -- doc-editor
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/doc-editor.ts packages/shared/src/index.ts packages/shared/tests/doc-editor.test.ts
git commit -m "feat(shared): add doc-editor command + SSE Zod schemas (Plan 11B Phase A)"
```

---

## Task 3: Worker — CommandSpec + 4 system-prompt modules

**Files:**
- Create: `apps/worker/src/worker/agents/doc_editor/__init__.py`
- Create: `apps/worker/src/worker/agents/doc_editor/commands/__init__.py`
- Create: `apps/worker/src/worker/agents/doc_editor/commands/spec.py`
- Create: `apps/worker/src/worker/agents/doc_editor/commands/improve.py`
- Create: `apps/worker/src/worker/agents/doc_editor/commands/translate.py`
- Create: `apps/worker/src/worker/agents/doc_editor/commands/summarize.py`
- Create: `apps/worker/src/worker/agents/doc_editor/commands/expand.py`
- Create: `apps/worker/tests/agents/test_doc_editor_commands.py`

- [ ] **Step 1: Write failing test**

```python
# apps/worker/tests/agents/test_doc_editor_commands.py
"""Plan 11B Phase A — CommandSpec registry sanity."""
from __future__ import annotations

import pytest

from worker.agents.doc_editor.commands import COMMANDS, get_command_spec
from worker.agents.doc_editor.commands.spec import CommandSpec


def test_registry_lists_v1_commands():
    assert sorted(COMMANDS.keys()) == ["expand", "improve", "summarize", "translate"]


def test_each_spec_has_required_fields():
    for name, spec in COMMANDS.items():
        assert isinstance(spec, CommandSpec)
        assert spec.name == name
        assert spec.system_prompt.strip(), f"{name} has empty prompt"
        assert spec.output_mode == "diff"


def test_get_command_spec_unknown_raises():
    with pytest.raises(KeyError):
        get_command_spec("cite")  # Phase B
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_commands.py -v
```
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Implement spec + 4 prompts**

```python
# apps/worker/src/worker/agents/doc_editor/__init__.py
"""DocEditorAgent — Plan 11B slash commands."""
```

```python
# apps/worker/src/worker/agents/doc_editor/commands/spec.py
"""Plan 11B Phase A — CommandSpec dataclass."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


OutputMode = Literal["diff", "comment", "insert"]


@dataclass(frozen=True)
class CommandSpec:
    """Per-slash-command configuration. Phase A all commands are pure LLM
    (no tools). The output_mode is always 'diff' here; Phase B adds
    'comment' for /factcheck and Phase C may add 'insert' for /summarize."""

    name: str
    system_prompt: str
    output_mode: OutputMode
    # Soft cap on selection size that the agent will accept. Selections
    # above this length are rejected by the agent (the API performs a
    # cheaper guard via Zod first; this is the second wall).
    max_selection_chars: int = 4000
```

```python
# apps/worker/src/worker/agents/doc_editor/commands/improve.py
from worker.agents.doc_editor.commands.spec import CommandSpec

IMPROVE_SYSTEM = """You are a precise document editor. Rewrite the user's
selection for clarity, concision, and correctness while preserving the
author's voice and meaning. Do not add new claims. Do not remove citations
or wiki-link references like [[Foo]].

Return JSON only, matching this exact shape:

{
  "hunks": [
    {
      "blockId": "<echo the input blockId>",
      "originalRange": { "start": <int>, "end": <int> },
      "originalText": "<the exact original substring>",
      "replacementText": "<your rewrite>"
    }
  ],
  "summary": "<≤140 chars, e.g. '3 sentences tightened'>"
}

If no improvement is warranted (the selection is already clear), return a
single hunk where replacementText equals originalText, and summary='no
change needed'."""

SPEC = CommandSpec(name="improve", system_prompt=IMPROVE_SYSTEM, output_mode="diff")
```

```python
# apps/worker/src/worker/agents/doc_editor/commands/translate.py
from worker.agents.doc_editor.commands.spec import CommandSpec

TRANSLATE_SYSTEM = """You are a translator. Translate the user's selection
into the target language given in the user message header `Target language: <name>`.
Preserve markdown, math (`$...$`, `$$...$$`), and wiki-links (`[[Foo]]`)
verbatim. Do not paraphrase, do not summarize.

Return JSON only:

{
  "hunks": [
    {
      "blockId": "<echo>",
      "originalRange": { "start": <int>, "end": <int> },
      "originalText": "<echo>",
      "replacementText": "<translation>"
    }
  ],
  "summary": "Translated to <Target language>"
}"""

SPEC = CommandSpec(name="translate", system_prompt=TRANSLATE_SYSTEM, output_mode="diff")
```

```python
# apps/worker/src/worker/agents/doc_editor/commands/summarize.py
from worker.agents.doc_editor.commands.spec import CommandSpec

SUMMARIZE_SYSTEM = """You are a concise summarizer. Replace the user's
selection with a faithful summary in the same language as the source. Aim
for 30-50% of the original length. Preserve any citation markers like
[^1]. Do not introduce facts not in the original.

Return JSON only with one hunk that replaces the selection. summary should
read e.g. 'Summarized 4 paragraphs to 2'."""

SPEC = CommandSpec(name="summarize", system_prompt=SUMMARIZE_SYSTEM, output_mode="diff")
```

```python
# apps/worker/src/worker/agents/doc_editor/commands/expand.py
from worker.agents.doc_editor.commands.spec import CommandSpec

EXPAND_SYSTEM = """You are a writer expanding a terse passage. Rewrite the
selection at roughly 2× length, adding concrete detail, examples, and
transitions where helpful. Stay within the topic — do not invent facts the
original does not imply. Preserve markdown, math, and wiki-links.

Return JSON only with one hunk replacing the selection. summary e.g.
'Expanded 2 sentences to 5'."""

SPEC = CommandSpec(name="expand", system_prompt=EXPAND_SYSTEM, output_mode="diff")
```

```python
# apps/worker/src/worker/agents/doc_editor/commands/__init__.py
"""Plan 11B Phase A command registry."""
from __future__ import annotations

from worker.agents.doc_editor.commands import improve, translate, summarize, expand
from worker.agents.doc_editor.commands.spec import CommandSpec, OutputMode

COMMANDS: dict[str, CommandSpec] = {
    improve.SPEC.name: improve.SPEC,
    translate.SPEC.name: translate.SPEC,
    summarize.SPEC.name: summarize.SPEC,
    expand.SPEC.name: expand.SPEC,
}


def get_command_spec(name: str) -> CommandSpec:
    """Lookup helper. Raises KeyError on unknown commands; the agent's
    caller (the activity) catches that and surfaces a 400 to the API."""
    return COMMANDS[name]


__all__ = ["COMMANDS", "CommandSpec", "OutputMode", "get_command_spec"]
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_commands.py -v
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/doc_editor/__init__.py apps/worker/src/worker/agents/doc_editor/commands/ apps/worker/tests/agents/test_doc_editor_commands.py
git commit -m "feat(worker): add DocEditor CommandSpec + 4 LLM-only command prompts (Plan 11B-A)"
```

---

## Task 4: Worker — DocEditorAgent happy path (`/improve`)

**Files:**
- Create: `apps/worker/src/worker/agents/doc_editor/agent.py`
- Create: `apps/worker/tests/agents/test_doc_editor_agent.py`

- [ ] **Step 1: Write failing test**

```python
# apps/worker/tests/agents/test_doc_editor_agent.py
"""Plan 11B Phase A — DocEditorAgent.run yields the expected event sequence."""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest

from runtime.events import AgentEnd, AgentStart, ModelEnd
from runtime.tools import ToolContext
from worker.agents.doc_editor.agent import DocEditorAgent, DocEditorOutput


def _ctx() -> ToolContext:
    return ToolContext(
        run_id="run-test",
        workspace_id="ws-test",
        scope={"workspace_id": "ws-test", "user_id": "user-1"},
    )


@pytest.mark.asyncio
async def test_improve_happy_path_yields_diff_payload():
    raw = json.dumps(
        {
            "hunks": [
                {
                    "blockId": "b1",
                    "originalRange": {"start": 0, "end": 5},
                    "originalText": "hello",
                    "replacementText": "Hello there",
                }
            ],
            "summary": "1 word adjusted",
        }
    )
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value=raw)
    provider.config.model = "gemini-2.5-flash"

    agent = DocEditorAgent(provider=provider)
    events: list[Any] = []
    async for ev in agent.run(
        {
            "command": "improve",
            "selection": {
                "blockId": "b1",
                "start": 0,
                "end": 5,
                "text": "hello",
            },
            "documentContextSnippet": "around the selection",
            "note_id": "note-1",
            "user_id": "user-1",
        },
        _ctx(),
    ):
        events.append(ev)

    assert isinstance(events[0], AgentStart)
    assert isinstance(events[-1], AgentEnd)
    assert any(isinstance(e, ModelEnd) for e in events)
    out = DocEditorOutput(**events[-1].output)
    assert out.command == "improve"
    assert out.payload["hunks"][0]["replacementText"] == "Hello there"
    assert out.tokens_in >= 0
    assert out.tokens_out >= 0
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_agent.py::test_improve_happy_path_yields_diff_payload -v
```
Expected: FAIL — agent module missing.

- [ ] **Step 3: Implement DocEditorAgent**

```python
# apps/worker/src/worker/agents/doc_editor/agent.py
"""Plan 11B Phase A — DocEditorAgent.

Runs a single slash command per ``run`` invocation. Subclass of
``runtime.agent.Agent`` so the standard hook chain (trajectory, token
counter, Sentry) observes it identically to Compiler/Research/Librarian.

The output_mode is always 'diff' in Phase A. RAG-backed commands and the
'comment' / 'insert' modes land in Phase B/C.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any, ClassVar

from llm import LLMProvider

from runtime.agent import Agent
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    ModelEnd,
)
from runtime.tools import ToolContext

from worker.agents.doc_editor.commands import get_command_spec

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DocEditorInput:
    command: str
    note_id: str
    user_id: str
    selection_block_id: str
    selection_start: int
    selection_end: int
    selection_text: str
    document_context_snippet: str
    language: str | None


@dataclass(frozen=True)
class DocEditorOutput:
    command: str
    output_mode: str
    payload: dict[str, Any]
    tokens_in: int
    tokens_out: int


class _SeqCounter:
    __slots__ = ("_v",)

    def __init__(self) -> None:
        self._v = -1

    def next(self) -> int:
        self._v += 1
        return self._v


class DocEditorAgent(Agent):
    name: ClassVar[str] = "doc_editor"
    description: ClassVar[str] = (
        "Apply a slash-command (improve/translate/summarize/expand) to "
        "a selection range and return diff hunks."
    )

    def __init__(self, *, provider: LLMProvider) -> None:
        self.provider = provider

    async def run(
        self,
        input: dict[str, Any],
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, None]:
        validated = DocEditorInput(
            command=input["command"],
            note_id=input["note_id"],
            user_id=input["user_id"],
            selection_block_id=input["selection"]["blockId"],
            selection_start=input["selection"]["start"],
            selection_end=input["selection"]["end"],
            selection_text=input["selection"]["text"],
            document_context_snippet=input.get("documentContextSnippet", ""),
            language=input.get("language"),
        )

        seq = _SeqCounter()
        t0 = time.time()
        yield AgentStart(
            run_id=ctx.run_id,
            workspace_id=ctx.workspace_id,
            agent_name=self.name,
            seq=seq.next(),
            ts=t0,
            scope=ctx.scope,
            input={"command": validated.command, "note_id": validated.note_id},
        )

        try:
            spec = get_command_spec(validated.command)
            if len(validated.selection_text) > spec.max_selection_chars:
                raise ValueError(
                    f"selection too long: {len(validated.selection_text)} > {spec.max_selection_chars}"
                )

            user_msg = self._build_user_message(spec.name, validated)
            messages = [
                {"role": "system", "content": spec.system_prompt},
                {"role": "user", "content": user_msg},
            ]
            started = time.time()
            raw = await self.provider.generate(
                messages,
                response_mime_type="application/json",
            )
            latency_ms = int((time.time() - started) * 1000)

            tokens_in = len(user_msg) // 4  # provisional — Plan 12 follow-up
            tokens_out = len(raw) // 4
            yield ModelEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="model_end",
                model_id=self.provider.config.model or "unknown",
                prompt_tokens=tokens_in,
                completion_tokens=tokens_out,
                cached_tokens=0,
                cost_krw=0,
                finish_reason="stop",
                latency_ms=latency_ms,
            )

            payload = self._parse_diff_payload(raw, fallback_block_id=validated.selection_block_id,
                                               fallback_text=validated.selection_text,
                                               fallback_start=validated.selection_start,
                                               fallback_end=validated.selection_end)
            out = DocEditorOutput(
                command=validated.command,
                output_mode="diff",
                payload=payload,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
            )
            yield AgentEnd(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_end",
                output=out.__dict__,
                duration_ms=int((time.time() - t0) * 1000),
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("DocEditorAgent failed (command=%s)", input.get("command"))
            yield AgentError(
                run_id=ctx.run_id,
                workspace_id=ctx.workspace_id,
                agent_name=self.name,
                seq=seq.next(),
                ts=time.time(),
                type="agent_error",
                error_class=type(exc).__name__,
                message=str(exc),
                retryable=False,
            )
            raise

    def _build_user_message(self, command: str, v: DocEditorInput) -> str:
        header_lines = [f"Block id: {v.selection_block_id}"]
        if command == "translate" and v.language:
            header_lines.append(f"Target language: {v.language}")
        header_lines.append(
            f"Range: start={v.selection_start} end={v.selection_end}"
        )
        header = "\n".join(header_lines)
        return (
            f"{header}\n\n"
            "=== Surrounding context (read-only) ===\n"
            f"{v.document_context_snippet}\n\n"
            "=== Selection (rewrite this) ===\n"
            f"{v.selection_text}"
        )

    _JSON_FENCE = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)

    def _parse_diff_payload(
        self,
        raw: str,
        *,
        fallback_block_id: str,
        fallback_text: str,
        fallback_start: int,
        fallback_end: int,
    ) -> dict[str, Any]:
        text = raw.strip()
        m = self._JSON_FENCE.search(text)
        if m:
            text = m.group(1).strip()
        data = json.loads(text)
        if not isinstance(data, dict) or "hunks" not in data:
            raise ValueError("LLM output missing 'hunks'")
        hunks = data.get("hunks") or []
        if not isinstance(hunks, list) or not hunks:
            raise ValueError("LLM output 'hunks' empty")
        # Echo the block id + range if the model dropped them — happens
        # occasionally with smaller models.
        clean: list[dict[str, Any]] = []
        for h in hunks:
            if not isinstance(h, dict):
                continue
            block_id = h.get("blockId") or fallback_block_id
            rng = h.get("originalRange") or {}
            start = int(rng.get("start", fallback_start))
            end = int(rng.get("end", fallback_end))
            original = str(h.get("originalText") or fallback_text)
            replacement = str(h.get("replacementText") or "")
            clean.append(
                {
                    "blockId": block_id,
                    "originalRange": {"start": start, "end": end},
                    "originalText": original,
                    "replacementText": replacement,
                }
            )
        return {
            "hunks": clean,
            "summary": str(data.get("summary") or "")[:280],
        }
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_agent.py -v
```
Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/doc_editor/agent.py apps/worker/tests/agents/test_doc_editor_agent.py
git commit -m "feat(worker): DocEditorAgent happy path — improve command (Plan 11B-A)"
```

---

## Task 5: Worker — DocEditorAgent edge cases

**Files:**
- Modify: `apps/worker/tests/agents/test_doc_editor_agent.py`
- Modify: `apps/worker/src/worker/agents/doc_editor/agent.py` (only if a test exposes a missing branch)

- [ ] **Step 1: Add three failing tests**

Append to the test file:

```python
@pytest.mark.asyncio
async def test_unknown_command_raises_keyerror_path():
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value="{}")
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)
    with pytest.raises(KeyError):
        async for _ in agent.run(
            {
                "command": "outline",
                "selection": {
                    "blockId": "b1",
                    "start": 0,
                    "end": 4,
                    "text": "test",
                },
                "documentContextSnippet": "",
                "note_id": "n",
                "user_id": "u",
            },
            _ctx(),
        ):
            pass


@pytest.mark.asyncio
async def test_oversized_selection_rejected():
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value="{}")
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)
    big = "x" * 5000
    with pytest.raises(ValueError, match="selection too long"):
        async for _ in agent.run(
            {
                "command": "improve",
                "selection": {
                    "blockId": "b1",
                    "start": 0,
                    "end": 5000,
                    "text": big,
                },
                "documentContextSnippet": "",
                "note_id": "n",
                "user_id": "u",
            },
            _ctx(),
        ):
            pass


@pytest.mark.asyncio
async def test_translate_passes_language_to_user_message():
    raw = json.dumps(
        {
            "hunks": [
                {
                    "blockId": "b1",
                    "originalRange": {"start": 0, "end": 5},
                    "originalText": "hello",
                    "replacementText": "안녕하세요",
                }
            ],
            "summary": "Translated to ko",
        }
    )
    provider = AsyncMock()
    provider.generate = AsyncMock(return_value=raw)
    provider.config.model = "gemini-2.5-flash"
    agent = DocEditorAgent(provider=provider)
    async for _ in agent.run(
        {
            "command": "translate",
            "selection": {"blockId": "b1", "start": 0, "end": 5, "text": "hello"},
            "language": "ko",
            "documentContextSnippet": "",
            "note_id": "n",
            "user_id": "u",
        },
        _ctx(),
    ):
        pass
    args, _ = provider.generate.call_args
    user_msg = args[0][1]["content"]
    assert "Target language: ko" in user_msg
```

- [ ] **Step 2: Verify all 3 fail (or pass; KeyError already raises today, oversized too)**

```
pnpm --filter @opencairn/worker exec pytest tests/agents/test_doc_editor_agent.py -v
```
Expected: KeyError + oversized + translate-language all expectations correct on the existing implementation. If any fail, fix the agent (likely no fix needed — the spec already covers these).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/tests/agents/test_doc_editor_agent.py
git commit -m "test(worker): doc-editor agent edge cases — unknown cmd, oversized, translate header"
```

---

## Task 6: Worker — Temporal activity + workflow + registration

**Files:**
- Create: `apps/worker/src/worker/activities/doc_editor_activity.py`
- Create: `apps/worker/src/worker/workflows/doc_editor_workflow.py`
- Modify: `apps/worker/src/worker/temporal_main.py`
- Create: `apps/worker/tests/activities/test_doc_editor_activity.py`

- [ ] **Step 1: Write activity test**

```python
# apps/worker/tests/activities/test_doc_editor_activity.py
"""Plan 11B Phase A — doc-editor activity returns the agent output."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from worker.activities.doc_editor_activity import (
    DocEditorActivityInput,
    run_doc_editor,
)


@pytest.mark.asyncio
async def test_run_doc_editor_returns_payload():
    fake_output = {
        "command": "improve",
        "output_mode": "diff",
        "payload": {
            "hunks": [
                {
                    "blockId": "b1",
                    "originalRange": {"start": 0, "end": 5},
                    "originalText": "hello",
                    "replacementText": "Hello there",
                }
            ],
            "summary": "tightened",
        },
        "tokens_in": 100,
        "tokens_out": 30,
    }
    with patch(
        "worker.activities.doc_editor_activity._invoke_agent",
        new=AsyncMock(return_value=fake_output),
    ):
        out = await run_doc_editor(
            DocEditorActivityInput(
                command="improve",
                note_id="n1",
                workspace_id="ws1",
                user_id="u1",
                selection_block_id="b1",
                selection_start=0,
                selection_end=5,
                selection_text="hello",
                document_context_snippet="",
                language=None,
            )
        )
    assert out["command"] == "improve"
    assert out["payload"]["hunks"][0]["replacementText"] == "Hello there"
    assert out["tokens_in"] == 100
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/worker exec pytest tests/activities/test_doc_editor_activity.py -v
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement activity**

```python
# apps/worker/src/worker/activities/doc_editor_activity.py
"""Plan 11B Phase A — Temporal activity that invokes DocEditorAgent."""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from typing import Any

from temporalio import activity

from llm import build_provider_from_env
from runtime.tools import ToolContext

from worker.agents.doc_editor.agent import DocEditorAgent
from runtime.events import AgentEnd


@dataclass(frozen=True)
class DocEditorActivityInput:
    command: str
    note_id: str
    workspace_id: str
    user_id: str
    selection_block_id: str
    selection_start: int
    selection_end: int
    selection_text: str
    document_context_snippet: str
    language: str | None


async def _invoke_agent(payload: DocEditorActivityInput) -> dict[str, Any]:
    provider = build_provider_from_env()
    agent = DocEditorAgent(provider=provider)
    ctx = ToolContext(
        run_id=f"doc-editor-{uuid.uuid4().hex[:12]}",
        workspace_id=payload.workspace_id,
        scope={"workspace_id": payload.workspace_id, "user_id": payload.user_id},
    )
    output: dict[str, Any] | None = None
    async for ev in agent.run(
        {
            "command": payload.command,
            "selection": {
                "blockId": payload.selection_block_id,
                "start": payload.selection_start,
                "end": payload.selection_end,
                "text": payload.selection_text,
            },
            "documentContextSnippet": payload.document_context_snippet,
            "language": payload.language,
            "note_id": payload.note_id,
            "user_id": payload.user_id,
        },
        ctx,
    ):
        if isinstance(ev, AgentEnd):
            output = ev.output
    if output is None:
        raise RuntimeError("DocEditorAgent did not yield AgentEnd")
    return output


@activity.defn(name="run_doc_editor")
async def run_doc_editor(payload: DocEditorActivityInput) -> dict[str, Any]:
    return await _invoke_agent(payload)
```

- [ ] **Step 4: Implement workflow**

```python
# apps/worker/src/worker/workflows/doc_editor_workflow.py
"""Plan 11B Phase A — DocEditorWorkflow.

Single activity wrapper. We use a workflow rather than calling the
activity directly so the API can use the same Temporal client pattern as
research/code. The workflow is short (one activity + return); future
phases may extend it for multi-step commands like /factcheck.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from worker.activities.doc_editor_activity import (
        DocEditorActivityInput,
        run_doc_editor,
    )


@workflow.defn(name="DocEditorWorkflow")
class DocEditorWorkflow:
    @workflow.run
    async def run(self, payload: DocEditorActivityInput) -> dict[str, Any]:
        return await workflow.execute_activity(
            run_doc_editor,
            payload,
            start_to_close_timeout=timedelta(seconds=45),
            retry_policy=workflow.RetryPolicy(  # type: ignore[attr-defined]
                maximum_attempts=2,
            ),
        )
```

- [ ] **Step 5: Register in temporal_main**

In `apps/worker/src/worker/temporal_main.py`, locate the workflow + activity registration block (search for `workflows=` and `activities=`). Add:

```python
# Plan 11B Phase A — DocEditor (flag-gated).
if os.environ.get("FEATURE_DOC_EDITOR_SLASH", "false").lower() == "true":
    from worker.workflows.doc_editor_workflow import DocEditorWorkflow
    from worker.activities.doc_editor_activity import run_doc_editor as _run_doc_editor
    workflows.append(DocEditorWorkflow)
    activities.append(_run_doc_editor)
```

(Adapt to match the surrounding pattern; if the file uses a `build_worker_config()` factory, add inside that.)

- [ ] **Step 6: Verify activity test passes**

```
pnpm --filter @opencairn/worker exec pytest tests/activities/test_doc_editor_activity.py -v
```
Expected: PASS.

Also run the existing temporal_main test (if any):
```
pnpm --filter @opencairn/worker exec pytest tests/test_temporal_main_code.py -v
```
Expected: still PASS (flag-gated registration doesn't break the default OFF path).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/worker/activities/doc_editor_activity.py apps/worker/src/worker/workflows/doc_editor_workflow.py apps/worker/src/worker/temporal_main.py apps/worker/tests/activities/test_doc_editor_activity.py
git commit -m "feat(worker): DocEditor activity + workflow + flag-gated registration (Plan 11B-A)"
```

---

## Task 7: API — `POST /api/notes/:noteId/doc-editor/commands/:commandName`

**Files:**
- Create: `apps/api/src/lib/doc-editor-sse.ts`
- Create: `apps/api/src/routes/doc-editor.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/tests/doc-editor.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/doc-editor.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { app } from "../src/app";
import { withTestUser } from "./helpers";

const origFlag = process.env.FEATURE_DOC_EDITOR_SLASH;
beforeEach(() => {
  process.env.FEATURE_DOC_EDITOR_SLASH = "true";
});

afterAll(() => {
  process.env.FEATURE_DOC_EDITOR_SLASH = origFlag;
});

describe("POST /api/notes/:id/doc-editor/commands/:command", () => {
  it("returns 404 on unknown note (no info disclosure)", async () => {
    const { auth, userId } = await withTestUser();
    const res = await app.request(
      "/api/notes/00000000-0000-0000-0000-000000000000/doc-editor/commands/improve",
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 on unknown command", async () => {
    const { auth, noteId } = await seedNote();
    const res = await app.request(
      `/api/notes/${noteId}/doc-editor/commands/outline`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when caller has read-only role", async () => {
    const { auth, noteId } = await seedNote({ role: "viewer" });
    const res = await app.request(
      `/api/notes/${noteId}/doc-editor/commands/improve`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("streams delta + doc_editor_result + cost + done on success", async () => {
    const { auth, noteId } = await seedNote();
    vi.spyOn(
      await import("../src/lib/temporal-client"),
      "executeDocEditorWorkflow",
    ).mockResolvedValue({
      command: "improve",
      output_mode: "diff",
      payload: {
        hunks: [
          {
            blockId: "b1",
            originalRange: { start: 0, end: 5 },
            originalText: "hello",
            replacementText: "Hello there",
          },
        ],
        summary: "1 word adjusted",
      },
      tokens_in: 100,
      tokens_out: 30,
    });

    const res = await app.request(
      `/api/notes/${noteId}/doc-editor/commands/improve`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: doc_editor_result");
    expect(body).toContain("event: cost");
    expect(body).toContain("event: done");
  });
});
```

(Replace `withTestUser` / `seedNote` with the existing test helpers in `apps/api/tests/helpers.ts`.)

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/api test -- doc-editor
```
Expected: 4 FAILs.

- [ ] **Step 3: Implement SSE encoder**

```ts
// apps/api/src/lib/doc-editor-sse.ts
import type { DocEditorSseEvent } from "@opencairn/shared";

export function encodeSseEvent(event: DocEditorSseEvent): string {
  // Spec mirrors the chat.ts encoder. `event:` line is the discriminator;
  // `data:` is the JSON-stringified body sans the `type` field for
  // compactness — clients reconstruct via the event name.
  const { type, ...rest } = event;
  return `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`;
}
```

- [ ] **Step 4: Implement route**

```ts
// apps/api/src/routes/doc-editor.ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  docEditorCommandSchema,
  docEditorRequestSchema,
} from "@opencairn/shared";
import { docEditorCalls } from "@opencairn/db";
import { encodeSseEvent } from "../lib/doc-editor-sse";
import { canWrite, getNoteOrNotFound } from "../lib/permissions";
import { db } from "../db";
import { executeDocEditorWorkflow } from "../lib/temporal-client";

export const docEditorRouter = new Hono();

docEditorRouter.post(
  "/notes/:noteId/doc-editor/commands/:commandName",
  async (c) => {
    const noteId = c.req.param("noteId");
    const commandName = c.req.param("commandName");
    const user = c.get("user"); // requireAuth middleware populates this

    const note = await getNoteOrNotFound(noteId, user.id);
    if (!note) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(note, user.id))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const cmdParsed = docEditorCommandSchema.safeParse(commandName);
    if (!cmdParsed.success) {
      return c.json({ error: "command_unknown" }, 400);
    }

    const bodyParsed = docEditorRequestSchema.safeParse(await c.req.json());
    if (!bodyParsed.success) {
      return c.json(
        { error: "invalid_body", details: bodyParsed.error.flatten() },
        400,
      );
    }

    const { selection, language, documentContextSnippet } = bodyParsed.data;

    return streamSSE(c, async (stream) => {
      const startedAt = Date.now();
      try {
        const result = await executeDocEditorWorkflow({
          command: cmdParsed.data,
          note_id: noteId,
          workspace_id: note.workspaceId,
          user_id: user.id,
          selection_block_id: selection.blockId,
          selection_start: selection.start,
          selection_end: selection.end,
          selection_text: selection.text,
          document_context_snippet: documentContextSnippet,
          language: language ?? null,
        });

        await stream.write(
          encodeSseEvent({
            type: "doc_editor_result",
            output_mode: "diff",
            payload: result.payload,
          }),
        );
        await stream.write(
          encodeSseEvent({
            type: "cost",
            tokens_in: result.tokens_in,
            tokens_out: result.tokens_out,
            cost_krw: 0, // Plan 13 follow-up — provider-specific pricing
          }),
        );
        await stream.write(encodeSseEvent({ type: "done" }));

        await db.insert(docEditorCalls).values({
          noteId,
          workspaceId: note.workspaceId,
          userId: user.id,
          command: cmdParsed.data,
          tokensIn: result.tokens_in,
          tokensOut: result.tokens_out,
          costKrw: "0",
          status: "ok",
        });
      } catch (err) {
        await stream.write(
          encodeSseEvent({
            type: "error",
            code: "llm_failed",
            message: err instanceof Error ? err.message : "unknown",
          }),
        );
        await stream.write(encodeSseEvent({ type: "done" }));
        await db.insert(docEditorCalls).values({
          noteId,
          workspaceId: note.workspaceId,
          userId: user.id,
          command: cmdParsed.data,
          tokensIn: 0,
          tokensOut: 0,
          costKrw: "0",
          status: "failed",
          errorCode: err instanceof Error ? err.name : "internal",
        });
      } finally {
        c.executionCtx?.waitUntil?.(
          Promise.resolve(Date.now() - startedAt),
        ); // metric breadcrumb
      }
    });
  },
);
```

(Adjust `getNoteOrNotFound` / `canWrite` / `executeDocEditorWorkflow` to existing helpers — reference Plan 11A `routes/chat.ts` for SSE+auth patterns and Plan 4 Phase B for Temporal client wrapper.)

- [ ] **Step 5: Mount router behind flag**

In `apps/api/src/app.ts`, near the other route mounts:

```ts
if (process.env.FEATURE_DOC_EDITOR_SLASH === "true") {
  const { docEditorRouter } = await import("./routes/doc-editor");
  app.route("/api", docEditorRouter);
}
```

- [ ] **Step 6: Verify pass**

```
pnpm --filter @opencairn/api test -- doc-editor
```
Expected: 4 PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/doc-editor-sse.ts apps/api/src/routes/doc-editor.ts apps/api/src/app.ts apps/api/tests/doc-editor.test.ts
git commit -m "feat(api): doc-editor SSE route + audit + flag gate (Plan 11B-A)"
```

---

## Task 8: Web — typed SSE client + `useDocEditorCommand` hook

**Files:**
- Create: `apps/web/src/lib/api/doc-editor.ts`
- Create: `apps/web/src/hooks/useDocEditorCommand.ts`
- Create: `apps/web/src/lib/api/__tests__/doc-editor.test.ts`

- [ ] **Step 1: Write failing test (parser)**

```ts
// apps/web/src/lib/api/__tests__/doc-editor.test.ts
import { describe, it, expect } from "vitest";
import { parseSseChunk } from "../doc-editor";

describe("parseSseChunk", () => {
  it("yields a doc_editor_result event from a well-formed chunk", () => {
    const chunk =
      "event: doc_editor_result\n" +
      `data: ${JSON.stringify({
        output_mode: "diff",
        payload: {
          hunks: [
            {
              blockId: "b1",
              originalRange: { start: 0, end: 5 },
              originalText: "hello",
              replacementText: "Hello",
            },
          ],
          summary: "tightened",
        },
      })}\n\n`;
    const events = parseSseChunk(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("doc_editor_result");
  });

  it("ignores malformed events without throwing", () => {
    const chunk = "event: doc_editor_result\ndata: {not json\n\n";
    expect(parseSseChunk(chunk)).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/web test -- doc-editor
```
Expected: FAIL.

- [ ] **Step 3: Implement parser + hook**

```ts
// apps/web/src/lib/api/doc-editor.ts
import {
  docEditorSseEventSchema,
  type DocEditorSseEvent,
  type DocEditorRequest,
  type DocEditorCommand,
} from "@opencairn/shared";

export function parseSseChunk(chunk: string): DocEditorSseEvent[] {
  const out: DocEditorSseEvent[] = [];
  for (const block of chunk.split("\n\n")) {
    const lines = block.split("\n");
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (!event || !data) continue;
    try {
      const parsed = docEditorSseEventSchema.safeParse({
        type: event,
        ...JSON.parse(data),
      });
      if (parsed.success) out.push(parsed.data);
    } catch {
      // bad JSON — skip silently; the surface UI already shows progress
      // up to the last good event.
    }
  }
  return out;
}

export async function* runDocEditorCommand(
  noteId: string,
  command: DocEditorCommand,
  body: DocEditorRequest,
  signal?: AbortSignal,
): AsyncGenerator<DocEditorSseEvent> {
  const res = await fetch(
    `/api/notes/${noteId}/doc-editor/commands/${command}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!res.ok) {
    yield {
      type: "error",
      code: res.status === 403 ? "selection_race" : "internal",
      message: `HTTP ${res.status}`,
    };
    yield { type: "done" };
    return;
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const splitAt = buffer.lastIndexOf("\n\n");
    if (splitAt === -1) continue;
    const ready = buffer.slice(0, splitAt + 2);
    buffer = buffer.slice(splitAt + 2);
    for (const ev of parseSseChunk(ready)) yield ev;
  }
  if (buffer) for (const ev of parseSseChunk(buffer)) yield ev;
}
```

```ts
// apps/web/src/hooks/useDocEditorCommand.ts
"use client";

import { useCallback, useRef, useState } from "react";
import type {
  DocEditorCommand,
  DocEditorRequest,
  DocEditorSseEvent,
  DocEditorDiffPayload,
} from "@opencairn/shared";
import { runDocEditorCommand } from "@/lib/api/doc-editor";

export type DocEditorState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "ready";
      payload: DocEditorDiffPayload;
      cost: { tokens_in: number; tokens_out: number; cost_krw: number };
    }
  | { status: "error"; code: string; message: string };

export function useDocEditorCommand() {
  const [state, setState] = useState<DocEditorState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (
      noteId: string,
      command: DocEditorCommand,
      body: DocEditorRequest,
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState({ status: "running" });
      let payload: DocEditorDiffPayload | null = null;
      let cost = { tokens_in: 0, tokens_out: 0, cost_krw: 0 };
      try {
        for await (const ev of runDocEditorCommand(
          noteId,
          command,
          body,
          ac.signal,
        )) {
          if (ev.type === "doc_editor_result") payload = ev.payload;
          else if (ev.type === "cost") cost = ev;
          else if (ev.type === "error") {
            setState({ status: "error", code: ev.code, message: ev.message });
            return;
          }
        }
        if (payload)
          setState({ status: "ready", payload, cost });
        else
          setState({
            status: "error",
            code: "internal",
            message: "no result",
          });
      } catch (err) {
        setState({
          status: "error",
          code: "internal",
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle" });
  }, []);

  return { state, run, reset };
}
```

- [ ] **Step 4: Verify parser test passes**

```
pnpm --filter @opencairn/web test -- doc-editor
```
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/doc-editor.ts apps/web/src/hooks/useDocEditorCommand.ts apps/web/src/lib/api/__tests__/doc-editor.test.ts
git commit -m "feat(web): doc-editor SSE client + useDocEditorCommand hook (Plan 11B-A)"
```

---

## Task 9: Web — `applyHunks` Plate transform (pure, unit-tested)

**Files:**
- Create: `apps/web/src/components/editor/doc-editor/applyHunks.ts`
- Create: `apps/web/src/components/editor/doc-editor/__tests__/applyHunks.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/web/src/components/editor/doc-editor/__tests__/applyHunks.test.ts
import { describe, it, expect } from "vitest";
import { applyHunksToValue } from "../applyHunks";
import type { Value } from "platejs";

describe("applyHunksToValue", () => {
  const initial: Value = [
    {
      type: "p",
      id: "b1",
      children: [{ text: "hello world" }],
    },
  ];

  it("replaces a substring inside a single text node", () => {
    const next = applyHunksToValue(initial, [
      {
        blockId: "b1",
        originalRange: { start: 0, end: 5 },
        originalText: "hello",
        replacementText: "Hi",
      },
    ]);
    expect(next).toEqual([
      { type: "p", id: "b1", children: [{ text: "Hi world" }] },
    ]);
  });

  it("returns input unchanged when the originalText no longer matches", () => {
    const stale: Value = [
      { type: "p", id: "b1", children: [{ text: "different content" }] },
    ];
    const next = applyHunksToValue(stale, [
      {
        blockId: "b1",
        originalRange: { start: 0, end: 5 },
        originalText: "hello",
        replacementText: "Hi",
      },
    ]);
    expect(next).toEqual(stale);
  });

  it("skips hunks targeting unknown block ids", () => {
    const next = applyHunksToValue(initial, [
      {
        blockId: "missing",
        originalRange: { start: 0, end: 5 },
        originalText: "hello",
        replacementText: "Hi",
      },
    ]);
    expect(next).toEqual(initial);
  });
});
```

- [ ] **Step 2: Verify failure**

```
pnpm --filter @opencairn/web test -- applyHunks
```
Expected: FAIL.

- [ ] **Step 3: Implement transform**

```ts
// apps/web/src/components/editor/doc-editor/applyHunks.ts
import type { Value, TElement, TText } from "platejs";
import type { DocEditorHunk } from "@opencairn/shared";

// Plan 11B Phase A — pure transform, no Plate editor instance required.
// Strategy: walk the top-level blocks, match by `id`, then concatenate
// child text into a single string for range-replace. Mixed-mark spans
// inside a hunk collapse to a single plain text node — acceptable for
// /improve/translate/summarize/expand because the LLM rewrites the prose;
// per-mark preservation is a Phase C concern (Diff View).
export function applyHunksToValue(
  value: Value,
  hunks: DocEditorHunk[],
): Value {
  if (hunks.length === 0) return value;
  return value.map((node) => {
    if (!isElementWithId(node)) return node;
    const blockHunks = hunks.filter((h) => h.blockId === node.id);
    if (blockHunks.length === 0) return node;
    const flat = flattenChildren(node.children);
    let mutated = flat;
    let drift = 0;
    for (const h of blockHunks.sort(
      (a, b) => a.originalRange.start - b.originalRange.start,
    )) {
      const start = h.originalRange.start + drift;
      const end = h.originalRange.end + drift;
      const slice = mutated.slice(start, end);
      if (slice !== h.originalText) {
        // Document drifted (user edited concurrently). Skip this hunk.
        continue;
      }
      mutated = mutated.slice(0, start) + h.replacementText + mutated.slice(end);
      drift += h.replacementText.length - h.originalText.length;
    }
    if (mutated === flat) return node;
    return { ...node, children: [{ text: mutated }] as TText[] };
  });
}

function isElementWithId(
  node: unknown,
): node is TElement & { id: string; children: (TElement | TText)[] } {
  return (
    typeof node === "object" &&
    node !== null &&
    "id" in node &&
    typeof (node as { id: unknown }).id === "string" &&
    "children" in node
  );
}

function flattenChildren(children: (TElement | TText)[]): string {
  return children
    .map((c) => ("text" in c ? c.text : flattenChildren(c.children ?? [])))
    .join("");
}
```

- [ ] **Step 4: Verify pass**

```
pnpm --filter @opencairn/web test -- applyHunks
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/doc-editor/applyHunks.ts apps/web/src/components/editor/doc-editor/__tests__/applyHunks.test.ts
git commit -m "feat(web): applyHunks pure Plate transform with drift-skip (Plan 11B-A)"
```

---

## Task 10: Web — `InlineDiffSheet` UI

**Files:**
- Create: `apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx`
- Create: `apps/web/src/components/editor/doc-editor/__tests__/InlineDiffSheet.test.tsx`
- Create: `apps/web/messages/ko/doc-editor.json`
- Create: `apps/web/messages/en/doc-editor.json`
- Modify: `apps/web/src/lib/i18n.ts`

- [ ] **Step 1: Add i18n keys (ko)**

```json
// apps/web/messages/ko/doc-editor.json
{
  "section": {
    "ai": "AI"
  },
  "command": {
    "improve": "다듬기",
    "translate": "번역",
    "summarize": "요약",
    "expand": "확장"
  },
  "translate": {
    "language": {
      "ko": "한국어",
      "en": "영어",
      "ja": "일본어",
      "zh": "중국어"
    }
  },
  "sheet": {
    "title": "AI 편집 결과 미리보기",
    "summary": "{summary}",
    "loading": "처리 중…",
    "hunkOriginal": "원본",
    "hunkReplacement": "수정",
    "acceptAll": "모두 적용",
    "rejectAll": "모두 취소",
    "cost": "토큰 {tokensIn}/{tokensOut}",
    "noChange": "변경할 내용이 없어요"
  },
  "error": {
    "llm_failed": "AI 호출이 실패했어요. 다시 시도해 보세요.",
    "selection_race": "문서가 변경되어 적용할 수 없어요.",
    "command_unknown": "지원하지 않는 명령이에요.",
    "internal": "예기치 못한 오류가 발생했어요."
  }
}
```

- [ ] **Step 2: Add i18n keys (en)**

```json
// apps/web/messages/en/doc-editor.json
{
  "section": {
    "ai": "AI"
  },
  "command": {
    "improve": "Improve",
    "translate": "Translate",
    "summarize": "Summarize",
    "expand": "Expand"
  },
  "translate": {
    "language": {
      "ko": "Korean",
      "en": "English",
      "ja": "Japanese",
      "zh": "Chinese"
    }
  },
  "sheet": {
    "title": "AI edit preview",
    "summary": "{summary}",
    "loading": "Working…",
    "hunkOriginal": "Original",
    "hunkReplacement": "Replacement",
    "acceptAll": "Accept all",
    "rejectAll": "Reject all",
    "cost": "Tokens {tokensIn}/{tokensOut}",
    "noChange": "Nothing to change"
  },
  "error": {
    "llm_failed": "AI call failed. Please retry.",
    "selection_race": "The document changed; the edit no longer applies.",
    "command_unknown": "Unsupported command.",
    "internal": "Unexpected error."
  }
}
```

- [ ] **Step 3: Register namespace**

In `apps/web/src/lib/i18n.ts`, add `"doc-editor"` to the namespace list. Ensure `i18n:parity` script picks it up.

- [ ] **Step 4: Write failing component test**

```tsx
// apps/web/src/components/editor/doc-editor/__tests__/InlineDiffSheet.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineDiffSheet } from "../InlineDiffSheet";
import { withI18n } from "@/test-utils/withI18n";

describe("InlineDiffSheet", () => {
  it("renders summary + per-hunk preview when ready", () => {
    render(
      withI18n(
        <InlineDiffSheet
          open
          state={{
            status: "ready",
            payload: {
              hunks: [
                {
                  blockId: "b1",
                  originalRange: { start: 0, end: 5 },
                  originalText: "hello",
                  replacementText: "Hi",
                },
              ],
              summary: "tightened",
            },
            cost: { tokens_in: 100, tokens_out: 30, cost_krw: 0 },
          }}
          onAcceptAll={vi.fn()}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText("tightened")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();
  });

  it("invokes onAcceptAll on the accept button", () => {
    const onAcceptAll = vi.fn();
    render(
      withI18n(
        <InlineDiffSheet
          open
          state={{
            status: "ready",
            payload: {
              hunks: [
                {
                  blockId: "b1",
                  originalRange: { start: 0, end: 5 },
                  originalText: "hello",
                  replacementText: "Hi",
                },
              ],
              summary: "tightened",
            },
            cost: { tokens_in: 0, tokens_out: 0, cost_krw: 0 },
          }}
          onAcceptAll={onAcceptAll}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /accept all|모두 적용/i }));
    expect(onAcceptAll).toHaveBeenCalled();
  });

  it("renders error state with the right message key", () => {
    render(
      withI18n(
        <InlineDiffSheet
          open
          state={{ status: "error", code: "llm_failed", message: "..." }}
          onAcceptAll={vi.fn()}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText(/AI call failed|AI 호출이 실패/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Verify failure**

```
pnpm --filter @opencairn/web test -- InlineDiffSheet
```
Expected: FAIL — component missing.

- [ ] **Step 6: Implement component**

```tsx
// apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx
"use client";

import { useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { DocEditorState } from "@/hooks/useDocEditorCommand";

type Props = {
  open: boolean;
  state: DocEditorState;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
};

export function InlineDiffSheet({
  open,
  state,
  onAcceptAll,
  onRejectAll,
  onClose,
}: Props) {
  const t = useTranslations("doc-editor.sheet");
  const tErr = useTranslations("doc-editor.error");

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>

        {state.status === "running" && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}

        {state.status === "error" && (
          <p className="text-sm text-destructive">{tErr(state.code)}</p>
        )}

        {state.status === "ready" && (
          <>
            <p className="text-sm text-muted-foreground mb-2">
              {state.payload.summary || t("noChange")}
            </p>
            <div className="flex-1 overflow-y-auto space-y-3">
              {state.payload.hunks.map((h, i) => (
                <div key={i} className="rounded border p-2 text-sm">
                  <div className="text-xs text-muted-foreground mb-1">
                    {t("hunkOriginal")}
                  </div>
                  <pre className="whitespace-pre-wrap text-foreground/70 line-through">
                    {h.originalText}
                  </pre>
                  <div className="text-xs text-muted-foreground mt-2 mb-1">
                    {t("hunkReplacement")}
                  </div>
                  <pre className="whitespace-pre-wrap text-foreground">
                    {h.replacementText}
                  </pre>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-3 border-t">
              <span className="text-xs text-muted-foreground">
                {t("cost", {
                  tokensIn: state.cost.tokens_in,
                  tokensOut: state.cost.tokens_out,
                })}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onRejectAll}>
                  {t("rejectAll")}
                </Button>
                <Button onClick={onAcceptAll}>{t("acceptAll")}</Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 7: Verify component test passes**

```
pnpm --filter @opencairn/web test -- InlineDiffSheet
```
Expected: 3 PASS.

- [ ] **Step 8: Verify i18n parity**

```
pnpm --filter @opencairn/web i18n:parity
```
Expected: PASS — both ko/en have the same key set including the new `doc-editor` namespace.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx apps/web/src/components/editor/doc-editor/__tests__/InlineDiffSheet.test.tsx apps/web/messages/ko/doc-editor.json apps/web/messages/en/doc-editor.json apps/web/src/lib/i18n.ts
git commit -m "feat(web): InlineDiffSheet + doc-editor i18n namespace (Plan 11B-A)"
```

---

## Task 11: Web — Slash menu AI section

**Files:**
- Modify: `apps/web/src/components/editor/plugins/slash.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx` (or wherever the slash plugin is consumed) — wire the AI commands to `useDocEditorCommand` + `InlineDiffSheet`.

- [ ] **Step 1: Read current slash menu structure**

Run:
```
sed -n '1,200p' apps/web/src/components/editor/plugins/slash.tsx
```
Identify:
- The `SlashKey` union (extend with `improve | translate | summarize | expand`).
- The `COMMANDS` array — add four entries with `section: 'ai'`.
- The render path — add a section divider + `<div>{t('section.ai')}</div>` header before the AI rows.

- [ ] **Step 2: Extend slash menu (incremental edit)**

Add to the `SlashKey` union:
```ts
| "improve"
| "translate"
| "summarize"
| "expand"
```

Add a `section` field to `SlashCommandDef`:
```ts
interface SlashCommandDef {
  key: SlashKey;
  section: "block" | "ai";
  labelKey: /* ...existing... */ | "improve" | "translate" | "summarize" | "expand";
}
```

Append AI rows to `COMMANDS`:
```ts
{ key: "improve", section: "ai", labelKey: "improve" },
{ key: "translate", section: "ai", labelKey: "translate" },
{ key: "summarize", section: "ai", labelKey: "summarize" },
{ key: "expand", section: "ai", labelKey: "expand" },
```

Set the existing block rows' `section: "block"`.

In the render: group by section. When user picks an AI key, instead of running a Plate transform, fire a callback prop `onAiCommand({ command, selection })`. The block-section keys keep their existing transform behavior.

- [ ] **Step 3: Wire callback in NoteEditor**

In `NoteEditor.tsx` (or the consumer file):

```ts
const docEditor = useDocEditorCommand();
const [sheetOpen, setSheetOpen] = useState(false);

const handleAiCommand = useCallback(
  (cmd: DocEditorCommand) => {
    const selection = readSelection(editor); // returns blockId/start/end/text
    if (!selection) return;
    setSheetOpen(true);
    void docEditor.run(noteId, cmd, {
      selection,
      documentContextSnippet: readSnippetAround(editor, selection),
    });
  },
  [editor, noteId, docEditor],
);
```

Helpers `readSelection` + `readSnippetAround` are small utility wrappers — implement inline next to the callback or in a sibling `selection-helpers.ts`. The selection should include the highlighted text or, if no selection, the current block's full text + range `[0, blockText.length]`.

For `/translate`, the language pick is a follow-up submenu; in Phase A ship a simple `prompt()` fallback or a small inline dropdown in `InlineDiffSheet` that re-runs with `language=`. Either way, default to the user's locale (`useLocale()`).

Render `InlineDiffSheet`:
```tsx
<InlineDiffSheet
  open={sheetOpen}
  state={docEditor.state}
  onAcceptAll={() => {
    if (docEditor.state.status !== "ready") return;
    const next = applyHunksToValue(editor.children, docEditor.state.payload.hunks);
    editor.tf.setValue(next);
    setSheetOpen(false);
    docEditor.reset();
  }}
  onRejectAll={() => {
    setSheetOpen(false);
    docEditor.reset();
  }}
  onClose={() => {
    setSheetOpen(false);
    docEditor.reset();
  }}
/>
```

(`editor.tf.setValue` may need to match the current Plate v49 API — verify with `editor-toolbar.tsx`. If the API differs, use `editor.children = next; editor.onChange()` or the appropriate transform.)

- [ ] **Step 4: Run web tests + tsc**

```
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web typecheck
```
Expected: full suite still green.

- [ ] **Step 5: Manual smoke (dev server)**

Start the stack with `FEATURE_DOC_EDITOR_SLASH=true`:
```
FEATURE_DOC_EDITOR_SLASH=true pnpm dev
```
- Open a note, select a sentence.
- Type `/`, scroll to "AI", click "Improve".
- Sheet opens, shows summary + hunk preview, click "Accept all".
- Confirm the selected text changed in the editor.

If anything breaks, fix before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/plugins/slash.tsx apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): slash menu AI section + InlineDiffSheet wiring (Plan 11B-A)"
```

---

## Task 12: Web — Translate language picker (lightweight inline)

**Files:**
- Modify: `apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx`
- Modify: `apps/web/src/components/editor/NoteEditor.tsx`

- [ ] **Step 1: Extend the sheet for language picker**

When the active command is `translate` and there's no result yet, render a small `<select>` of `ko/en/ja/zh` (i18n keys exist already). On change, re-trigger the run with the chosen language. Default value: the inverse of the current locale (if user is on `ko`, default to `en`).

The simplest path: pass `currentCommand: DocEditorCommand` and `onLanguageChange: (lang: string) => void` props to `InlineDiffSheet`. Keep the existing `state` semantics.

- [ ] **Step 2: Add a snapshot-style test**

```tsx
it("renders language picker in running state for /translate", () => {
  const onLang = vi.fn();
  render(
    withI18n(
      <InlineDiffSheet
        open
        state={{ status: "running" }}
        currentCommand="translate"
        onLanguageChange={onLang}
        onAcceptAll={vi.fn()}
        onRejectAll={vi.fn()}
        onClose={vi.fn()}
      />,
    ),
  );
  const sel = screen.getByRole("combobox");
  fireEvent.change(sel, { target: { value: "ja" } });
  expect(onLang).toHaveBeenCalledWith("ja");
});
```

- [ ] **Step 3: Verify pass**

```
pnpm --filter @opencairn/web test -- InlineDiffSheet
```
Expected: 4 PASS (3 existing + 1 new).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx apps/web/src/components/editor/NoteEditor.tsx apps/web/src/components/editor/doc-editor/__tests__/InlineDiffSheet.test.tsx
git commit -m "feat(web): translate language picker in InlineDiffSheet (Plan 11B-A)"
```

---

## Task 13: Race / 409 handling

**Files:**
- Modify: `apps/web/src/components/editor/doc-editor/applyHunks.ts` (already drift-skips; add a count-of-skipped return)
- Modify: `apps/web/src/components/editor/doc-editor/InlineDiffSheet.tsx` — surface partial-skip warning.
- Modify: tests.

- [ ] **Step 1: Update `applyHunksToValue` signature**

Change the return type:

```ts
export type ApplyHunksResult = { value: Value; appliedCount: number; skippedCount: number };
export function applyHunksToValue(value: Value, hunks: DocEditorHunk[]): ApplyHunksResult { /* ... */ }
```

Update existing tests to assert `result.value` and `result.skippedCount`/`appliedCount`.

- [ ] **Step 2: When skippedCount > 0, show toast on accept**

In the accept handler in `NoteEditor.tsx`:

```ts
const result = applyHunksToValue(editor.children, payload.hunks);
editor.tf.setValue(result.value);
if (result.skippedCount > 0) {
  toast.warning(t("error.selection_race"));
}
```

- [ ] **Step 3: Run tests**

```
pnpm --filter @opencairn/web test -- doc-editor
```
Expected: existing + updated tests all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/doc-editor/applyHunks.ts apps/web/src/components/editor/doc-editor/__tests__/applyHunks.test.ts apps/web/src/components/editor/NoteEditor.tsx
git commit -m "feat(web): partial-apply toast when document drifted (Plan 11B-A)"
```

---

## Task 14: API integration — happy-path end-to-end with real worker

**Files:**
- Modify: `apps/api/tests/doc-editor.test.ts` — add an integration variant that hits the real Temporal client (skipped in CI without a Temporal env var, mirroring research-smoke).

- [ ] **Step 1: Write a skipped-when-flag-off test**

```ts
it.skipIf(process.env.TEMPORAL_INTEGRATION !== "1")(
  "round-trips a real DocEditorWorkflow",
  async () => {
    const { auth, noteId } = await seedNote();
    const res = await app.request(
      `/api/notes/${noteId}/doc-editor/commands/improve`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
          documentContextSnippet: "",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: doc_editor_result");
  },
);
```

- [ ] **Step 2: Verify CI suite still passes (skipped block)**

```
pnpm --filter @opencairn/api test
```
Expected: PASS (real-Temporal test skipped).

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/doc-editor.test.ts
git commit -m "test(api): doc-editor real-Temporal integration smoke (skipped in CI)"
```

---

## Task 15: Activity event logging (observability)

**Files:**
- Modify: `apps/api/src/routes/doc-editor.ts` — emit structured log lines on each terminal event.

- [ ] **Step 1: Add structured log calls**

After `await db.insert(docEditorCalls).values(...)` in both branches, log:

```ts
import { logger } from "@/lib/logger"; // existing pino instance

logger.info(
  {
    event: "doc_editor.invoked",
    note_id: noteId,
    workspace_id: note.workspaceId,
    user_id: user.id,
    command: cmdParsed.data,
    status: "ok", // or "failed"
    tokens_in: result?.tokens_in ?? 0,
    tokens_out: result?.tokens_out ?? 0,
    duration_ms: Date.now() - startedAt,
  },
  "doc-editor command",
);
```

Match the `result` variable scope — declare it outside the try so the failure branch can log zeros.

- [ ] **Step 2: Verify api tests still pass**

```
pnpm --filter @opencairn/api test -- doc-editor
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/doc-editor.ts
git commit -m "feat(api): structured logs for doc_editor.invoked terminal events (Plan 11B-A)"
```

---

## Task 16: Docs sync + plans-status update

**Files:**
- Modify: `docs/architecture/api-contract.md`
- Modify: `docs/contributing/plans-status.md`
- Modify: `CLAUDE.md` (if Plans section needs amendment)

- [ ] **Step 1: Add API contract row**

In `docs/architecture/api-contract.md` under the public API table, add:

```
| `POST /api/notes/:id/doc-editor/commands/:command` | requireAuth · canWrite(noteId) · feature flag `FEATURE_DOC_EDITOR_SLASH` | SSE stream of `doc_editor_result` / `cost` / `error` / `done`. Commands v1: `improve`, `translate`, `summarize`, `expand`. /cite + /factcheck land in Plan 11B Phase B. Audit row in `doc_editor_calls`. |
```

- [ ] **Step 2: Add plans-status entry**

In `docs/contributing/plans-status.md` under the Phase 3 add-ons section (or wherever Plan 11B lives):

```
| `2026-04-28-plan-11b-phase-a-slash-commands.md` | 🟡 ready, plan only | Plan 11B Phase A — DocEditorAgent (runtime.Agent subclass) + 4 LLM-only slash commands (improve/translate/summarize/expand) + Plate AI section + InlineDiffSheet review UX + doc_editor_calls audit, behind FEATURE_DOC_EDITOR_SLASH. Defers RAG commands (/cite, /factcheck → Phase B), real Tab Mode Diff View (Phase C), save-suggestion / provenance / related-pages (Phase D/E/F). |
```

- [ ] **Step 3: Update CLAUDE.md Plans block (optional)**

If CLAUDE.md's "Active / next" line needs the entry, append `Plan 11B Phase A (slash commands, plan only)`. Skip if the user prefers minimal CLAUDE.md churn.

- [ ] **Step 4: Commit (docs only)**

```bash
git add docs/architecture/api-contract.md docs/contributing/plans-status.md CLAUDE.md
git commit -m "docs: Plan 11B Phase A — api-contract row + plans-status entry"
```

---

## Self-Review Checklist (run before declaring complete)

- [ ] Every spec §6 requirement covered: `/improve`, `/translate`, `/summarize`, `/expand` all wired through agent + API + UI; selection range guard present; cost recorded in `doc_editor_calls`; flag-gated; i18n parity green.
- [ ] No `/cite` or `/factcheck` references leak into Phase A code (those are Phase B).
- [ ] No Tab Mode `diff` viewer references — Phase A uses `InlineDiffSheet` exclusively.
- [ ] Migration number not hard-coded; collision with parallel sessions handled by re-running `pnpm db:generate` if needed.
- [ ] All `commit` steps run with the standard Co-Authored-By trailer (the project commit convention is enforced separately).
- [ ] Feature flag default OFF — main never sees AI section unless `FEATURE_DOC_EDITOR_SLASH=true`.
- [ ] `pnpm --filter @opencairn/web i18n:parity` green; new namespace registered in `i18n.ts`.
- [ ] `pnpm test` (root) green across packages.
- [ ] Manual smoke confirmed (Task 11 Step 5).

---

## Follow-ups (out of Phase A)

- **Phase B** — `/cite`, `/factcheck`. Depends on `ResearchAgent.hybrid_search` exposed via `apps/worker/src/worker/tools_builtin/`. `comment` output mode + Plate decoration markers + `comments` table author `'agent:doc_editor'`.
- **Phase C** — Tab Mode `diff` viewer with per-hunk granular accept/reject, replacing `InlineDiffSheet`. Requires `Tab.mode='diff'` + `TabModeRouter` case + dedicated payload route.
- **Phase D** — Save Suggestion (§4): `save_suggestion_ready` SSE event in chat stream + `concept_source_links` + Compiler signal path.
- **Phase E** — Page Provenance (§5): `created_from_conversation_id` on concepts + `GET /api/notes/:id/conversations` + popover UI + suggest-from-conversations.
- **Phase F** — Related Pages (§7): `notes.title_summary_embedding` + backfill + suggestion bar.
- **Cost / Token usage** — `tokens_in/out` are currently character-based heuristics; replace with provider-reported counts (Plan 12 follow-up that several agents already need).
- **Mark preservation** — `applyHunksToValue` collapses inline marks inside replaced ranges. Acceptable for prose rewrites; if a Phase B/C user complaint surfaces, revisit by walking child nodes and re-applying marks token-by-token.
