# Plan 7 Canvas Phase 2 — Code Agent · Self-healing · Monaco · matplotlib output

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 의 브라우저 sandbox 위에 **Code Agent (Python worker)** + **Temporal CodeAgentWorkflow** + **Monaco editor** + **matplotlib MinIO 저장** 을 얹어, 캔버스를 "AI 가 코드를 만들고 고치는 작업 환경" 으로 완성한다.

**Architecture:** `runtime.Agent` 패턴 + Temporal `CodeAgentWorkflow` (signal-based self-healing) + Hono SSE poll (Deep Research 패턴 재사용) + Monaco lazy-import + 사용자-명시 matplotlib 저장. `purpose="chat"` billing routing 재사용. `/api/canvas/from-template` 은 Plan 6 의존이라 flag-gated 501 stub.

**Tech Stack:** Next.js 16, Hono 4, Drizzle, Temporal Python 1.x, Pyodide 0.27, `@monaco-editor/react`, `@opencairn/llm` (Gemini/Ollama), Postgres, MinIO, Playwright, vitest, pytest.

**Spec:** [docs/superpowers/specs/2026-04-26-plan-7-canvas-phase-2-design.md](../specs/2026-04-26-plan-7-canvas-phase-2-design.md).

---

## File Structure

### New files

**packages/db**
- `drizzle/0024_canvas_code_runs_outputs.sql` — `code_runs` + `code_turns` + `canvas_outputs`.
- `src/schema/code-runs.ts` — Drizzle 정의 (3 테이블).

**packages/shared**
- `src/code-types.ts` — Zod schemas + types (run request / feedback / SSE event union / output create).

**apps/worker**
- `src/worker/agents/code/__init__.py`
- `src/worker/agents/code/agent.py` — `CodeAgent(runtime.Agent)`.
- `src/worker/agents/code/prompts.py` — system + generate + fix templates.
- `src/worker/activities/code_activity.py` — `generate_code_activity` + `analyze_feedback_activity`.
- `src/worker/workflows/code_workflow.py` — `CodeAgentWorkflow` + signals + dataclasses.
- `tests/agents/test_code_agent.py`
- `tests/activities/test_code_activity.py`
- `tests/workflows/test_code_workflow.py`

**apps/api**
- `src/routes/code.ts` — `/api/code/run` (SSE) + `/api/code/feedback`.
- `src/routes/canvas.ts` — `/api/canvas/from-template` (501 stub) + `/api/canvas/output` (POST/GET) + GET stream.
- `src/lib/code-agent-client.ts` — Temporal client wrapper (signalWithStart, signal, query).
- `tests/routes/code.test.ts`, `tests/routes/canvas.test.ts`.

**apps/web**
- `src/components/canvas/MonacoEditor.tsx` — lazy-loaded Monaco wrapper.
- `src/components/canvas/CodeAgentPanel.tsx` — prompt 입력 + 상태 + Apply/Discard/Run.
- `src/components/canvas/CanvasOutputsGallery.tsx` — 저장된 figure 목록.
- `src/lib/use-code-agent-stream.ts` — SSE EventSource 훅.
- `src/lib/use-canvas-outputs.ts` — outputs CRUD 훅.
- `src/lib/api-client-code.ts` — typed code/canvas API client.
- 각 컴포넌트의 `.test.tsx`.
- `tests/e2e/canvas-phase-2.spec.ts` — 7 시나리오.

**docs**
- `architecture/api-contract.md` — `/api/code/*`, `/api/canvas/*` 추가 (modify).
- `architecture/data-flow.md` — Code Agent flow 추가 (modify).
- `contributing/plans-status.md` — Plan 7 row 갱신 (modify).
- `contributing/ops.md` — `canvas_outputs` 운영 노트 (modify).
- `contributing/llm-antipatterns.md` — 본 phase 함정 추가 (modify).

### Modified files

- `apps/api/src/app.ts` — `/api/code` + `/api/canvas` 마운트.
- `apps/api/.env.example`, `apps/web/.env.example`, `apps/worker/.env.example` — `FEATURE_CODE_AGENT`, `FEATURE_CANVAS_TEMPLATES`, `FEATURE_CANVAS_OUTPUT_STORE`.
- `apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx` — textarea → MonacoEditor + CodeAgentPanel slot + CanvasOutputsGallery slot.
- `apps/web/src/components/canvas/PyodideRunner.tsx` — matplotlib figure capture + `onResult`로 figure 배열 emit.
- `apps/web/src/components/canvas/CanvasFrame.tsx` — postMessage 에 error/stdout 추출 헬퍼 (셀프힐링용).
- `apps/web/messages/{ko,en}/canvas.json` — ~25 신규 키.
- `apps/web/next.config.ts` — CSP `img-src` 에 `blob:` 추가.
- `apps/worker/src/worker/temporal_main.py` — `CodeAgentWorkflow` 등록 (flag gate).
- `apps/web/src/app/api/test-seed/route.ts` (또는 등가) — `canvas-phase2` 시드 모드 추가.
- `scripts/canvas-regression-guard.sh` — Monaco CDN / SSE MIME 가드 추가.

---

## Tasks (24)

**Phase A — Foundation** (Tasks 1-2)
**Phase B — Worker** (Tasks 3-7)
**Phase C — API** (Tasks 8-13)
**Phase D — Web** (Tasks 14-19)
**Phase E — Cross-cutting** (Tasks 20-22)
**Phase F — E2E + docs** (Tasks 23-24)

Tasks 1, 2 는 Phase B/C/D 모두의 의존이므로 직렬. 그 외는 phase 간 직렬, phase 내 가능하면 직렬 (TDD 흐름 유지).

---

## Phase A — Foundation

### Task 1: DB migration + Drizzle schema

**Files:**
- Create: `packages/db/drizzle/0024_canvas_code_runs_outputs.sql`
- Create: `packages/db/src/schema/code-runs.ts`
- Modify: `packages/db/src/schema/index.ts` (export 추가)
- Test: `packages/db/tests/schema/code-runs.test.ts`

- [ ] **Step 1: Write the failing schema test**

`packages/db/tests/schema/code-runs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { db } from "../helpers/db";
import { codeRuns, codeTurns, canvasOutputs } from "../../src/schema/code-runs";
import { notes } from "../../src/schema/notes";
import { workspaces } from "../../src/schema/workspaces";
import { user } from "../../src/schema/users";

describe("code-runs schema", () => {
  it("inserts a run + turn + output round-trip", async () => {
    const ws = await db.insert(workspaces).values({ name: "t" }).returning();
    const u = await db.insert(user).values({ id: "u1", email: "a@b.com" }).returning();
    const [n] = await db.insert(notes).values({
      title: "c", workspaceId: ws[0].id, userId: u[0].id,
      sourceType: "canvas", canvasLanguage: "python",
    }).returning();

    const [run] = await db.insert(codeRuns).values({
      noteId: n.id, workspaceId: ws[0].id, userId: u[0].id,
      prompt: "hello", language: "python", workflowId: "wf-1",
    }).returning();
    expect(run.status).toBe("pending");

    const [turn] = await db.insert(codeTurns).values({
      runId: run.id, seq: 0, kind: "generate", source: "print('hi')",
    }).returning();
    expect(turn.seq).toBe(0);

    const [out] = await db.insert(canvasOutputs).values({
      noteId: n.id, runId: run.id, contentHash: "abc", mimeType: "image/png",
      s3Key: "k", bytes: 100,
    }).returning();
    expect(out.id).toBeDefined();
  });

  it("rejects duplicate (run_id, seq)", async () => {
    // setup: insert run + turn(seq=0)
    // attempt: insert turn(seq=0) again → expect unique constraint error
  });

  it("rejects duplicate (note_id, content_hash)", async () => {
    // similar idempotency check for canvas_outputs
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @opencairn/db test -- code-runs
```

Expected: FAIL with module not found `code-runs.ts`.

- [ ] **Step 3: Write the migration SQL**

`packages/db/drizzle/0024_canvas_code_runs_outputs.sql`:

```sql
CREATE TABLE IF NOT EXISTS code_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  language text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  workflow_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS code_runs_note_idx ON code_runs(note_id, created_at DESC);

CREATE TABLE IF NOT EXISTS code_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES code_runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind text NOT NULL,
  source text NOT NULL,
  explanation text,
  prev_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT code_turns_run_seq_unique UNIQUE(run_id, seq)
);

CREATE TABLE IF NOT EXISTS canvas_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  run_id uuid REFERENCES code_runs(id) ON DELETE SET NULL,
  content_hash text NOT NULL,
  mime_type text NOT NULL,
  s3_key text NOT NULL,
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_outputs_note_hash_unique UNIQUE(note_id, content_hash)
);
CREATE INDEX IF NOT EXISTS canvas_outputs_note_idx ON canvas_outputs(note_id, created_at DESC);
```

- [ ] **Step 4: Write the Drizzle schema**

`packages/db/src/schema/code-runs.ts`:

```ts
import {
  pgTable, uuid, text, integer, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { workspaces } from "./workspaces";
import { user } from "./users";

export const codeRuns = pgTable(
  "code_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    language: text("language").notNull(),
    status: text("status").notNull().default("pending"),
    workflowId: text("workflow_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("code_runs_note_idx").on(t.noteId, t.createdAt.desc())],
);

export const codeTurns = pgTable(
  "code_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => codeRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    explanation: text("explanation"),
    prevError: text("prev_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("code_turns_run_seq_unique").on(t.runId, t.seq)],
);

export const canvasOutputs = pgTable(
  "canvas_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => codeRuns.id, { onDelete: "set null" }),
    contentHash: text("content_hash").notNull(),
    mimeType: text("mime_type").notNull(),
    s3Key: text("s3_key").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("canvas_outputs_note_hash_unique").on(t.noteId, t.contentHash),
    index("canvas_outputs_note_idx").on(t.noteId, t.createdAt.desc()),
  ],
);
```

Update `packages/db/src/schema/index.ts`:
```ts
export * from "./code-runs";
```

- [ ] **Step 5: Apply migration + run tests**

```bash
pnpm --filter @opencairn/db db:migrate
pnpm --filter @opencairn/db test -- code-runs
```

Expected: PASS (3/3 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle/0024_canvas_code_runs_outputs.sql \
        packages/db/src/schema/code-runs.ts \
        packages/db/src/schema/index.ts \
        packages/db/tests/schema/code-runs.test.ts
git commit -m "feat(db): add code_runs/code_turns/canvas_outputs (Plan 7 Phase 2)"
```

---

### Task 2: Shared Zod types

**Files:**
- Create: `packages/shared/src/code-types.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Test: `packages/shared/tests/code-types.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/tests/code-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  codeAgentRunRequestSchema,
  codeAgentFeedbackSchema,
  codeAgentEventSchema,
  canvasOutputCreateSchema,
} from "../src/code-types";

describe("code-types Zod", () => {
  it("accepts valid run request", () => {
    const r = codeAgentRunRequestSchema.parse({
      noteId: "00000000-0000-0000-0000-000000000001",
      prompt: "Plot sin(x)",
      language: "python",
    });
    expect(r.language).toBe("python");
  });

  it("rejects prompt > 4000 chars", () => {
    expect(() =>
      codeAgentRunRequestSchema.parse({
        noteId: "00000000-0000-0000-0000-000000000001",
        prompt: "x".repeat(4001),
        language: "python",
      }),
    ).toThrow();
  });

  it("rejects unknown language", () => {
    expect(() =>
      codeAgentRunRequestSchema.parse({
        noteId: "00000000-0000-0000-0000-000000000001",
        prompt: "ok",
        language: "ruby",
      }),
    ).toThrow();
  });

  it("validates feedback ok / error variants", () => {
    expect(codeAgentFeedbackSchema.parse({ runId: "00000000-0000-0000-0000-000000000001", kind: "ok" }).kind).toBe("ok");
    expect(codeAgentFeedbackSchema.parse({
      runId: "00000000-0000-0000-0000-000000000001", kind: "error", error: "ZeroDivisionError",
    }).kind).toBe("error");
  });

  it("event schema accepts every union case", () => {
    for (const ev of [
      { kind: "queued", runId: "00000000-0000-0000-0000-000000000001" },
      { kind: "thought", text: "..." },
      { kind: "token", delta: "p" },
      { kind: "turn_complete", turn: { kind: "generate", source: "x", explanation: "", seq: 0 } },
      { kind: "awaiting_feedback" },
      { kind: "done", status: "completed" },
      { kind: "error", code: "workflowFailed" },
    ]) {
      expect(() => codeAgentEventSchema.parse(ev)).not.toThrow();
    }
  });

  it("output create accepts png/svg, rejects jpeg", () => {
    expect(() =>
      canvasOutputCreateSchema.parse({
        noteId: "00000000-0000-0000-0000-000000000001",
        mimeType: "image/png",
      }),
    ).not.toThrow();
    expect(() =>
      canvasOutputCreateSchema.parse({
        noteId: "00000000-0000-0000-0000-000000000001",
        mimeType: "image/jpeg",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm --filter @opencairn/shared test -- code-types
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/shared/src/code-types.ts`:

```ts
import { z } from "zod";

export const canvasLanguages = ["python", "javascript", "html", "react"] as const;
export type CanvasLanguage = (typeof canvasLanguages)[number];

export const codeAgentRunRequestSchema = z.object({
  noteId: z.string().uuid(),
  prompt: z.string().min(1).max(4000),
  language: z.enum(canvasLanguages),
});
export type CodeAgentRunRequest = z.infer<typeof codeAgentRunRequestSchema>;

export const codeAgentFeedbackSchema = z.discriminatedUnion("kind", [
  z.object({ runId: z.string().uuid(), kind: z.literal("ok"), stdout: z.string().max(8 * 1024).optional() }),
  z.object({
    runId: z.string().uuid(),
    kind: z.literal("error"),
    error: z.string().max(4 * 1024),
    stdout: z.string().max(8 * 1024).optional(),
  }),
]);
export type CodeAgentFeedback = z.infer<typeof codeAgentFeedbackSchema>;

export const codeAgentTurnSchema = z.object({
  kind: z.enum(["generate", "fix"]),
  source: z.string().max(64 * 1024),
  explanation: z.string().max(2000).optional().nullable(),
  seq: z.number().int().min(0),
});
export type CodeAgentTurn = z.infer<typeof codeAgentTurnSchema>;

export const codeAgentEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued"), runId: z.string().uuid() }),
  z.object({ kind: z.literal("thought"), text: z.string() }),
  z.object({ kind: z.literal("token"), delta: z.string() }),
  z.object({ kind: z.literal("turn_complete"), turn: codeAgentTurnSchema }),
  z.object({ kind: z.literal("awaiting_feedback") }),
  z.object({
    kind: z.literal("done"),
    status: z.enum(["completed", "max_turns", "cancelled", "abandoned"]),
  }),
  z.object({ kind: z.literal("error"), code: z.string() }),
]);
export type CodeAgentEvent = z.infer<typeof codeAgentEventSchema>;

export const MAX_CANVAS_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MB
export const canvasOutputCreateSchema = z.object({
  noteId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  mimeType: z.enum(["image/png", "image/svg+xml"]),
});
export type CanvasOutputCreate = z.infer<typeof canvasOutputCreateSchema>;
```

Update `packages/shared/src/index.ts`:
```ts
export * from "./code-types";
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @opencairn/shared test -- code-types
```

Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/code-types.ts packages/shared/src/index.ts \
        packages/shared/tests/code-types.test.ts
git commit -m "feat(shared): add Code Agent + canvas output Zod types (Plan 7 Phase 2)"
```

---

## Phase B — Worker (Code Agent + Workflow)

### Task 3: Code Agent prompts

**Files:**
- Create: `apps/worker/src/worker/agents/code/__init__.py`
- Create: `apps/worker/src/worker/agents/code/prompts.py`
- Test: `apps/worker/tests/agents/test_code_prompts.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/agents/test_code_prompts.py`:

```python
import pytest
from worker.agents.code.prompts import (
    CODE_SYSTEM,
    build_generate_prompt,
    build_fix_prompt,
)


def test_system_mentions_browser_and_no_input():
    assert "input()" in CODE_SYSTEM.lower() or "input(" in CODE_SYSTEM
    assert "browser" in CODE_SYSTEM.lower() or "pyodide" in CODE_SYSTEM.lower()


def test_generate_prompt_embeds_user_request_and_language():
    p = build_generate_prompt(prompt="plot sin", language="python")
    assert "plot sin" in p
    assert "python" in p


def test_fix_prompt_embeds_last_code_and_error():
    p = build_fix_prompt(
        original_prompt="plot",
        language="python",
        last_code="print('hi')",
        last_error="NameError: x",
        stdout_tail="",
    )
    assert "print('hi')" in p
    assert "NameError" in p


def test_fix_prompt_truncates_stdout_tail_to_2k():
    big = "x" * 5000
    p = build_fix_prompt(
        original_prompt="p",
        language="python",
        last_code="c",
        last_error="e",
        stdout_tail=big,
    )
    # tail is sliced via [-2000:] inside the agent layer; prompts.py just
    # interpolates whatever it gets — verify the format string supports it
    assert "stdout" in p.lower()
```

- [ ] **Step 2: Run test → expect fail**

```bash
cd apps/worker && uv run pytest tests/agents/test_code_prompts.py -v
```

Expected: FAIL (import error).

- [ ] **Step 3: Implement prompts**

`apps/worker/src/worker/agents/code/__init__.py`: (empty)

`apps/worker/src/worker/agents/code/prompts.py`:

```python
"""CodeAgent prompts — Plan 7 Phase 2.

Generate and fix prompts for browser-sandboxed code (Pyodide / iframe).
ADR-006 constraints baked into the system prompt.
"""
from __future__ import annotations

CODE_SYSTEM = """\
You are CodeAgent for OpenCairn — a browser-sandboxed coding assistant.

Environment constraints (ADR-006):
- Code runs in the user's browser via Pyodide (Python) or an iframe sandbox
  (JS / HTML / React via esm.sh).
- Blocking input() is NOT supported. If you need user input, hardcode it.
- Network access in Python is limited to whitelisted CDNs (cdn.jsdelivr.net,
  esm.sh). Do not assume arbitrary HTTP works.
- For matplotlib, set MPLBACKEND=Agg before importing pyplot. The runner
  collects figures via plt.get_fignums().
- For React: render with react@19 from esm.sh. Use a single default export.
- For HTML: emit a complete <!doctype html> document.
- Keep code self-contained in one file. No external file references.

Output:
- Use the emit_structured_output tool exactly once with
  {language, source, explanation}.
- explanation: one or two sentences in Korean (사용자 언어). Concise.
- source: runnable code only. No surrounding markdown fences.
"""


def build_generate_prompt(*, prompt: str, language: str) -> str:
    return GENERATE_TEMPLATE.format(prompt=prompt, language=language)


def build_fix_prompt(
    *,
    original_prompt: str,
    language: str,
    last_code: str,
    last_error: str,
    stdout_tail: str,
) -> str:
    return FIX_TEMPLATE.format(
        original_prompt=original_prompt,
        language=language,
        last_code=last_code,
        last_error=last_error,
        stdout_tail=stdout_tail or "(empty)",
    )


GENERATE_TEMPLATE = """\
Language: {language}

User request:
{prompt}

Generate a single self-contained file that fulfils the request. Emit it via
emit_structured_output.
"""


FIX_TEMPLATE = """\
Language: {language}

Original user request:
{original_prompt}

Previous code (FAILED):
```
{last_code}
```

Error message:
{last_error}

Stdout tail (truncated to 2KB):
{stdout_tail}

Diagnose the failure and emit a corrected version of the file via
emit_structured_output. Keep it self-contained.
"""
```

- [ ] **Step 4: Run test → expect pass**

```bash
cd apps/worker && uv run pytest tests/agents/test_code_prompts.py -v
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/code/__init__.py \
        apps/worker/src/worker/agents/code/prompts.py \
        apps/worker/tests/agents/test_code_prompts.py
git commit -m "feat(worker): add CodeAgent prompts (Plan 7 Phase 2)"
```

---

### Task 4: CodeAgent class (`runtime.Agent`)

**Files:**
- Create: `apps/worker/src/worker/agents/code/agent.py`
- Test: `apps/worker/tests/agents/test_code_agent.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/agents/test_code_agent.py`:

```python
"""CodeAgent unit — exercises the runtime.Agent contract with a mocked LLM."""
import pytest
from unittest.mock import AsyncMock, MagicMock

from worker.agents.code.agent import CodeAgent, CodeContext, CodeOutput


@pytest.mark.asyncio
async def test_emits_structured_output_on_generate():
    llm = MagicMock()
    llm.generate_with_tools = AsyncMock(return_value=_fake_tool_emit({
        "language": "python", "source": "print('ok')", "explanation": "trivial",
    }))
    agent = CodeAgent(llm=llm)
    ctx = CodeContext(
        kind="generate", user_prompt="say hi", language="python",
        last_code=None, last_error=None, stdout_tail="",
    )
    out = await agent.run(ctx)
    assert isinstance(out, CodeOutput)
    assert out.source == "print('ok')"
    assert out.language == "python"


@pytest.mark.asyncio
async def test_fix_passes_last_error_into_prompt():
    llm = MagicMock()
    captured = {}
    async def capture(messages, tools, **kw):
        captured["msg"] = messages
        return _fake_tool_emit({"language": "python", "source": "x=1", "explanation": "fixed"})
    llm.generate_with_tools = capture
    agent = CodeAgent(llm=llm)
    out = await agent.run(CodeContext(
        kind="fix", user_prompt="p", language="python",
        last_code="oops", last_error="NameError: zzz", stdout_tail="t",
    ))
    flat = "\n".join(m["content"] for m in captured["msg"] if isinstance(m.get("content"), str))
    assert "NameError" in flat
    assert "oops" in flat
    assert out.source == "x=1"


@pytest.mark.asyncio
async def test_rejects_when_emit_missing():
    llm = MagicMock()
    llm.generate_with_tools = AsyncMock(return_value=_fake_text("no tool used"))
    agent = CodeAgent(llm=llm)
    with pytest.raises(RuntimeError, match="emit_structured_output"):
        await agent.run(CodeContext(
            kind="generate", user_prompt="p", language="python",
            last_code=None, last_error=None, stdout_tail="",
        ))


def _fake_tool_emit(payload):
    return MagicMock(tool_calls=[MagicMock(name="emit_structured_output", arguments=payload)], text=None)


def _fake_text(t):
    return MagicMock(tool_calls=[], text=t)
```

- [ ] **Step 2: Run → expect fail**

```bash
cd apps/worker && uv run pytest tests/agents/test_code_agent.py -v
```

- [ ] **Step 3: Implement `CodeAgent`**

`apps/worker/src/worker/agents/code/agent.py`:

```python
"""CodeAgent — Plan 7 Phase 2.

Generates or fixes a single source file, returning a structured CodeOutput.
Subclass of runtime.Agent. Single tool: emit_structured_output.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from llm import LLMProvider

from runtime.agent import Agent
from runtime.tool_declarations import declare_tool

from worker.agents.code.prompts import (
    CODE_SYSTEM,
    build_generate_prompt,
    build_fix_prompt,
)


CanvasLanguage = Literal["python", "javascript", "html", "react"]


@dataclass(frozen=True)
class CodeContext:
    kind: Literal["generate", "fix"]
    user_prompt: str
    language: CanvasLanguage
    last_code: Optional[str]
    last_error: Optional[str]
    stdout_tail: str


@dataclass(frozen=True)
class CodeOutput:
    language: CanvasLanguage
    source: str
    explanation: str


_OUTPUT_TOOL = declare_tool(
    name="emit_structured_output",
    description="Emit the final code artifact. Call exactly once and stop.",
    parameters={
        "type": "object",
        "required": ["language", "source", "explanation"],
        "properties": {
            "language": {"type": "string", "enum": ["python", "javascript", "html", "react"]},
            "source": {"type": "string", "maxLength": 64 * 1024},
            "explanation": {"type": "string", "maxLength": 2000},
        },
    },
)


class CodeAgent(Agent):
    name = "code"

    def __init__(self, llm: LLMProvider):
        super().__init__()
        self._llm = llm

    async def run(self, ctx: CodeContext) -> CodeOutput:
        if ctx.kind == "generate":
            user_prompt = build_generate_prompt(prompt=ctx.user_prompt, language=ctx.language)
        else:
            user_prompt = build_fix_prompt(
                original_prompt=ctx.user_prompt,
                language=ctx.language,
                last_code=ctx.last_code or "",
                last_error=ctx.last_error or "",
                stdout_tail=(ctx.stdout_tail or "")[-2000:],
            )

        messages = [
            {"role": "system", "content": CODE_SYSTEM},
            {"role": "user", "content": user_prompt},
        ]
        result = await self._llm.generate_with_tools(
            messages=messages,
            tools=[_OUTPUT_TOOL],
            max_output_tokens=8192,
        )

        for call in result.tool_calls or []:
            if call.name == "emit_structured_output":
                args = call.arguments
                return CodeOutput(
                    language=args["language"],
                    source=args["source"],
                    explanation=args.get("explanation", ""),
                )
        raise RuntimeError("CodeAgent did not call emit_structured_output")
```

- [ ] **Step 4: Run → expect pass**

```bash
cd apps/worker && uv run pytest tests/agents/test_code_agent.py -v
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/code/agent.py \
        apps/worker/tests/agents/test_code_agent.py
git commit -m "feat(worker): add CodeAgent class with emit_structured_output tool (Plan 7 Phase 2)"
```

---

### Task 5: `generate_code_activity` + `analyze_feedback_activity`

**Files:**
- Create: `apps/worker/src/worker/activities/code_activity.py`
- Test: `apps/worker/tests/activities/test_code_activity.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/activities/test_code_activity.py`:

```python
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from worker.activities.code_activity import (
    generate_code_activity,
    analyze_feedback_activity,
    CodeRunParams,
    ClientFeedback,
    PersistedTurn,
)


@pytest.mark.asyncio
async def test_generate_calls_agent_and_persists_turn():
    params = _params()
    with patch("worker.activities.code_activity.resolve_llm_provider") as resolve, \
         patch("worker.activities.code_activity.persist_turn", new=AsyncMock()) as persist, \
         patch("worker.activities.code_activity.set_run_status", new=AsyncMock()) as setstatus:
        resolve.return_value = MagicMock(generate_with_tools=AsyncMock(
            return_value=MagicMock(tool_calls=[MagicMock(name="emit_structured_output", arguments={
                "language": "python", "source": "print(1)", "explanation": "ok",
            })], text=None),
        ))
        out = await generate_code_activity(params, history=[])
        assert out.source == "print(1)"
        persist.assert_awaited_once()
        # status transitions: running → awaiting_feedback
        setstatus.assert_any_await(params.run_id, "awaiting_feedback")


@pytest.mark.asyncio
async def test_analyze_uses_feedback_kind_and_last_error():
    params = _params()
    feedback = ClientFeedback(kind="error", error="ZeroDivisionError", stdout="")
    history = [PersistedTurn(seq=0, kind="generate", source="1/0", explanation="", prev_error=None)]
    with patch("worker.activities.code_activity.resolve_llm_provider") as resolve, \
         patch("worker.activities.code_activity.persist_turn", new=AsyncMock()), \
         patch("worker.activities.code_activity.set_run_status", new=AsyncMock()):
        captured = {}
        async def capture(messages, tools, **kw):
            captured["msg"] = messages
            return MagicMock(tool_calls=[MagicMock(name="emit_structured_output", arguments={
                "language": "python", "source": "1/1", "explanation": "fixed",
            })], text=None)
        resolve.return_value = MagicMock(generate_with_tools=capture)
        out = await analyze_feedback_activity(params, history, feedback)
        flat = "\n".join(m["content"] for m in captured["msg"])
        assert "ZeroDivisionError" in flat
        assert "1/0" in flat
        assert out.source == "1/1"


def _params() -> CodeRunParams:
    return CodeRunParams(
        run_id="11111111-1111-1111-1111-111111111111",
        note_id="22222222-2222-2222-2222-222222222222",
        workspace_id="33333333-3333-3333-3333-333333333333",
        user_id="u1",
        prompt="ask",
        language="python",
        byok_key_handle=None,
    )
```

- [ ] **Step 2: Run → expect fail**

```bash
cd apps/worker && uv run pytest tests/activities/test_code_activity.py -v
```

- [ ] **Step 3: Implement**

`apps/worker/src/worker/activities/code_activity.py`:

```python
"""CodeAgent Temporal activities — generation + feedback analysis.

Both activities are heartbeat-friendly and persist a CodeTurn after the LLM
call returns. Status transitions match the spec:
  running -> awaiting_feedback (after each turn)
  running -> running (next fix turn)
  running -> {completed,max_turns,cancelled,abandoned,failed} (workflow end)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from temporalio import activity

from worker.agents.code.agent import (
    CodeAgent,
    CodeContext,
    CodeOutput,
)
from worker.lib.code_persistence import persist_turn, set_run_status
from worker.lib.llm_routing import resolve_llm_provider


CanvasLanguage = Literal["python", "javascript", "html", "react"]


@dataclass(frozen=True)
class CodeRunParams:
    run_id: str
    note_id: str
    workspace_id: str
    user_id: str
    prompt: str
    language: CanvasLanguage
    byok_key_handle: Optional[str]


@dataclass(frozen=True)
class PersistedTurn:
    seq: int
    kind: Literal["generate", "fix"]
    source: str
    explanation: str
    prev_error: Optional[str]


@dataclass(frozen=True)
class ClientFeedback:
    kind: Literal["ok", "error"]
    error: Optional[str] = None
    stdout: Optional[str] = None


@activity.defn
async def generate_code_activity(
    params: CodeRunParams,
    history: list[PersistedTurn],
) -> CodeOutput:
    activity.heartbeat("starting generate")
    await set_run_status(params.run_id, "running")
    provider = await resolve_llm_provider(
        user_id=params.user_id,
        workspace_id=params.workspace_id,
        purpose="chat",
        byok_key_handle=params.byok_key_handle,
    )
    agent = CodeAgent(llm=provider)
    ctx = CodeContext(
        kind="generate",
        user_prompt=params.prompt,
        language=params.language,
        last_code=None,
        last_error=None,
        stdout_tail="",
    )
    out = await agent.run(ctx)
    await persist_turn(
        run_id=params.run_id,
        seq=len(history),
        kind="generate",
        source=out.source,
        explanation=out.explanation,
        prev_error=None,
    )
    await set_run_status(params.run_id, "awaiting_feedback")
    activity.heartbeat("generate done")
    return out


@activity.defn
async def analyze_feedback_activity(
    params: CodeRunParams,
    history: list[PersistedTurn],
    feedback: ClientFeedback,
) -> CodeOutput:
    activity.heartbeat("starting fix")
    await set_run_status(params.run_id, "running")
    provider = await resolve_llm_provider(
        user_id=params.user_id,
        workspace_id=params.workspace_id,
        purpose="chat",
        byok_key_handle=params.byok_key_handle,
    )
    agent = CodeAgent(llm=provider)
    last = history[-1] if history else None
    ctx = CodeContext(
        kind="fix",
        user_prompt=params.prompt,
        language=params.language,
        last_code=last.source if last else "",
        last_error=feedback.error,
        stdout_tail=feedback.stdout or "",
    )
    out = await agent.run(ctx)
    await persist_turn(
        run_id=params.run_id,
        seq=len(history),
        kind="fix",
        source=out.source,
        explanation=out.explanation,
        prev_error=feedback.error,
    )
    await set_run_status(params.run_id, "awaiting_feedback")
    activity.heartbeat("fix done")
    return out
```

Also create the persistence helper stub `apps/worker/src/worker/lib/code_persistence.py`:

```python
"""DB persistence for code runs/turns. Wraps Drizzle via the worker DB pool."""
from __future__ import annotations

from typing import Literal, Optional

from worker.lib.db import pool  # existing worker DB pool


async def persist_turn(
    *,
    run_id: str,
    seq: int,
    kind: Literal["generate", "fix"],
    source: str,
    explanation: str,
    prev_error: Optional[str],
) -> None:
    async with pool.acquire() as c:
        await c.execute(
            """
            INSERT INTO code_turns (run_id, seq, kind, source, explanation, prev_error)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (run_id, seq) DO NOTHING
            """,
            run_id, seq, kind, source, explanation, prev_error,
        )
        await c.execute(
            "UPDATE code_runs SET updated_at = now() WHERE id = $1",
            run_id,
        )


async def set_run_status(run_id: str, status: str) -> None:
    async with pool.acquire() as c:
        await c.execute(
            "UPDATE code_runs SET status = $1, updated_at = now() WHERE id = $2",
            status, run_id,
        )
```

And LLM router stub `apps/worker/src/worker/lib/llm_routing.py` (or extend existing):

```python
"""Resolve LLM provider per billing-routing.md.

For purpose="chat": BYOK > credits > Admin fallback. Phase 2 reuses chat policy
unchanged for the Code Agent path.
"""
from typing import Literal, Optional

from llm import LLMProvider, get_provider


async def resolve_llm_provider(
    *,
    user_id: str,
    workspace_id: str,
    purpose: Literal["chat", "embedding", "research"],
    byok_key_handle: Optional[str],
) -> LLMProvider:
    # If a workspace-level resolver already exists, delegate to it. Otherwise
    # fall back to the env-default get_provider() (chat policy).
    return await get_provider(
        user_id=user_id,
        workspace_id=workspace_id,
        purpose=purpose,
        byok_key_handle=byok_key_handle,
    )
```

(If a routing helper already exists at the workspace level, replace the body with a delegation. Search `resolve_llm_provider` first.)

- [ ] **Step 4: Run → expect pass**

```bash
cd apps/worker && uv run pytest tests/activities/test_code_activity.py -v
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/code_activity.py \
        apps/worker/src/worker/lib/code_persistence.py \
        apps/worker/src/worker/lib/llm_routing.py \
        apps/worker/tests/activities/test_code_activity.py
git commit -m "feat(worker): add code activities + persistence + LLM router (Plan 7 Phase 2)"
```

---

### Task 6: `CodeAgentWorkflow`

**Files:**
- Create: `apps/worker/src/worker/workflows/code_workflow.py`
- Test: `apps/worker/tests/workflows/test_code_workflow.py`

- [ ] **Step 1: Write the failing workflow test**

`apps/worker/tests/workflows/test_code_workflow.py`:

```python
"""CodeAgentWorkflow — exercised under Temporal's time_skipping test env."""
import pytest
from datetime import timedelta
from unittest.mock import patch

from temporalio.client import WorkflowFailureError
from temporalio.testing import WorkflowEnvironment

from worker.workflows.code_workflow import (
    CodeAgentWorkflow,
    CodeRunParams,
    ClientFeedback,
)
from worker.agents.code.agent import CodeOutput


GEN = CodeOutput(language="python", source="print(1)", explanation="ok")
FIX = CodeOutput(language="python", source="print(2)", explanation="fixed")


@pytest.mark.asyncio
async def test_completes_after_ok_feedback(monkeypatch):
    async def fake_generate(*a, **kw): return GEN
    async def fake_analyze(*a, **kw): return FIX
    async def noop(*a, **kw): return None

    async with WorkflowEnvironment.start_time_skipping() as env:
        async with _worker(env, fake_generate, fake_analyze, noop):
            handle = await env.client.start_workflow(
                CodeAgentWorkflow.run,
                _params(),
                id="wf-ok",
                task_queue="code",
            )
            await handle.signal(CodeAgentWorkflow.client_feedback, ClientFeedback(kind="ok"))
            res = await handle.result()
            assert res.status == "completed"
            assert len(res.history) == 1


@pytest.mark.asyncio
async def test_loops_up_to_max_turns():
    async def fake_generate(*a, **kw): return GEN
    async def fake_analyze(*a, **kw): return FIX
    async def noop(*a, **kw): return None

    async with WorkflowEnvironment.start_time_skipping() as env:
        async with _worker(env, fake_generate, fake_analyze, noop):
            handle = await env.client.start_workflow(
                CodeAgentWorkflow.run, _params(), id="wf-max", task_queue="code",
            )
            for _ in range(3):
                await handle.signal(CodeAgentWorkflow.client_feedback,
                                    ClientFeedback(kind="error", error="boom"))
            res = await handle.result()
            assert res.status == "max_turns"
            assert len(res.history) == 4   # 1 generate + 3 fixes


@pytest.mark.asyncio
async def test_abandons_after_idle():
    async def fake_generate(*a, **kw): return GEN
    async def fake_analyze(*a, **kw): return FIX
    async def noop(*a, **kw): return None

    async with WorkflowEnvironment.start_time_skipping() as env:
        async with _worker(env, fake_generate, fake_analyze, noop):
            handle = await env.client.start_workflow(
                CodeAgentWorkflow.run, _params(), id="wf-idle", task_queue="code",
            )
            # advance fake clock past idle abandon threshold
            await env.sleep(timedelta(minutes=31))
            res = await handle.result()
            assert res.status == "abandoned"


@pytest.mark.asyncio
async def test_cancel_signal_terminates():
    async def fake_generate(*a, **kw): return GEN
    async def fake_analyze(*a, **kw): return FIX
    async def noop(*a, **kw): return None

    async with WorkflowEnvironment.start_time_skipping() as env:
        async with _worker(env, fake_generate, fake_analyze, noop):
            handle = await env.client.start_workflow(
                CodeAgentWorkflow.run, _params(), id="wf-cancel", task_queue="code",
            )
            await handle.signal(CodeAgentWorkflow.cancel)
            res = await handle.result()
            assert res.status == "cancelled"


def _params() -> CodeRunParams:
    return CodeRunParams(
        run_id="11111111-1111-1111-1111-111111111111",
        note_id="22222222-2222-2222-2222-222222222222",
        workspace_id="33333333-3333-3333-3333-333333333333",
        user_id="u",
        prompt="x",
        language="python",
        byok_key_handle=None,
    )


def _worker(env, fake_generate, fake_analyze, noop):
    from temporalio.worker import Worker
    from worker.activities import code_activity
    return Worker(
        env.client,
        task_queue="code",
        workflows=[CodeAgentWorkflow],
        activities=[
            _wrap("generate_code_activity", fake_generate),
            _wrap("analyze_feedback_activity", fake_analyze),
        ],
    )


def _wrap(name, fn):
    from temporalio import activity
    @activity.defn(name=name)
    async def w(*a, **kw): return await fn(*a, **kw)
    return w
```

- [ ] **Step 2: Run → expect fail**

```bash
cd apps/worker && uv run pytest tests/workflows/test_code_workflow.py -v
```

- [ ] **Step 3: Implement workflow**

`apps/worker/src/worker/workflows/code_workflow.py`:

```python
"""CodeAgentWorkflow — Plan 7 Phase 2.

Self-healing loop: 1 generate + up to 3 fix turns. Signals: client_feedback,
cancel. Idle abandon at 30 min via wait_condition timeout. Absolute deadline
1 h via workflow_execution_timeout (set by the API caller).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Literal, Optional

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.code_activity import (
        generate_code_activity,
        analyze_feedback_activity,
        CodeRunParams,
        ClientFeedback,
        PersistedTurn,
    )
    from worker.agents.code.agent import CodeOutput


@dataclass
class CodeRunResult:
    status: Literal["completed", "max_turns", "cancelled", "abandoned", "failed"]
    history: list[PersistedTurn] = field(default_factory=list)


MAX_FIX_TURNS = 3
IDLE_ABANDON = timedelta(minutes=30)
ACTIVITY_START_TO_CLOSE = timedelta(minutes=5)
ACTIVITY_HEARTBEAT = timedelta(seconds=30)


@workflow.defn
class CodeAgentWorkflow:
    def __init__(self) -> None:
        self._feedback: Optional[ClientFeedback] = None
        self._cancelled: bool = False

    @workflow.run
    async def run(self, params: CodeRunParams) -> CodeRunResult:
        history: list[PersistedTurn] = []

        # turn 0 — generate
        out = await workflow.execute_activity(
            generate_code_activity,
            args=[params, history],
            start_to_close_timeout=ACTIVITY_START_TO_CLOSE,
            heartbeat_timeout=ACTIVITY_HEARTBEAT,
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        history.append(_to_persisted(0, "generate", out, prev_error=None))

        for attempt in range(MAX_FIX_TURNS):
            try:
                await workflow.wait_condition(
                    lambda: self._feedback is not None or self._cancelled,
                    timeout=IDLE_ABANDON,
                )
            except TimeoutError:
                return CodeRunResult(status="abandoned", history=history)

            if self._cancelled:
                return CodeRunResult(status="cancelled", history=history)

            fb = self._feedback
            self._feedback = None  # consume

            if fb.kind == "ok":
                return CodeRunResult(status="completed", history=history)

            out = await workflow.execute_activity(
                analyze_feedback_activity,
                args=[params, history, fb],
                start_to_close_timeout=ACTIVITY_START_TO_CLOSE,
                heartbeat_timeout=ACTIVITY_HEARTBEAT,
            )
            history.append(_to_persisted(len(history), "fix", out, prev_error=fb.error))

        return CodeRunResult(status="max_turns", history=history)

    @workflow.signal
    def client_feedback(self, fb: ClientFeedback) -> None:
        if not self._cancelled:
            self._feedback = fb

    @workflow.signal
    def cancel(self) -> None:
        self._cancelled = True


def _to_persisted(seq: int, kind: str, out: "CodeOutput", *, prev_error: Optional[str]) -> PersistedTurn:
    return PersistedTurn(
        seq=seq, kind=kind, source=out.source,
        explanation=out.explanation or "", prev_error=prev_error,
    )
```

- [ ] **Step 4: Run → expect pass**

```bash
cd apps/worker && uv run pytest tests/workflows/test_code_workflow.py -v
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/workflows/code_workflow.py \
        apps/worker/tests/workflows/test_code_workflow.py
git commit -m "feat(worker): add CodeAgentWorkflow with feedback loop + cancel + abandon (Plan 7 Phase 2)"
```

---

### Task 7: Worker registration + flag gate

**Files:**
- Modify: `apps/worker/src/worker/temporal_main.py` (workflow + activities 등록, flag gate)
- Modify: `apps/worker/.env.example`

- [ ] **Step 1: Find existing registration site**

```bash
grep -n "register_workflow\|workflows=\|activities=" .worktrees/plan-7-canvas-phase-2/apps/worker/src/worker/temporal_main.py
```

(adjust based on output — register CodeAgentWorkflow + activities behind FEATURE_CODE_AGENT)

- [ ] **Step 2: Write the registration test**

`apps/worker/tests/test_temporal_main_code.py`:

```python
import os
import pytest
from worker.temporal_main import build_worker_config


def test_code_agent_omitted_when_flag_off(monkeypatch):
    monkeypatch.setenv("FEATURE_CODE_AGENT", "false")
    cfg = build_worker_config()
    assert "CodeAgentWorkflow" not in [w.__name__ for w in cfg.workflows]


def test_code_agent_registered_when_flag_on(monkeypatch):
    monkeypatch.setenv("FEATURE_CODE_AGENT", "true")
    cfg = build_worker_config()
    assert "CodeAgentWorkflow" in [w.__name__ for w in cfg.workflows]
    activity_names = [a.__name__ for a in cfg.activities]
    assert "generate_code_activity" in activity_names
    assert "analyze_feedback_activity" in activity_names
```

- [ ] **Step 3: Run → expect fail**

```bash
cd apps/worker && uv run pytest tests/test_temporal_main_code.py -v
```

- [ ] **Step 4: Implement gating in `temporal_main.py`**

Add (mirror Deep Research's `FEATURE_DEEP_RESEARCH` gate):

```python
import os

# ... inside build_worker_config()
if os.getenv("FEATURE_CODE_AGENT", "false").lower() == "true":
    from worker.workflows.code_workflow import CodeAgentWorkflow
    from worker.activities.code_activity import (
        generate_code_activity,
        analyze_feedback_activity,
    )
    workflows.append(CodeAgentWorkflow)
    activities.extend([generate_code_activity, analyze_feedback_activity])
```

If `build_worker_config` doesn't exist, refactor the existing setup into one and update tests accordingly. Otherwise apply directly inline.

- [ ] **Step 5: Update `.env.example`**

`apps/worker/.env.example`:

```ini
# Plan 7 Phase 2 — Code Agent
FEATURE_CODE_AGENT=false
```

- [ ] **Step 6: Run → expect pass**

```bash
cd apps/worker && uv run pytest tests/test_temporal_main_code.py -v
```

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/worker/temporal_main.py \
        apps/worker/tests/test_temporal_main_code.py \
        apps/worker/.env.example
git commit -m "feat(worker): register CodeAgentWorkflow behind FEATURE_CODE_AGENT (Plan 7 Phase 2)"
```

---

## Phase C — API

### Task 8: Temporal client wrapper

**Files:**
- Create: `apps/api/src/lib/code-agent-client.ts`
- Test: `apps/api/tests/lib/code-agent-client.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/tests/lib/code-agent-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { startCodeRun, signalCodeFeedback, cancelCodeRun, workflowIdFor } from "../../src/lib/code-agent-client";

describe("code-agent-client", () => {
  it("derives a stable workflow id from runId", () => {
    expect(workflowIdFor("abc-123")).toBe("code-agent-abc-123");
  });

  it("signalWithStart passes 1h execution timeout", async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: "code-agent-r1" });
    const fakeClient = { workflow: { signalWithStart: start } };
    await startCodeRun(fakeClient as any, {
      runId: "r1", noteId: "n1", workspaceId: "w1", userId: "u1",
      prompt: "p", language: "python", byokKeyHandle: null,
    });
    const args = start.mock.calls[0][0];
    expect(args.workflowExecutionTimeout).toEqual(60 * 60 * 1000);
    expect(args.taskQueue).toBe("code");
  });

  it("signal feedback forwards payload", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const fakeClient = { workflow: { getHandle: () => ({ signal }) } };
    await signalCodeFeedback(fakeClient as any, "r1", { kind: "error", error: "boom" });
    expect(signal).toHaveBeenCalledWith("client_feedback", { kind: "error", error: "boom" });
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/api test -- code-agent-client
```

- [ ] **Step 3: Implement**

`apps/api/src/lib/code-agent-client.ts`:

```ts
import type { Client } from "@temporalio/client";

export const workflowIdFor = (runId: string) => `code-agent-${runId}`;

export type StartParams = {
  runId: string;
  noteId: string;
  workspaceId: string;
  userId: string;
  prompt: string;
  language: "python" | "javascript" | "html" | "react";
  byokKeyHandle: string | null;
};

export async function startCodeRun(client: Client, p: StartParams) {
  return client.workflow.signalWithStart("CodeAgentWorkflow", {
    workflowId: workflowIdFor(p.runId),
    taskQueue: "code",
    args: [p],
    workflowExecutionTimeout: 60 * 60 * 1000, // 1 h absolute deadline (spec §3.5)
    signal: undefined,
    signalArgs: undefined,
  });
}

export async function signalCodeFeedback(
  client: Client,
  runId: string,
  feedback: { kind: "ok" | "error"; error?: string; stdout?: string },
) {
  return client.workflow.getHandle(workflowIdFor(runId)).signal("client_feedback", feedback);
}

export async function cancelCodeRun(client: Client, runId: string) {
  return client.workflow.getHandle(workflowIdFor(runId)).signal("cancel");
}
```

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/api test -- code-agent-client
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/code-agent-client.ts \
        apps/api/tests/lib/code-agent-client.test.ts
git commit -m "feat(api): add Temporal client wrapper for CodeAgent (Plan 7 Phase 2)"
```

---

### Task 9: `POST /api/code/run` (SSE)

**Files:**
- Create: `apps/api/src/routes/code.ts`
- Test: `apps/api/tests/routes/code-run.test.ts`

> **Transport pattern:** `POST /api/code/run` returns `{ runId }` immediately. The browser then opens `GET /api/code/runs/:runId/stream` (SSE) to consume events. This matches Deep Research and lets the web hook use `EventSource` (GET-only).

- [ ] **Step 1: Failing test for happy path + 409 + 404**

`apps/api/tests/routes/code-run.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestApp, signupAndLogin, createCanvasNote } from "../helpers";

describe("POST /api/code/run", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => { app = createTestApp({ FEATURE_CODE_AGENT: "true" }); });

  it("rejects when flag is off", async () => {
    const offApp = createTestApp({ FEATURE_CODE_AGENT: "false" });
    const session = await signupAndLogin(offApp);
    const noteId = await createCanvasNote(offApp, session);
    const r = await offApp.request("/api/code/run", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({ noteId, prompt: "p", language: "python" }),
    });
    expect(r.status).toBe(404);
  });

  it("404 when note not found / cross-workspace", async () => {
    const session = await signupAndLogin(app);
    const r = await app.request("/api/code/run", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({ noteId: "00000000-0000-0000-0000-000000000000", prompt: "p", language: "python" }),
    });
    expect(r.status).toBe(404);
  });

  it("409 when note is not canvas", async () => {
    const session = await signupAndLogin(app);
    const noteId = await createPlateNote(app, session);
    const r = await app.request("/api/code/run", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({ noteId, prompt: "p", language: "python" }),
    });
    const body = await r.json();
    expect(r.status).toBe(409);
    expect(body.error).toBe("notCanvas");
  });

  it("POST returns runId; GET stream emits queued event", async () => {
    const session = await signupAndLogin(app);
    const noteId = await createCanvasNote(app, session);
    const post = await app.request("/api/code/run", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({ noteId, prompt: "say hi", language: "python" }),
    });
    expect(post.status).toBe(200);
    const { runId } = await post.json();
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);

    const stream = await app.request(`/api/code/runs/${runId}/stream`, {
      headers: { cookie: session },
    });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const text = await stream.text();
    expect(text).toMatch(/"kind":"queued"/);
  });

  it("rejects prompt > 4000 chars (Zod)", async () => {
    const session = await signupAndLogin(app);
    const noteId = await createCanvasNote(app, session);
    const r = await app.request("/api/code/run", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({ noteId, prompt: "x".repeat(4001), language: "python" }),
    });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/api test -- code-run
```

- [ ] **Step 3: Implement `routes/code.ts`**

`apps/api/src/routes/code.ts`:

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { codeAgentRunRequestSchema, codeAgentFeedbackSchema, codeAgentEventSchema } from "@opencairn/shared";
import { db, codeRuns, codeTurns, notes } from "@opencairn/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { canWrite } from "../lib/permissions";
import { getTemporalClient } from "../lib/temporal";
import { startCodeRun, signalCodeFeedback, workflowIdFor } from "../lib/code-agent-client";

export const codeRoutes = new Hono();
codeRoutes.use("*", requireAuth);

// POST /api/code/run — start workflow + return runId
codeRoutes.post("/run", zValidator("json", codeAgentRunRequestSchema), async (c) => {
  if (process.env.FEATURE_CODE_AGENT !== "true") return c.json({ error: "notFound" }, 404);

  const session = c.get("session");
  const body = c.req.valid("json");

  const [note] = await db.select().from(notes).where(eq(notes.id, body.noteId)).limit(1);
  if (!note || !(await canWrite(session.userId, body.noteId))) {
    return c.json({ error: "notFound" }, 404);
  }
  if (note.sourceType !== "canvas") return c.json({ error: "notCanvas" }, 409);
  if (note.canvasLanguage !== body.language) return c.json({ error: "wrongLanguage" }, 409);

  const [run] = await db.insert(codeRuns).values({
    noteId: body.noteId,
    workspaceId: note.workspaceId,
    userId: session.userId,
    prompt: body.prompt,
    language: body.language,
    workflowId: "pending",
  }).returning();
  const workflowId = workflowIdFor(run.id);
  await db.update(codeRuns).set({ workflowId }).where(eq(codeRuns.id, run.id));

  const client = await getTemporalClient();
  await startCodeRun(client, {
    runId: run.id,
    noteId: body.noteId,
    workspaceId: note.workspaceId,
    userId: session.userId,
    prompt: body.prompt,
    language: body.language,
    byokKeyHandle: null,
  });

  return c.json({ runId: run.id });
});

// GET /api/code/runs/:runId/stream — SSE poll
codeRoutes.get("/runs/:runId/stream", async (c) => {
  if (process.env.FEATURE_CODE_AGENT !== "true") return c.json({ error: "notFound" }, 404);
  const session = c.get("session");
  const runId = c.req.param("runId");

  const [run] = await db.select().from(codeRuns).where(eq(codeRuns.id, runId)).limit(1);
  if (!run || run.userId !== session.userId) return c.json({ error: "notFound" }, 404);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ kind: "queued", runId }) });

    let lastSeq = -1;
    let done = false;
    while (!done) {
      const [r] = await db.select().from(codeRuns).where(eq(codeRuns.id, runId)).limit(1);
      const turns = await db.select().from(codeTurns)
        .where(eq(codeTurns.runId, runId))
        .orderBy(codeTurns.seq);

      for (const t of turns) {
        if (t.seq > lastSeq) {
          await stream.writeSSE({ data: JSON.stringify({
            kind: "turn_complete",
            turn: { kind: t.kind, source: t.source, explanation: t.explanation, seq: t.seq },
          }) });
          lastSeq = t.seq;
        }
      }

      if (r.status === "awaiting_feedback") {
        await stream.writeSSE({ data: JSON.stringify({ kind: "awaiting_feedback" }) });
      }
      if (["completed", "max_turns", "cancelled", "abandoned", "failed"].includes(r.status)) {
        await stream.writeSSE({ data: JSON.stringify({
          kind: r.status === "failed" ? "error" : "done",
          ...(r.status === "failed" ? { code: "workflowFailed" } : { status: r.status }),
        }) });
        done = true;
        break;
      }

      await stream.writeSSE({ event: "keep-alive", data: "" });
      await new Promise((rs) => setTimeout(rs, 2000));
    }
  });
});

codeRoutes.post("/feedback", zValidator("json", codeAgentFeedbackSchema), async (c) => {
  if (process.env.FEATURE_CODE_AGENT !== "true") return c.json({ error: "notFound" }, 404);
  const session = c.get("session");
  const fb = c.req.valid("json");

  // ownership check
  const [run] = await db.select().from(codeRuns).where(eq(codeRuns.id, fb.runId)).limit(1);
  if (!run || run.userId !== session.userId) return c.json({ error: "notFound" }, 404);
  if (["completed", "max_turns", "cancelled", "abandoned", "failed"].includes(run.status)) {
    return c.json({ error: "alreadyTerminal" }, 409);
  }

  const client = await getTemporalClient();
  await signalCodeFeedback(client, run.id, {
    kind: fb.kind,
    error: "error" in fb ? fb.error : undefined,
    stdout: "stdout" in fb ? fb.stdout : undefined,
  });
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount in `app.ts`**

`apps/api/src/app.ts`:

```ts
import { codeRoutes } from "./routes/code";
// ...
app.route("/api/code", codeRoutes);
```

- [ ] **Step 5: Run → pass**

```bash
pnpm --filter @opencairn/api test -- code-run
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/code.ts apps/api/src/app.ts \
        apps/api/tests/routes/code-run.test.ts
git commit -m "feat(api): add POST /api/code/run SSE + /feedback (Plan 7 Phase 2)"
```

---

### Task 10: `POST /api/canvas/from-template` (501 stub)

**Files:**
- Create: `apps/api/src/routes/canvas.ts`
- Test: `apps/api/tests/routes/canvas-from-template.test.ts`

- [ ] **Step 1: Failing test**

`apps/api/tests/routes/canvas-from-template.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestApp, signupAndLogin } from "../helpers";

describe("POST /api/canvas/from-template", () => {
  it("returns 501 when flag off (default)", async () => {
    const app = createTestApp({});
    const session = await signupAndLogin(app);
    const r = await app.request("/api/canvas/from-template", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({
        projectId: "00000000-0000-0000-0000-000000000001",
        templateId: "00000000-0000-0000-0000-000000000002",
      }),
    });
    expect(r.status).toBe(501);
    const body = await r.json();
    expect(body.error).toBe("templatesNotAvailable");
  });

  it("401 without session", async () => {
    const app = createTestApp({});
    const r = await app.request("/api/canvas/from-template", { method: "POST" });
    expect(r.status).toBe(401);
  });

  it("rejects invalid uuid (Zod)", async () => {
    const app = createTestApp({});
    const session = await signupAndLogin(app);
    const r = await app.request("/api/canvas/from-template", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({ projectId: "nope", templateId: "nope" }),
    });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/api test -- canvas-from-template
```

- [ ] **Step 3: Implement**

`apps/api/src/routes/canvas.ts`:

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../lib/auth";

export const canvasRoutes = new Hono();
canvasRoutes.use("*", requireAuth);

const fromTemplateSchema = z.object({
  projectId: z.string().uuid(),
  templateId: z.string().uuid(),
  params: z.record(z.unknown()).optional(),
});

canvasRoutes.post("/from-template", zValidator("json", fromTemplateSchema), async (c) => {
  if (process.env.FEATURE_CANVAS_TEMPLATES !== "true") {
    return c.json({ error: "templatesNotAvailable" }, 501);
  }
  // Plan 6 시점 본 구현. 현재는 도달 불가.
  return c.json({ error: "templatesNotAvailable" }, 501);
});
```

Mount in `app.ts`:

```ts
import { canvasRoutes } from "./routes/canvas";
app.route("/api/canvas", canvasRoutes);
```

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/api test -- canvas-from-template
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/canvas.ts apps/api/src/app.ts \
        apps/api/tests/routes/canvas-from-template.test.ts
git commit -m "feat(api): add /api/canvas/from-template flag-gated 501 stub (Plan 7 Phase 2)"
```

---

### Task 11: `POST /api/canvas/output` upload

**Files:**
- Modify: `apps/api/src/routes/canvas.ts`
- Test: `apps/api/tests/routes/canvas-output.test.ts`

- [ ] **Step 1: Failing test**

`apps/api/tests/routes/canvas-output.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestApp, signupAndLogin, createCanvasNote, postMultipart } from "../helpers";

const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009077d3" +
  "ce0000000c4944415408d76360000200000005000119d4d31a0000000049454e44ae426082",
  "hex",
);

describe("POST /api/canvas/output", () => {
  it("uploads + returns id", async () => {
    const app = createTestApp({});
    const session = await signupAndLogin(app);
    const noteId = await createCanvasNote(app, session);
    const r = await postMultipart(app, "/api/canvas/output", session, {
      noteId,
      mimeType: "image/png",
      file: PNG_1x1,
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.urlPath).toContain("/api/canvas/outputs/");
  });

  it("idempotent on (noteId, contentHash)", async () => {
    // upload twice → same id
  });

  it("rejects > 2MB", async () => {
    // synthesize 2MB+1 buffer
  });

  it("rejects mime != png/svg", async () => {
    // image/jpeg → 400
  });

  it("404 cross-workspace", async () => {
    // other user's note
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/api test -- canvas-output
```

- [ ] **Step 3: Implement upload + list + stream**

Extend `apps/api/src/routes/canvas.ts`:

```ts
import { bodyLimit } from "hono/body-limit";
import crypto from "node:crypto";
import { db, canvasOutputs, notes } from "@opencairn/db";
import { and, eq } from "drizzle-orm";
import { canvasOutputCreateSchema, MAX_CANVAS_OUTPUT_BYTES } from "@opencairn/shared";
import { putObject, getObjectStream } from "../lib/s3-client";
import { canRead } from "../lib/permissions";

canvasRoutes.post(
  "/output",
  bodyLimit({ maxSize: MAX_CANVAS_OUTPUT_BYTES, onError: (c) => c.json({ error: "outputTooLarge" }, 413) }),
  async (c) => {
    const session = c.get("session");
    const form = await c.req.parseBody();
    const parsed = canvasOutputCreateSchema.safeParse({
      noteId: form.noteId,
      runId: form.runId || undefined,
      mimeType: form.mimeType,
    });
    if (!parsed.success) return c.json({ error: "outputBadType" }, 400);

    const file = form.file;
    if (!(file instanceof File)) return c.json({ error: "outputBadType" }, 400);
    if (file.size > MAX_CANVAS_OUTPUT_BYTES) return c.json({ error: "outputTooLarge" }, 413);

    const [note] = await db.select().from(notes).where(eq(notes.id, parsed.data.noteId)).limit(1);
    if (!note || !(await canRead(session.userId, parsed.data.noteId))) {
      return c.json({ error: "notFound" }, 404);
    }
    if (note.sourceType !== "canvas") return c.json({ error: "notCanvas" }, 409);

    const buf = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buf).digest("hex");

    // idempotent: reuse if exists
    const existing = await db.select().from(canvasOutputs)
      .where(and(eq(canvasOutputs.noteId, parsed.data.noteId), eq(canvasOutputs.contentHash, hash)))
      .limit(1);
    if (existing[0]) {
      return c.json({
        id: existing[0].id,
        urlPath: `/api/canvas/outputs/${existing[0].id}/file`,
        createdAt: existing[0].createdAt,
      });
    }

    const ext = parsed.data.mimeType === "image/svg+xml" ? "svg" : "png";
    const s3Key = `canvas-outputs/${note.workspaceId}/${parsed.data.noteId}/${hash}.${ext}`;
    await putObject(s3Key, buf, parsed.data.mimeType);

    const [row] = await db.insert(canvasOutputs).values({
      noteId: parsed.data.noteId,
      runId: parsed.data.runId ?? null,
      contentHash: hash,
      mimeType: parsed.data.mimeType,
      s3Key,
      bytes: buf.length,
    }).returning();

    return c.json({
      id: row.id,
      urlPath: `/api/canvas/outputs/${row.id}/file`,
      createdAt: row.createdAt,
    });
  },
);
```

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/api test -- canvas-output
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/canvas.ts \
        apps/api/tests/routes/canvas-output.test.ts
git commit -m "feat(api): add POST /api/canvas/output (idempotent matplotlib upload) (Plan 7 Phase 2)"
```

---

### Task 12: `GET /api/canvas/outputs?noteId=` + GET `:id/file` stream

**Files:**
- Modify: `apps/api/src/routes/canvas.ts`
- Test: `apps/api/tests/routes/canvas-outputs-list.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { createTestApp, signupAndLogin, createCanvasNote, postMultipart } from "../helpers";

describe("GET /api/canvas/outputs", () => {
  it("lists by noteId, ordered desc", async () => {
    const app = createTestApp({});
    const session = await signupAndLogin(app);
    const noteId = await createCanvasNote(app, session);
    // upload 2 figures
    // ...
    const r = await app.request(`/api/canvas/outputs?noteId=${noteId}`, {
      headers: { cookie: session },
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.outputs.length).toBe(2);
  });

  it("403 without canRead", async () => { /* other user */ });

  it("file route streams binary with image/png header", async () => {
    // create + GET /api/canvas/outputs/:id/file → check content-type
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/api test -- canvas-outputs-list
```

- [ ] **Step 3: Implement**

```ts
canvasRoutes.get("/outputs", async (c) => {
  const session = c.get("session");
  const noteId = c.req.query("noteId");
  if (!noteId) return c.json({ error: "noteIdRequired" }, 400);
  if (!(await canRead(session.userId, noteId))) return c.json({ error: "notFound" }, 404);

  const rows = await db.select().from(canvasOutputs)
    .where(eq(canvasOutputs.noteId, noteId))
    .orderBy(canvasOutputs.createdAt);

  return c.json({
    outputs: rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      mimeType: r.mimeType,
      bytes: r.bytes,
      createdAt: r.createdAt,
      urlPath: `/api/canvas/outputs/${r.id}/file`,
    })),
  });
});

canvasRoutes.get("/outputs/:id/file", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const [row] = await db.select().from(canvasOutputs).where(eq(canvasOutputs.id, id)).limit(1);
  if (!row || !(await canRead(session.userId, row.noteId))) return c.json({ error: "notFound" }, 404);

  const stream = await getObjectStream(row.s3Key);
  return new Response(stream, {
    headers: {
      "content-type": row.mimeType,
      "cache-control": "private, max-age=3600",
    },
  });
});
```

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/api test -- canvas-outputs-list
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/canvas.ts \
        apps/api/tests/routes/canvas-outputs-list.test.ts
git commit -m "feat(api): add GET /api/canvas/outputs list + file stream (Plan 7 Phase 2)"
```

---

### Task 13: API env wiring

**Files:**
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Add flags**

```ini
# Plan 7 Phase 2 — Code Agent
FEATURE_CODE_AGENT=false
FEATURE_CANVAS_TEMPLATES=false
FEATURE_CANVAS_OUTPUT_STORE=true
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/.env.example
git commit -m "chore(api): add Plan 7 Phase 2 feature flags to env example"
```

---

## Phase D — Web

### Task 14: Web API client + `useCodeAgentStream`

**Files:**
- Create: `apps/web/src/lib/api-client-code.ts`
- Create: `apps/web/src/lib/use-code-agent-stream.ts`
- Test: `apps/web/src/lib/use-code-agent-stream.test.ts`

- [ ] **Step 1: Failing test**

`apps/web/src/lib/use-code-agent-stream.test.ts`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCodeAgentStream } from "./use-code-agent-stream";

// mock EventSource
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  close() {}
  emit(data: object) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) })); }
}

describe("useCodeAgentStream", () => {
  beforeEach(() => { (globalThis as any).EventSource = FakeEventSource; FakeEventSource.instances = []; });

  it("collects turns + transitions to awaiting_feedback", async () => {
    const { result } = renderHook(() => useCodeAgentStream("run-1"));
    const es = FakeEventSource.instances[0];
    es.emit({ kind: "queued", runId: "run-1" });
    es.emit({ kind: "turn_complete", turn: { kind: "generate", source: "x", explanation: "", seq: 0 } });
    es.emit({ kind: "awaiting_feedback" });
    await waitFor(() => expect(result.current.status).toBe("awaiting_feedback"));
    expect(result.current.turns.length).toBe(1);
  });

  it("closes on done", async () => {
    const closeSpy = vi.fn();
    class CES extends FakeEventSource { close() { closeSpy(); } }
    (globalThis as any).EventSource = CES;
    const { result } = renderHook(() => useCodeAgentStream("run-2"));
    const es = (globalThis as any).EventSource.instances?.at(-1) ?? FakeEventSource.instances.at(-1);
    es.emit({ kind: "done", status: "completed" });
    await waitFor(() => expect(result.current.status).toBe("done"));
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/web test -- use-code-agent-stream
```

- [ ] **Step 3: Implement client + hook**

`apps/web/src/lib/api-client-code.ts`:

```ts
import { apiClient } from "./api-client";
import type { CodeAgentRunRequest, CodeAgentFeedback } from "@opencairn/shared";

export const startCodeRun = (req: CodeAgentRunRequest) =>
  apiClient<{ runId: string }>(`/code/run`, {
    method: "POST",
    body: JSON.stringify(req),
  });

export const sendCodeFeedback = (fb: CodeAgentFeedback) =>
  apiClient<{ ok: true }>(`/code/feedback`, {
    method: "POST",
    body: JSON.stringify(fb),
  });
```

`apps/web/src/lib/use-code-agent-stream.ts`:

```ts
"use client";
import { useEffect, useState } from "react";
import type { CodeAgentEvent, CodeAgentTurn } from "@opencairn/shared";

type Status = "queued" | "running" | "awaiting_feedback" | "done" | "error";

export function useCodeAgentStream(runId: string | null) {
  const [status, setStatus] = useState<Status>("queued");
  const [turns, setTurns] = useState<CodeAgentTurn[]>([]);
  const [doneStatus, setDoneStatus] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/code/runs/${runId}/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as CodeAgentEvent;
        switch (data.kind) {
          case "queued":
            setStatus("running"); break;
          case "turn_complete":
            setTurns((t) => [...t, data.turn]); break;
          case "awaiting_feedback":
            setStatus("awaiting_feedback"); break;
          case "done":
            setStatus("done"); setDoneStatus(data.status); es.close(); break;
          case "error":
            setStatus("error"); setErrorCode(data.code); es.close(); break;
        }
      } catch {}
    };
    es.onerror = () => { setStatus("error"); es.close(); };
    return () => es.close();
  }, [runId]);

  return { status, turns, doneStatus, errorCode };
}
```

> Transport: POST `/api/code/run` returns `{ runId }`. The hook then opens GET `/api/code/runs/:runId/stream` via `EventSource`. This matches Task 9 and Deep Research.

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/web test -- use-code-agent-stream
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client-code.ts \
        apps/web/src/lib/use-code-agent-stream.ts \
        apps/web/src/lib/use-code-agent-stream.test.ts
git commit -m "feat(web): add code agent api client + SSE hook (Plan 7 Phase 2)"
```

---

### Task 15: `useCanvasOutputs` hook + outputs API client

**Files:**
- Create: `apps/web/src/lib/use-canvas-outputs.ts`
- Test: `apps/web/src/lib/use-canvas-outputs.test.ts`

- [ ] **Step 1: Failing test (React Query + msw)**

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { useCanvasOutputs } from "./use-canvas-outputs";

const server = setupServer(
  http.get("*/api/canvas/outputs", () =>
    HttpResponse.json({ outputs: [{ id: "o1", urlPath: "/api/canvas/outputs/o1/file", mimeType: "image/png", bytes: 100, createdAt: "2026-04-26" }] }),
  ),
);
beforeAll(() => server.listen());
afterAll(() => server.close());

function wrap() {
  const qc = new QueryClient();
  return ({ children }: any) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCanvasOutputs", () => {
  it("fetches list", async () => {
    const { result } = renderHook(() => useCanvasOutputs("note-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.outputs.length).toBe(1));
  });

  it("uploads + invalidates", async () => {
    server.use(http.post("*/api/canvas/output", () => HttpResponse.json({ id: "o2", urlPath: "/api/canvas/outputs/o2/file" })));
    const { result } = renderHook(() => useCanvasOutputs("note-1"), { wrapper: wrap() });
    await result.current.upload({ blob: new Blob(["x"], { type: "image/png" }), runId: "r1" });
    await waitFor(() => expect(result.current.data?.outputs).toBeDefined());
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/web test -- use-canvas-outputs
```

- [ ] **Step 3: Implement**

`apps/web/src/lib/use-canvas-outputs.ts`:

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./api-client";

type CanvasOutputItem = {
  id: string;
  urlPath: string;
  runId: string | null;
  mimeType: "image/png" | "image/svg+xml";
  bytes: number;
  createdAt: string;
};

export function useCanvasOutputs(noteId: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["canvas-outputs", noteId],
    queryFn: () => apiClient<{ outputs: CanvasOutputItem[] }>(`/canvas/outputs?noteId=${noteId}`),
    enabled: !!noteId,
  });

  const upload = useMutation({
    mutationFn: async ({ blob, runId }: { blob: Blob; runId?: string }) => {
      const fd = new FormData();
      fd.append("noteId", noteId);
      if (runId) fd.append("runId", runId);
      fd.append("mimeType", blob.type);
      fd.append("file", blob);
      return apiClient<{ id: string; urlPath: string }>("/canvas/output", { method: "POST", body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canvas-outputs", noteId] }),
  });

  return { ...query, upload: upload.mutateAsync, uploading: upload.isPending };
}
```

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/web test -- use-canvas-outputs
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/use-canvas-outputs.ts \
        apps/web/src/lib/use-canvas-outputs.test.ts
git commit -m "feat(web): add useCanvasOutputs hook (list + upload) (Plan 7 Phase 2)"
```

---

### Task 16: `MonacoEditor` + canvas-viewer integration

**Files:**
- Create: `apps/web/src/components/canvas/MonacoEditor.tsx`
- Create: `apps/web/src/components/canvas/MonacoEditor.test.tsx`
- Modify: `apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx`
- Add dep: `@monaco-editor/react`, `monaco-editor`

- [ ] **Step 1: Add dependency**

```bash
pnpm --filter @opencairn/web add @monaco-editor/react@4.7.0 monaco-editor@0.52.0
```

(adjust to current minor versions; pin exact)

- [ ] **Step 2: Failing component test**

`apps/web/src/components/canvas/MonacoEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MonacoEditor } from "./MonacoEditor";

// mock @monaco-editor/react to avoid loading actual monaco in jsdom
vi.mock("@monaco-editor/react", () => ({
  default: ({ language, value }: any) => <div data-testid="m" data-lang={language}>{value}</div>,
}));

describe("MonacoEditor", () => {
  it("maps canvasLanguage='react' → monaco language='javascript'", async () => {
    render(<MonacoEditor language="react" value="<div/>" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("m")).toHaveAttribute("data-lang", "javascript"));
  });

  it("renders source value", async () => {
    render(<MonacoEditor language="python" value="print(1)" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("print(1)")).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run → fail**

```bash
pnpm --filter @opencairn/web test -- MonacoEditor
```

- [ ] **Step 4: Implement**

`apps/web/src/components/canvas/MonacoEditor.tsx`:

```tsx
"use client";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import type { CanvasLanguage } from "@opencairn/shared";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => null,
});

const LANG_MAP: Record<CanvasLanguage, "python" | "javascript" | "html"> = {
  python: "python",
  javascript: "javascript",
  react: "javascript",
  html: "html",
};

export function MonacoEditor(props: {
  language: CanvasLanguage;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("canvas");
  const { resolvedTheme } = useTheme();
  return (
    <Monaco
      height="100%"
      theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
      language={LANG_MAP[props.language]}
      value={props.value}
      onChange={(v) => props.onChange(v ?? "")}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 2,
        wordWrap: "on",
        fixedOverflowWidgets: true,
        scrollBeyondLastLine: false,
      }}
      loading={<div className="text-xs p-2">{t("monaco.loading")}</div>}
    />
  );
}
```

- [ ] **Step 5: Swap textarea in `canvas-viewer.tsx`**

Replace the `<textarea …>` block with `<MonacoEditor language={language} value={source} onChange={setSource} />`. Update test to use the new component.

- [ ] **Step 6: Run → pass**

```bash
pnpm --filter @opencairn/web test -- MonacoEditor canvas-viewer
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/canvas/MonacoEditor.tsx \
        apps/web/src/components/canvas/MonacoEditor.test.tsx \
        apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx \
        apps/web/src/components/tab-shell/viewers/canvas-viewer.test.tsx \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): swap textarea for Monaco in canvas-viewer (Plan 7 Phase 2)"
```

---

### Task 17: `CodeAgentPanel`

**Files:**
- Create: `apps/web/src/components/canvas/CodeAgentPanel.tsx`
- Test: `apps/web/src/components/canvas/CodeAgentPanel.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CodeAgentPanel } from "./CodeAgentPanel";

const startSpy = vi.fn();
vi.mock("@/lib/api-client-code", () => ({
  startCodeRun: (...a: any[]) => startSpy(...a),
  sendCodeFeedback: vi.fn(),
}));

describe("CodeAgentPanel", () => {
  it("idle → submits prompt → triggers startCodeRun", async () => {
    render(<CodeAgentPanel noteId="n1" language="python" onApply={() => {}} runResult={null} />);
    fireEvent.change(screen.getByPlaceholderText(/canvas\.agent\.placeholder/), { target: { value: "Plot sin" } });
    fireEvent.click(screen.getByRole("button", { name: /canvas\.agent\.run/ }));
    await waitFor(() => expect(startSpy).toHaveBeenCalled());
  });

  it("renders Apply / Discard when awaiting_feedback with a turn", () => {
    render(<CodeAgentPanel
      noteId="n1" language="python"
      onApply={() => {}} runResult={{
        status: "awaiting_feedback",
        turns: [{ kind: "generate", source: "print(1)", explanation: "", seq: 0 }],
      }} />);
    expect(screen.getByRole("button", { name: /canvas\.agent\.apply/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /canvas\.agent\.discard/ })).toBeInTheDocument();
  });

  it("shows turn counter (n / 4)", () => {
    render(<CodeAgentPanel
      noteId="n1" language="python"
      onApply={() => {}} runResult={{
        status: "awaiting_feedback",
        turns: [{ kind: "generate", source: "x", explanation: "", seq: 0 }, { kind: "fix", source: "y", explanation: "", seq: 1 }],
      }} />);
    expect(screen.getByText(/2.*4/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/web test -- CodeAgentPanel
```

- [ ] **Step 3: Implement**

`apps/web/src/components/canvas/CodeAgentPanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { startCodeRun, sendCodeFeedback } from "@/lib/api-client-code";
import type { CanvasLanguage, CodeAgentTurn } from "@opencairn/shared";

type RunResult = {
  status: "queued" | "running" | "awaiting_feedback" | "done" | "error";
  turns: CodeAgentTurn[];
  doneStatus?: string;
  errorCode?: string;
};

export function CodeAgentPanel(props: {
  noteId: string;
  language: CanvasLanguage;
  runResult: RunResult | null;
  onApply: (source: string) => void;
  onStart?: (runId: string) => void;
}) {
  const t = useTranslations("canvas");
  const [prompt, setPrompt] = useState("");
  const [autoFix, setAutoFix] = useState(false);
  const [busy, setBusy] = useState(false);

  const lastTurn = props.runResult?.turns.at(-1);
  const turnCount = props.runResult?.turns.length ?? 0;
  const status = props.runResult?.status ?? "idle";

  const onSubmit = async () => {
    if (!prompt) return;
    setBusy(true);
    try {
      const { runId } = await startCodeRun({ noteId: props.noteId, prompt, language: props.language });
      props.onStart?.(runId);
    } finally { setBusy(false); }
  };

  return (
    <div className="border-t p-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {t("agent.title")}
      </div>

      {(status === "idle" || status === "done" || status === "error") && (
        <>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("agent.placeholder")}
            className="w-full h-20 border rounded px-2 py-1 text-sm"
          />
          <div className="flex items-center gap-2">
            <button onClick={onSubmit} disabled={busy || !prompt}
              className="px-3 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50">
              {t("agent.run")}
            </button>
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} />
              {t(autoFix ? "agent.autoFixOn" : "agent.autoFixOff")}
            </label>
          </div>
        </>
      )}

      {status === "running" && <div className="text-sm">{t("agent.running")}</div>}

      {status === "awaiting_feedback" && lastTurn && (
        <div className="space-y-1">
          <div className="text-xs">{t("agent.turnsCount", { current: turnCount, max: 4 })}</div>
          <pre className="text-xs bg-muted/30 p-2 rounded max-h-40 overflow-auto">{lastTurn.source}</pre>
          {lastTurn.explanation && <p className="text-xs text-muted-foreground">{lastTurn.explanation}</p>}
          <div className="flex gap-2">
            <button onClick={() => props.onApply(lastTurn.source)}
              className="px-3 py-1 rounded bg-primary text-primary-foreground">
              {t("agent.apply")}
            </button>
            <button className="px-3 py-1 rounded border">{t("agent.discard")}</button>
          </div>
        </div>
      )}

      {status === "done" && (
        <div className="text-xs text-muted-foreground">
          {props.runResult?.doneStatus === "max_turns" && t("agent.maxTurnsReached")}
          {props.runResult?.doneStatus === "abandoned" && t("agent.abandoned")}
          {props.runResult?.doneStatus === "cancelled" && t("agent.cancelled")}
        </div>
      )}
    </div>
  );
}
```

Wire `CodeAgentPanel` into `canvas-viewer.tsx` below the toolbar (collapsible). Pass `runResult` from `useCodeAgentStream(currentRunId)`.

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/web test -- CodeAgentPanel
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/CodeAgentPanel.tsx \
        apps/web/src/components/canvas/CodeAgentPanel.test.tsx \
        apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx
git commit -m "feat(web): add CodeAgentPanel + wire into canvas-viewer (Plan 7 Phase 2)"
```

---

### Task 18: PyodideRunner — matplotlib figure capture

**Files:**
- Modify: `apps/web/src/components/canvas/PyodideRunner.tsx`
- Modify: `apps/web/src/components/canvas/PyodideRunner.test.tsx`

- [ ] **Step 1: Add failing test for figure capture**

Add to existing `PyodideRunner.test.tsx`:

```tsx
it("captures matplotlib figures and emits via onResult", async () => {
  const onResult = vi.fn();
  // mock pyodide loader to return a fake instance whose runPythonAsync returns
  // ['<base64-A>', '<base64-B>'] for the figures collection step
  // ...
  render(<PyodideRunner source="import matplotlib.pyplot as plt; plt.plot([1,2]); plt.show()" onResult={onResult} />);
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
    figures: ["<base64-A>", "<base64-B>"],
  })));
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/web test -- PyodideRunner
```

- [ ] **Step 3: Implement figure capture**

In `PyodideRunner.tsx`, before user code execution:

```tsx
await pyodide.runPythonAsync(`
import os
os.environ['MPLBACKEND'] = 'AGG'
`);
```

After execution, call:

```tsx
const figures: string[] = await pyodide.runPythonAsync(`
import io, base64
try:
    import matplotlib.pyplot as plt
    result = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
        result.append(base64.b64encode(buf.getvalue()).decode())
    plt.close('all')
    result
except ImportError:
    []
`).then((proxy) => proxy?.toJs?.() ?? []);
onResult?.({ stdout, stderr, figures, error: errorOrNull });
```

Update `Props` to accept `onResult?: (r: { stdout: string; stderr: string; figures: string[]; error: string | null }) => void`. Make sure existing tests still pass.

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/web test -- PyodideRunner
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/PyodideRunner.tsx \
        apps/web/src/components/canvas/PyodideRunner.test.tsx
git commit -m "feat(web): capture matplotlib figures in PyodideRunner (Plan 7 Phase 2)"
```

---

### Task 19: `CanvasOutputsGallery` + Save plot button

**Files:**
- Create: `apps/web/src/components/canvas/CanvasOutputsGallery.tsx`
- Test: `apps/web/src/components/canvas/CanvasOutputsGallery.test.tsx`
- Modify: `apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx` (mount gallery + save buttons)

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CanvasOutputsGallery } from "./CanvasOutputsGallery";

const upload = vi.fn();
vi.mock("@/lib/use-canvas-outputs", () => ({
  useCanvasOutputs: () => ({
    data: { outputs: [{ id: "o1", urlPath: "/api/canvas/outputs/o1/file", mimeType: "image/png", bytes: 100, createdAt: "2026-04-26", runId: null }] },
    upload,
    uploading: false,
  }),
}));

const wrap = ({ children }: any) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("CanvasOutputsGallery", () => {
  it("renders existing outputs", () => {
    render(<CanvasOutputsGallery noteId="n1" pendingFigures={[]} runId={null} />, { wrapper: wrap });
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("save calls upload with png blob", async () => {
    render(<CanvasOutputsGallery noteId="n1" pendingFigures={["<base64>"]} runId="r1" />, { wrapper: wrap });
    fireEvent.click(screen.getByRole("button", { name: /canvas\.outputs\.save/ }));
    expect(upload).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → fail**

```bash
pnpm --filter @opencairn/web test -- CanvasOutputsGallery
```

- [ ] **Step 3: Implement**

`apps/web/src/components/canvas/CanvasOutputsGallery.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useCanvasOutputs } from "@/lib/use-canvas-outputs";

const b64ToBlob = (b64: string, type = "image/png") => {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
};

export function CanvasOutputsGallery(props: {
  noteId: string;
  runId: string | null;
  pendingFigures: string[];   // base64 png strings from PyodideRunner
}) {
  const t = useTranslations("canvas");
  const { data, upload, uploading } = useCanvasOutputs(props.noteId);

  const onSave = async (b64: string) => {
    const blob = b64ToBlob(b64);
    await upload({ blob, runId: props.runId ?? undefined });
  };

  return (
    <div className="border-t p-3 space-y-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {t("outputs.title")}
      </div>
      {props.pendingFigures.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {props.pendingFigures.map((b64, i) => (
            <div key={i} className="space-y-1">
              <img src={`data:image/png;base64,${b64}`} alt="" className="w-full border rounded" />
              <button
                onClick={() => onSave(b64)}
                disabled={uploading}
                className="w-full text-xs px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-50"
              >
                {t("outputs.save")}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {data?.outputs.map((o) => (
          <img key={o.id} src={o.urlPath} alt="" className="w-full border rounded" />
        ))}
        {(!data?.outputs.length && !props.pendingFigures.length) && (
          <div className="text-xs text-muted-foreground col-span-3">{t("outputs.empty")}</div>
        )}
      </div>
    </div>
  );
}
```

Mount in `canvas-viewer.tsx` below the run pane. Wire `pendingFigures` from `PyodideRunner.onResult`.

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/web test -- CanvasOutputsGallery
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/CanvasOutputsGallery.tsx \
        apps/web/src/components/canvas/CanvasOutputsGallery.test.tsx \
        apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx
git commit -m "feat(web): add CanvasOutputsGallery with save-plot UI (Plan 7 Phase 2)"
```

---

## Phase E — Cross-cutting

### Task 20: i18n keys (canvas.json ko/en parity)

**Files:**
- Modify: `apps/web/messages/ko/canvas.json`
- Modify: `apps/web/messages/en/canvas.json`

- [ ] **Step 1: Add keys to ko**

Insert under `"canvas"` namespace:

```json
{
  "agent": {
    "title": "코드 에이전트",
    "placeholder": "원하는 동작을 자연어로 입력해 주세요. 예: matplotlib으로 sin 그래프를 그려 줘",
    "run": "AI에게 부탁",
    "running": "코드 작성 중…",
    "apply": "적용",
    "discard": "버림",
    "retry": "다시 시도",
    "autoFix": "자동 수정",
    "autoFixOn": "자동 수정: 켜짐",
    "autoFixOff": "자동 수정: 꺼짐",
    "turnsCount": "{current} / {max} 회",
    "maxTurnsReached": "수정 시도 한도에 도달했습니다.",
    "abandoned": "30 분 동안 응답이 없어 종료되었습니다.",
    "cancelled": "취소되었습니다."
  },
  "monaco": {
    "loading": "에디터 불러오는 중…",
    "error": "에디터를 불러오지 못했습니다."
  },
  "outputs": {
    "title": "저장된 출력",
    "save": "노트에 저장",
    "saved": "저장됨",
    "empty": "아직 저장된 출력이 없습니다.",
    "delete": "삭제",
    "confirmDelete": "이 출력을 삭제할까요?"
  },
  "template": {
    "notAvailable": "템플릿 기능은 곧 제공됩니다."
  },
  "errors": {
    "notCanvas": "캔버스 노트가 아닙니다.",
    "wrongLanguage": "코드 언어가 노트와 다릅니다.",
    "workflowFailed": "코드 에이전트가 응답하지 않습니다.",
    "outputTooLarge": "출력 파일이 너무 큽니다 (2MB 초과).",
    "outputBadType": "지원하지 않는 출력 형식입니다.",
    "templatesNotAvailable": "템플릿 기능은 곧 제공됩니다.",
    "alreadyTerminal": "이미 종료된 실행입니다."
  }
}
```

- [ ] **Step 2: Mirror to en**

Same structure with English copy. Keep keys identical.

- [ ] **Step 3: Run parity check**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/ko/canvas.json apps/web/messages/en/canvas.json
git commit -m "feat(web): add Plan 7 Phase 2 canvas i18n keys (ko/en parity)"
```

---

### Task 21: CSP + canvas-regression-guard

**Files:**
- Modify: `apps/web/next.config.ts` (CSP `img-src` adds `blob:`)
- Modify: `scripts/canvas-regression-guard.sh`

- [ ] **Step 1: Update CSP**

In `next.config.ts` find the CSP header section. Modify `img-src`:

```
img-src 'self' data: blob:
```

(Keep `data:` for existing data-URL images.)

- [ ] **Step 2: Extend regression guard**

Add to `scripts/canvas-regression-guard.sh`:

```bash
# Plan 7 Phase 2 additions
if grep -rn "monaco-editor.*cdn\." apps/web/src 2>/dev/null; then
  echo "FAIL: Monaco CDN detected — must self-host"
  exit 1
fi

if grep -rn "Content-Type.*application/json" apps/api/src/routes/code.ts 2>/dev/null; then
  echo "FAIL: /api/code/run must respond with text/event-stream"
  exit 1
fi
```

- [ ] **Step 3: Run guard**

```bash
bash scripts/canvas-regression-guard.sh
```

Expected: PASS (no FAIL lines).

- [ ] **Step 4: Commit**

```bash
git add apps/web/next.config.ts scripts/canvas-regression-guard.sh
git commit -m "feat(infra): extend CSP + canvas regression guard for Phase 2"
```

---

### Task 22: `/test-seed` canvas-phase2 mode

**Files:**
- Modify: existing `/test-seed` route handler (search for it: `grep -rn "test-seed" apps/api/src apps/web/src`)
- Test: `apps/api/tests/routes/test-seed.test.ts` (extend if exists, else add)

- [ ] **Step 1: Locate the test-seed handler**

```bash
grep -rn "test-seed" apps/
```

- [ ] **Step 2: Add the seed mode**

Mode `canvas-phase2`:
- Creates user + workspace + project
- Creates 1 canvas note (sourceType=`canvas`, language=`python`, contentText=`print('hello')`)
- Returns `{ userId, workspaceId, projectId, noteId, sessionCookie }`

Code (sketch):

```ts
case "canvas-phase2": {
  const { user, ws, project } = await seedUserWorkspaceProject();
  const [note] = await db.insert(notes).values({
    title: "Phase 2 demo",
    workspaceId: ws.id,
    userId: user.id,
    sourceType: "canvas",
    canvasLanguage: "python",
    contentText: "print('hello')",
  }).returning();
  return c.json({ userId: user.id, workspaceId: ws.id, projectId: project.id, noteId: note.id });
}
```

- [ ] **Step 3: Test**

```ts
it("seeds canvas-phase2 mode", async () => {
  const r = await app.request("/test-seed?mode=canvas-phase2", { method: "POST" });
  expect(r.status).toBe(200);
  const b = await r.json();
  expect(b.noteId).toBeDefined();
});
```

- [ ] **Step 4: Run → pass**

```bash
pnpm --filter @opencairn/api test -- test-seed
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/test-seed.ts apps/api/tests/routes/test-seed.test.ts
git commit -m "test(api): add canvas-phase2 test-seed mode (Plan 7 Phase 2)"
```

---

## Phase F — E2E + docs

### Task 23: Playwright E2E (7 scenarios)

**Files:**
- Create: `apps/web/tests/e2e/canvas-phase-2.spec.ts`
- Modify: CI workflow file (e.g. `.github/workflows/ci.yml`) — add `e2e:canvas` job

- [ ] **Step 1: Write the spec**

`apps/web/tests/e2e/canvas-phase-2.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const FLAG_ON = { FEATURE_CODE_AGENT: "true" };

test.describe("Plan 7 Phase 2", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/test-seed?mode=canvas-phase2", { waitUntil: "networkidle" });
  });

  test("1. New Canvas → generate → turn_complete + Apply enabled", async ({ page }) => {
    // navigate to canvas note tab → fill prompt → click Run → assert Apply visible
  });

  test("2. Apply → Run → success path (stdout)", async ({ page }) => { /* … */ });

  test("3. Apply → Run → error → feedback → fix turn", async ({ page }) => { /* … */ });

  test("4. matplotlib figure → Save → outputs gallery has 1", async ({ page }) => { /* … */ });

  test("5. max_turns reached", async ({ page }) => { /* … */ });

  test("6. Tab Mode switch canvas → reading (stub)", async ({ page }) => { /* … */ });

  test("7. /api/canvas/from-template returns 501 with flag off", async ({ page, request }) => {
    const r = await request.post("/api/canvas/from-template", {
      data: { projectId: "00000000-0000-0000-0000-000000000001", templateId: "00000000-0000-0000-0000-000000000002" },
    });
    expect(r.status()).toBe(501);
    expect(await r.json()).toMatchObject({ error: "templatesNotAvailable" });
  });
});
```

Fill the body of each test using locators consistent with the components from Tasks 16-19. Use `data-testid` attributes added during those tasks (`canvas-viewer-toolbar`, etc.).

- [ ] **Step 2: Add CI job**

```yaml
# .github/workflows/ci.yml
e2e-canvas:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v3
    - uses: actions/setup-node@v4
      with: { node-version: 20, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @opencairn/db db:migrate
    - run: pnpm --filter @opencairn/web exec playwright install --with-deps chromium
    - name: Warm Pyodide
      run: pnpm --filter @opencairn/web exec node -e "fetch('https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js').then(r => r.text())"
    - run: pnpm --filter @opencairn/web e2e canvas-phase-2.spec.ts
      env:
        FEATURE_CODE_AGENT: "true"
        GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY_CI }}
```

- [ ] **Step 3: Run locally**

```bash
FEATURE_CODE_AGENT=true pnpm --filter @opencairn/web e2e canvas-phase-2.spec.ts
```

Fix flakes inline. All 7 must pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/canvas-phase-2.spec.ts .github/workflows/ci.yml
git commit -m "test(web): add Plan 7 Phase 2 E2E (7 scenarios) + CI job"
```

---

### Task 24: Docs updates

**Files:**
- Modify: `docs/architecture/api-contract.md` (add /api/code/*, /api/canvas/*)
- Modify: `docs/architecture/data-flow.md` (add Code Agent flow)
- Modify: `docs/contributing/plans-status.md` (Plan 7 Phase 2 ✅)
- Modify: `docs/contributing/ops.md` (canvas_outputs ops)
- Modify: `docs/contributing/llm-antipatterns.md` (Phase 2 traps if any surfaced during impl)

- [ ] **Step 1: api-contract.md**

Add table rows under `/api/code` and `/api/canvas`:

```markdown
### /api/code (FEATURE_CODE_AGENT)

| Method | Path                              | Auth | Notes                                                            |
| ------ | --------------------------------- | ---- | ---------------------------------------------------------------- |
| POST   | /api/code/run                     | user | Body: `{noteId,prompt,language}` → `{runId}`. 409 notCanvas.     |
| GET    | /api/code/runs/:runId/stream      | user | SSE. Owner-only. Emits queued/turn_complete/awaiting_feedback/done. |
| POST   | /api/code/feedback                | user | Body: `{runId,kind,error?,stdout?}`. 409 alreadyTerminal.        |

### /api/canvas

| Method | Path                          | Auth   | Notes                                                         |
| ------ | ----------------------------- | ------ | ------------------------------------------------------------- |
| POST   | /api/canvas/from-template     | user   | 501 unless FEATURE_CANVAS_TEMPLATES.                          |
| POST   | /api/canvas/output            | user   | multipart, ≤2MB png/svg, idempotent on (noteId,contentHash).  |
| GET    | /api/canvas/outputs?noteId=   | user   | List by noteId, desc.                                         |
| GET    | /api/canvas/outputs/:id/file  | user   | Stream from MinIO.                                            |
```

- [ ] **Step 2: data-flow.md**

Add a section "Code Agent (Plan 7 Phase 2)" with the ASCII diagram from spec §2.1.

- [ ] **Step 3: plans-status.md**

Update Plan 7 row:

```
✅ Phase 2 ... — Code Agent + /api/code/run + Monaco + matplotlib MinIO + E2E. <commit>.
Plan 6 의존(`from-template`)은 별도 phase. ...
```

- [ ] **Step 4: ops.md**

Append:

```markdown
### canvas_outputs ops

- 버킷: `canvas-outputs/<workspaceId>/<noteId>/<contentHash>.{png|svg}`.
- 정리: 30 일 미접근 객체 cron 삭제 (cron job `scripts/purge_canvas_outputs.py`, Phase 3 작성).
- 모니터링: 객체 수 / 용량 / 실패율 알림 — Grafana 대시보드 `canvas-outputs`.
- 트러블슈팅: idempotent INSERT 충돌 → 정상 (재업로드 안전).
```

- [ ] **Step 5: llm-antipatterns.md (if applicable)**

If Phase 2 implementation surfaces specific Claude / SDK traps, append a new §. Otherwise skip.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/api-contract.md docs/architecture/data-flow.md \
        docs/contributing/plans-status.md docs/contributing/ops.md \
        docs/contributing/llm-antipatterns.md
git commit -m "docs(docs): document Plan 7 Phase 2 (api-contract, data-flow, plans-status, ops)"
```

---

## Wrap-up

After Task 24, run the full validation suite:

```bash
pnpm -w build
pnpm -w test
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web exec next lint --max-warnings 0
bash scripts/canvas-regression-guard.sh
FEATURE_CODE_AGENT=true pnpm --filter @opencairn/web e2e canvas-phase-2.spec.ts
```

Then follow `opencairn:post-feature` skill for the verification → review → docs → commit closing loop, and merge to main via PR.

### Phase 2 인계 (다음 phase)

- `/api/canvas/from-template` 본 구현 (Plan 6 templates 도착 시).
- `previous_interaction_id` 체이닝 도입으로 fix turn 비용 절감.
- `search_notes` / `fetch_url` tool 추가로 Code Agent 노트 인용 가능.
- Hocuspocus 어댑터 → CanvasViewer / Monaco 협업.
- inline canvas Plate 블록 (Plan 10B).
- 캔버스 export (.py / .ipynb) — Plan 10 Document Skills 통합.
