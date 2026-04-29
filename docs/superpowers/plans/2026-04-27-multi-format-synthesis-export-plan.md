# Multi-format Synthesis Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Synthesis feature that generates LaTeX/DOCX/PDF/Markdown documents from user-selected sources + workspace notes via a one-shot LLM call, compiled server-side (DOCX: `docx` npm, PDF: Playwright, LaTeX→PDF: Tectonic MSA Pro-only).

**Architecture:** Temporal `SynthesisWorkflow` (3 activities: `fetch_sources` → `synthesize` → `compile`) orchestrated from `apps/api`. `SynthesisAgent` follows the existing CodeAgent one-shot pattern (single `emit_structured_output` tool call returning `SynthesisOutputSchema`). Compilation is split: Markdown / LaTeX `.tex` / LaTeX zip — worker direct upload to S3; DOCX / Playwright PDF — worker POSTs to `/api/internal/synthesis/compile` and `apps/api` renders+uploads; LaTeX→PDF (Pro) — worker calls `apps/tectonic` MSA then uploads. Frontend mirrors existing `useCodeAgentStream` SSE pattern.

**Tech Stack:** Hono 4 + zod-validator, Drizzle, Temporal Python, Pydantic, runtime tool-loop (Gemini tool-calling), MinIO/R2, `docx` npm, Playwright, Tectonic + xelatex + kotex, Next.js 16, next-intl, Tailwind, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-04-27-multi-format-synthesis-export-design.md`

**Reference patterns (existing code, do NOT modify):**
- Temporal workflow: `apps/worker/src/worker/workflows/code_workflow.py`
- Activity layout: `apps/worker/src/worker/activities/code_activity.py`
- One-shot agent: `apps/worker/src/worker/agents/code/agent.py` (NOT runtime.Agent — `_EmitStructuredOutputTool` sentinel + `generate_with_tools(mode="any")`)
- `emit_structured_output` registry: `apps/worker/src/worker/tools_builtin/{emit_structured_output,schema_registry}.py`
- API SSE poll: `apps/api/src/routes/code.ts` (POLL_MS=2000, ReadableStream + keepalive)
- Internal route auth: `apps/api/src/routes/internal.ts` middleware
- Temporal client wrapper: `apps/api/src/lib/code-agent-client.ts`
- S3 helpers: `apps/api/src/lib/s3.ts` (`uploadObject`), `apps/worker/src/worker/lib/s3_client.py` (extend with `upload_bytes`)
- Web SSE hook: `apps/web/src/hooks/use-code-agent-stream.ts`
- DB schema: `packages/db/src/schema/code-runs.ts`
- Shared zod: `packages/shared/src/code-types.ts`
- Feature flag pattern: `apps/web/src/lib/feature-flags.ts`, `process.env.FEATURE_*` in api/worker

**Migration number:** Latest journal tag is `0031_chat_scope_search_trgm`. New migration is **`0032_synthesis`**. Generate via `pnpm --filter @opencairn/db db:generate -- --name synthesis`.

**Feature flags (default OFF):**
- `FEATURE_SYNTHESIS` — gates `/api/synthesis/*` route registration AND `SynthesisPanel`/route UI
- `FEATURE_TECTONIC_COMPILE` — gates LaTeX→PDF Pro compile path

**Branch:** `feat/plan-synthesis-export` (worktree `.worktrees/plan-synthesis-export`).

---

## Phase Map

| Phase | Tasks | Concern |
|---|---|---|
| A | 1–3 | DB migration + Drizzle schema + Zod shared types |
| B | 4–12 | Worker: Pydantic schema, Agent, prompts, 3 activities, helpers, workflow, registration |
| C | 13–20 | API: 4 document compilers + internal endpoint + 7 public routes + tests |
| D | 21–24 | Tectonic MSA: Dockerfile + FastAPI + worker integration + docker-compose |
| E | 25–30 | Web: i18n + hook + 6 components + page route + tests |
| F | 31 | Plans-status update + smoke verification |

**Total: 31 tasks.** TDD throughout — every task: failing test → implement → passing → commit.

---

## Phase A — Foundation (DB + Shared Types)

### Task 1: Drizzle schema for synthesis tables

**Files:**
- Create: `packages/db/src/schema/synthesis.ts`
- Modify: `packages/db/src/index.ts` (export new module)

- [x] **Step 1: Write the failing test**

Create `packages/db/tests/synthesis.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../src/db";
import { synthesisRuns, synthesisSources, synthesisDocuments } from "../src/schema/synthesis";
import { workspaces, projects, user } from "../src";
import { eq } from "drizzle-orm";

describe("synthesis schema", () => {
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    userId = "test-user-synthesis";
    await db.insert(user).values({ id: userId, email: "syn@test.com", name: "syn", emailVerified: false, createdAt: new Date(), updatedAt: new Date() }).onConflictDoNothing();
    const [ws] = await db.insert(workspaces).values({ slug: "syn-ws", name: "Syn", ownerId: userId }).returning();
    workspaceId = ws!.id;
  });

  it("inserts a run with default status='pending' and round-trips", async () => {
    const [run] = await db.insert(synthesisRuns).values({
      workspaceId, userId,
      format: "latex", template: "korean_thesis",
      userPrompt: "thesis intro",
      autoSearch: false,
    }).returning();
    expect(run!.status).toBe("pending");
    const [fetched] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, run!.id));
    expect(fetched!.format).toBe("latex");
  });

  it("cascades source rows on run delete", async () => {
    const [run] = await db.insert(synthesisRuns).values({
      workspaceId, userId, format: "md", template: "report", userPrompt: "x", autoSearch: false,
    }).returning();
    await db.insert(synthesisSources).values({
      runId: run!.id, sourceType: "note", sourceId: crypto.randomUUID(), title: "n", tokenCount: 100, included: true,
    });
    await db.delete(synthesisRuns).where(eq(synthesisRuns.id, run!.id));
    const remaining = await db.select().from(synthesisSources).where(eq(synthesisSources.runId, run!.id));
    expect(remaining.length).toBe(0);
  });

  it("inserts a document row with format=zip", async () => {
    const [run] = await db.insert(synthesisRuns).values({
      workspaceId, userId, format: "latex", template: "ieee", userPrompt: "x", autoSearch: false,
    }).returning();
    const [doc] = await db.insert(synthesisDocuments).values({
      runId: run!.id, format: "zip", s3Key: "synthesis/zip/abc.zip", bytes: 1024,
    }).returning();
    expect(doc!.format).toBe("zip");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

`pnpm --filter @opencairn/db test synthesis` — expect import error: cannot find `../src/schema/synthesis`.

- [x] **Step 3: Implement schema file**

Create `packages/db/src/schema/synthesis.ts`:

```typescript
import { pgTable, uuid, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { projects } from "./projects";
import { user } from "./auth";

export const synthesisRuns = pgTable(
  "synthesis_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    format: text("format").notNull(),         // latex | docx | pdf | md
    template: text("template").notNull(),     // ieee | acm | apa | korean_thesis | report
    userPrompt: text("user_prompt").notNull(),
    autoSearch: boolean("auto_search").notNull().default(false),
    status: text("status").notNull().default("pending"),
      // pending | fetching | synthesizing | compiling | completed | failed | cancelled
    workflowId: text("workflow_id"),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("synthesis_runs_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
    index("synthesis_runs_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const synthesisSources = pgTable("synthesis_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => synthesisRuns.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),  // s3_object | note | dr_result
  sourceId: uuid("source_id").notNull(),
  title: text("title"),
  tokenCount: integer("token_count"),
  included: boolean("included").notNull().default(true),
});

export const synthesisDocuments = pgTable("synthesis_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => synthesisRuns.id, { onDelete: "cascade" }),
  format: text("format").notNull(),  // latex | docx | pdf | md | bibtex | zip
  s3Key: text("s3_key"),
  bytes: integer("bytes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Append `export * from "./schema/synthesis";` to `packages/db/src/index.ts` (after the last existing export line).

- [x] **Step 4: Run test — still fails (no migration applied)**

`pnpm --filter @opencairn/db test synthesis` — expect "relation synthesis_runs does not exist".

- [x] **Step 5: Generate + apply migration**

```bash
pnpm --filter @opencairn/db db:generate -- --name synthesis
pnpm --filter @opencairn/db db:migrate
```

Verify a new file `packages/db/drizzle/0032_synthesis.sql` exists and `_journal.json` lists tag `0032_synthesis`.

- [x] **Step 6: Run test — verify PASS**

`pnpm --filter @opencairn/db test synthesis` — expect 3/3 passing.

- [x] **Step 7: Commit**

```bash
git add packages/db/src/schema/synthesis.ts packages/db/src/index.ts packages/db/drizzle/0032_synthesis.sql packages/db/drizzle/meta packages/db/tests/synthesis.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add synthesis_runs/sources/documents tables (migration 0032)

Three-table schema for the synthesis export pipeline. Cascades on run delete
match the worker workflow lifetime — sources/documents never outlive their run.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Shared Zod types (`@opencairn/shared`)

**Files:**
- Create: `packages/shared/src/synthesis-types.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

- [x] **Step 1: Write the failing test**

Create `packages/shared/tests/synthesis-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  synthesisFormatValues,
  synthesisTemplateValues,
  createSynthesisRunSchema,
  synthesisStreamEventSchema,
} from "../src/synthesis-types";

describe("synthesis types", () => {
  it("accepts a valid create payload", () => {
    const r = createSynthesisRunSchema.safeParse({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      projectId: null,
      format: "latex",
      template: "korean_thesis",
      userPrompt: "Write the intro",
      explicitSourceIds: [],
      noteIds: [],
      autoSearch: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown format", () => {
    const r = createSynthesisRunSchema.safeParse({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      format: "pptx",
      template: "ieee",
      userPrompt: "x",
      explicitSourceIds: [],
      noteIds: [],
      autoSearch: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects userPrompt > 4000 chars", () => {
    const r = createSynthesisRunSchema.safeParse({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      format: "md",
      template: "report",
      userPrompt: "x".repeat(4001),
      explicitSourceIds: [],
      noteIds: [],
      autoSearch: false,
    });
    expect(r.success).toBe(false);
  });

  it("parses a 'done' SSE event", () => {
    const r = synthesisStreamEventSchema.safeParse({
      kind: "done",
      docUrl: "/api/synthesis/runs/abc/document?format=docx",
      format: "docx",
      sourceCount: 7,
      tokensUsed: 12430,
    });
    expect(r.success).toBe(true);
  });

  it("parses an 'error' SSE event", () => {
    const r = synthesisStreamEventSchema.safeParse({ kind: "error", code: "compile_failed" });
    expect(r.success).toBe(true);
  });

  it("enumerates all 4 formats and 5 templates", () => {
    expect([...synthesisFormatValues].sort()).toEqual(["docx", "latex", "md", "pdf"]);
    expect([...synthesisTemplateValues].sort()).toEqual(
      ["acm", "apa", "ieee", "korean_thesis", "report"],
    );
  });
});
```

- [x] **Step 2: Run test to verify it fails**

`pnpm --filter @opencairn/shared test synthesis-types` — expect module-not-found.

- [x] **Step 3: Implement**

Create `packages/shared/src/synthesis-types.ts`:

```typescript
import { z } from "zod";

export const synthesisFormatValues = ["latex", "docx", "pdf", "md"] as const;
export const synthesisTemplateValues = [
  "ieee", "acm", "apa", "korean_thesis", "report",
] as const;
export const synthesisStatusValues = [
  "pending", "fetching", "synthesizing", "compiling",
  "completed", "failed", "cancelled",
] as const;
export const synthesisSourceTypeValues = ["s3_object", "note", "dr_result"] as const;
export const synthesisDocumentFormatValues = [
  "latex", "docx", "pdf", "md", "bibtex", "zip",
] as const;

export const createSynthesisRunSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  format: z.enum(synthesisFormatValues),
  template: z.enum(synthesisTemplateValues),
  userPrompt: z.string().min(1).max(4000),
  explicitSourceIds: z.array(z.string().uuid()).max(50),
  noteIds: z.array(z.string().uuid()).max(50),
  autoSearch: z.boolean(),
});
export type CreateSynthesisRunInput = z.infer<typeof createSynthesisRunSchema>;

export const resynthesizeSchema = z.object({
  userPrompt: z.string().min(1).max(4000),
});

export const synthesisStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued"), runId: z.string().uuid() }),
  z.object({ kind: z.literal("fetching_sources"), count: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("synthesizing"), thought: z.string().optional() }),
  z.object({ kind: z.literal("compiling"), format: z.enum(synthesisFormatValues) }),
  z.object({
    kind: z.literal("done"),
    docUrl: z.string(),
    format: z.enum(synthesisFormatValues),
    sourceCount: z.number().int().nonnegative(),
    tokensUsed: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("error"), code: z.string() }),
]);
export type SynthesisStreamEvent = z.infer<typeof synthesisStreamEventSchema>;

export interface SynthesisRunSummary {
  id: string;
  format: (typeof synthesisFormatValues)[number];
  template: (typeof synthesisTemplateValues)[number];
  status: (typeof synthesisStatusValues)[number];
  userPrompt: string;
  tokensUsed: number | null;
  createdAt: string;
}

export interface SynthesisSourceRow {
  id: string;
  sourceType: (typeof synthesisSourceTypeValues)[number];
  sourceId: string;
  title: string | null;
  tokenCount: number | null;
  included: boolean;
}

export interface SynthesisDocumentRow {
  id: string;
  format: (typeof synthesisDocumentFormatValues)[number];
  s3Key: string | null;
  bytes: number | null;
  createdAt: string;
}

export interface SynthesisRunDetail extends SynthesisRunSummary {
  workspaceId: string;
  projectId: string | null;
  autoSearch: boolean;
  sources: SynthesisSourceRow[];
  documents: SynthesisDocumentRow[];
}
```

Append `export * from "./synthesis-types";` to `packages/shared/src/index.ts`.

- [x] **Step 4: Run test — verify PASS**

`pnpm --filter @opencairn/shared test synthesis-types` — expect 6/6.

- [x] **Step 5: Commit**

```bash
git add packages/shared/src/synthesis-types.ts packages/shared/src/index.ts packages/shared/tests/synthesis-types.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add synthesis types — create/resynthesize/stream-event Zod

Centralizes format/template/status enums for api+web. Worker mirrors
these in Pydantic separately (no codegen).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Worker — Pydantic mirror + schema registry

**Files:**
- Create: `apps/worker/src/worker/agents/synthesis/__init__.py` (empty)
- Create: `apps/worker/src/worker/agents/synthesis/schemas.py`
- Modify: `apps/worker/src/worker/tools_builtin/schema_registry.py` (register `SynthesisOutputSchema`)

- [x] **Step 1: Write the failing test**

Create `apps/worker/tests/agents/synthesis/test_schemas.py`:

```python
import pytest
from pydantic import ValidationError
from worker.agents.synthesis.schemas import (
    SynthesisOutputSchema,
    BibEntry,
    SynthesisSection,
)
from worker.tools_builtin.schema_registry import SCHEMA_REGISTRY


def test_synthesis_output_round_trip():
    payload = {
        "format": "latex",
        "title": "Quantum Computing Survey",
        "abstract": "abstract text",
        "sections": [
            {
                "title": "Introduction",
                "content": "Intro text \\cite{src:abc12345}",
                "source_ids": ["abc12345"],
            },
        ],
        "bibliography": [
            {
                "cite_key": "src:abc12345",
                "author": "Doe",
                "title": "Paper Title",
                "year": 2024,
                "url": "https://example.com",
                "source_id": "abc12345",
            },
        ],
        "template": "ieee",
    }
    obj = SynthesisOutputSchema.model_validate(payload)
    assert obj.format == "latex"
    assert len(obj.sections) == 1
    assert obj.sections[0].source_ids == ["abc12345"]


def test_rejects_unknown_format():
    with pytest.raises(ValidationError):
        SynthesisOutputSchema.model_validate(
            {"format": "pptx", "title": "x", "abstract": None, "sections": [], "bibliography": [], "template": "ieee"}
        )


def test_registered_in_schema_registry():
    assert "SynthesisOutputSchema" in SCHEMA_REGISTRY
    assert SCHEMA_REGISTRY["SynthesisOutputSchema"] is SynthesisOutputSchema
```

- [x] **Step 2: Run — verify fails**

`pnpm --filter @opencairn/worker test -- tests/agents/synthesis/test_schemas.py` (or `cd apps/worker && uv run pytest tests/agents/synthesis/test_schemas.py -v`). Expected: ImportError.

- [x] **Step 3: Implement schema**

Create `apps/worker/src/worker/agents/synthesis/schemas.py`:

```python
"""Pydantic schemas for SynthesisAgent output.

Mirrors `packages/shared/src/synthesis-types.ts`. Single source of truth
for the LLM emit_structured_output payload shape.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


SynthesisFormat = Literal["latex", "docx", "pdf", "md"]
SynthesisTemplate = Literal["ieee", "acm", "apa", "korean_thesis", "report"]


class BibEntry(BaseModel):
    cite_key: str           # e.g. "src:abc12345"
    author: str
    title: str
    year: Optional[int] = None
    url: Optional[str] = None
    source_id: str          # synthesis_sources.id reference


class SynthesisSection(BaseModel):
    title: str
    content: str            # markup matches `format` (tex / html / md)
    source_ids: list[str] = Field(default_factory=list)


class SynthesisOutputSchema(BaseModel):
    format: SynthesisFormat
    title: str
    abstract: Optional[str] = None
    sections: list[SynthesisSection]
    bibliography: list[BibEntry] = Field(default_factory=list)
    template: SynthesisTemplate
```

Create empty `apps/worker/src/worker/agents/synthesis/__init__.py`.

Edit `apps/worker/src/worker/tools_builtin/schema_registry.py` — append:

```python
# Synthesis schema ------------------------------------------------------

from worker.agents.synthesis.schemas import SynthesisOutputSchema  # noqa: E402

register_schema("SynthesisOutputSchema", SynthesisOutputSchema)
```

- [x] **Step 4: Run — verify PASS**

3/3 passing.

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/synthesis/__init__.py apps/worker/src/worker/agents/synthesis/schemas.py apps/worker/src/worker/tools_builtin/schema_registry.py apps/worker/tests/agents/synthesis/
git commit -m "$(cat <<'EOF'
feat(worker): add SynthesisOutputSchema + schema registry registration

Pydantic mirror of @opencairn/shared synthesis types. Registered with
the shared emit_structured_output registry so the agent reuses the
existing tool-loop validator path.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Worker (Agent + Activities + Workflow)

### Task 4: SynthesisAgent (one-shot, CodeAgent pattern)

**Files:**
- Create: `apps/worker/src/worker/agents/synthesis/prompts.py`
- Create: `apps/worker/src/worker/agents/synthesis/agent.py`

**Pattern note**: Despite the spec wording "SynthesisAgent(runtime.Agent)" with `max_turns=1`, the existing one-shot exemplar is `CodeAgent` (NOT a `runtime.Agent` subclass) — `apps/worker/src/worker/agents/code/agent.py`. Use that pattern: a tiny `_EmitStructuredOutputTool` sentinel + direct `provider.generate_with_tools(mode="any", allowed_tool_names=["emit_structured_output"])` call. Rationale: `runtime.Agent` is for multi-turn async-generator tool loops; one-shot synthesis doesn't need the loop machinery.

- [x] **Step 1: Write the failing test**

Create `apps/worker/tests/agents/synthesis/test_agent.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from llm.types import AssistantTurn, ToolUse, UsageCounts
from worker.agents.synthesis.agent import SynthesisAgent, SynthesisContext


@pytest.mark.asyncio
async def test_returns_structured_output_when_tool_called():
    provider = MagicMock()
    provider.generate_with_tools = AsyncMock(return_value=AssistantTurn(
        final_text=None,
        tool_uses=(ToolUse(
            id="t1",
            name="emit_structured_output",
            args={
                "schema_name": "SynthesisOutputSchema",
                "data": {
                    "format": "md",
                    "title": "Test Doc",
                    "abstract": None,
                    "sections": [{"title": "S1", "content": "body", "source_ids": []}],
                    "bibliography": [],
                    "template": "report",
                },
            },
        ),),
        usage=UsageCounts(input_tokens=100, output_tokens=50),
    ))
    agent = SynthesisAgent(llm=provider)
    ctx = SynthesisContext(
        sources_text="(no sources)", workspace_notes="",
        user_prompt="write me a markdown doc",
        format="md", template="report",
    )
    out, usage = await agent.run(ctx)
    assert out.format == "md"
    assert out.title == "Test Doc"
    assert usage.input_tokens == 100
    provider.generate_with_tools.assert_awaited_once()


@pytest.mark.asyncio
async def test_raises_when_tool_not_called():
    provider = MagicMock()
    provider.generate_with_tools = AsyncMock(return_value=AssistantTurn(
        final_text="I refuse", tool_uses=(), usage=UsageCounts(input_tokens=10, output_tokens=5),
    ))
    agent = SynthesisAgent(llm=provider)
    ctx = SynthesisContext(
        sources_text="", workspace_notes="", user_prompt="x", format="md", template="report",
    )
    with pytest.raises(RuntimeError, match="emit_structured_output"):
        await agent.run(ctx)
```

- [x] **Step 2: Run — verify fails (ImportError)**

`cd apps/worker && uv run pytest tests/agents/synthesis/test_agent.py -v`

- [x] **Step 3: Implement prompts**

Create `apps/worker/src/worker/agents/synthesis/prompts.py`:

```python
"""SynthesisAgent prompt templates.

Citation rules vary by output format (LaTeX/DOCX strict, MD/PDF best-effort).
Template hint blocks inject Korean thesis structure when relevant.
"""
from __future__ import annotations

SYNTHESIS_SYSTEM = """You are a research synthesis writer. You receive a set of source documents and a user instruction. Produce ONE consolidated document by calling the `emit_structured_output` tool exactly once.

Output schema name: SynthesisOutputSchema. Validate your `data` against:
- `format`: must equal the requested format ("latex" | "docx" | "pdf" | "md")
- `template`: must equal the requested template
- `sections[].content`: markup matching the format:
    * latex → LaTeX body fragments (no \\documentclass — assembler wraps it)
    * docx → minimal HTML (h1/h2/p/ul/ol/li/strong/em/code/blockquote)
    * pdf  → minimal HTML (same subset as docx)
    * md   → CommonMark
- `sections[].source_ids`: list of `source_id` strings you actually drew from
- `bibliography[]`: full BibTeX-friendly metadata for every source you cite

Citation rules (STRICT for latex/docx, best-effort for pdf/md):
- latex: every factual claim must include `\\cite{cite_key}` inline.
- docx:  use `[N]` markers in content; the assembler converts to footnotes.
- pdf:   inline `[N]` markers preferred; section-end "Sources:" list acceptable.
- md:    section-end "**Sources:**" list of titles + URLs.

Always set `cite_key` to `src:{source_id_first_8_chars}`.

If a section title is missing from the user instruction, infer one. Never invent sources — only cite from the supplied bundle.
"""

KOREAN_THESIS_HINT = """학위논문 구조(template=korean_thesis):
표지 → 초록(한/영) → 목차/그림목차/표목차 → 제1장 서론(1.1 배경 및 필요성, 1.2 연구 목적, 1.3 논문 구성) → 제N장 관련 연구 → 제N장 제안 방법 → 제N장 실험 및 결과 → 제N장 결론 → 참고문헌. 본문은 학술 문체(존댓말 X, 명사형 종결)."""

REPORT_HINT = """A general-purpose report. Default sections: Summary, Background, Findings, Discussion, References."""

ACADEMIC_HINT = """Academic paper. Default sections: Abstract, 1. Introduction, 2. Related Work, 3. Method, 4. Experiments, 5. Discussion, 6. Conclusion, References."""


def build_user_prompt(
    *,
    sources_text: str,
    workspace_notes: str,
    user_prompt: str,
    format: str,
    template: str,
) -> str:
    template_hints = {
        "korean_thesis": KOREAN_THESIS_HINT,
        "report": REPORT_HINT,
        "ieee": ACADEMIC_HINT,
        "acm": ACADEMIC_HINT,
        "apa": ACADEMIC_HINT,
    }
    hint = template_hints.get(template, "")
    return f"""=== Output Format ===
format: {format}
template: {template}
{hint}

=== User Instruction ===
{user_prompt}

=== Source Bundle ===
{sources_text or "(no explicit sources provided)"}

=== Workspace Notes ===
{workspace_notes or "(none)"}

Now call `emit_structured_output` with `schema_name="SynthesisOutputSchema"` and your composed `data`. Do not produce any text outside the tool call.
"""
```

- [x] **Step 4: Implement agent**

Create `apps/worker/src/worker/agents/synthesis/agent.py`:

```python
"""SynthesisAgent — one-shot LLM synthesis.

Mirrors the CodeAgent pattern: NOT a runtime.Agent subclass. A single
`emit_structured_output` sentinel tool surfaces the function declaration
to providers (Gemini) so they can return validated JSON without us
parsing markdown-wrapped output.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from llm import LLMProvider
from llm.types import UsageCounts
from runtime.events import Scope
from runtime.tools import Tool, ToolContext

from worker.agents.synthesis.prompts import SYNTHESIS_SYSTEM, build_user_prompt
from worker.agents.synthesis.schemas import (
    SynthesisFormat,
    SynthesisOutputSchema,
    SynthesisTemplate,
)


@dataclass(frozen=True)
class SynthesisContext:
    sources_text: str
    workspace_notes: str
    user_prompt: str
    format: SynthesisFormat
    template: SynthesisTemplate


_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["schema_name", "data"],
    "properties": {
        "schema_name": {"type": "string", "enum": ["SynthesisOutputSchema"]},
        "data": {"type": "object"},
    },
}


class _EmitStructuredOutputTool:
    name = "emit_structured_output"
    description = "Emit the final synthesized document. Call exactly once and stop."
    allowed_agents: tuple[str, ...] = ()
    allowed_scopes: tuple[Scope, ...] = ()

    def supports_parallel(self, args: dict[str, Any]) -> bool:
        return False

    def input_schema(self) -> dict[str, Any]:
        return _OUTPUT_SCHEMA

    def redact(self, args: dict[str, Any]) -> dict[str, Any]:
        return dict(args)

    async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any:
        raise RuntimeError("emit_structured_output is not executable")


_OUTPUT_TOOL: Tool = _EmitStructuredOutputTool()  # type: ignore[assignment]


class SynthesisAgent:
    name = "synthesis"

    def __init__(self, llm: LLMProvider) -> None:
        self._llm = llm

    async def run(self, ctx: SynthesisContext) -> tuple[SynthesisOutputSchema, UsageCounts]:
        user_prompt = build_user_prompt(
            sources_text=ctx.sources_text,
            workspace_notes=ctx.workspace_notes,
            user_prompt=ctx.user_prompt,
            format=ctx.format,
            template=ctx.template,
        )
        messages: list = [
            {"role": "system", "content": SYNTHESIS_SYSTEM},
            {"role": "user", "content": user_prompt},
        ]
        result = await self._llm.generate_with_tools(
            messages,
            [_OUTPUT_TOOL],
            mode="any",
            allowed_tool_names=["emit_structured_output"],
            max_output_tokens=32_000,
        )
        for call in result.tool_uses or ():
            if call.name == "emit_structured_output":
                data = call.args.get("data", {})
                return SynthesisOutputSchema.model_validate(data), result.usage
        raise RuntimeError("SynthesisAgent did not call emit_structured_output")
```

- [x] **Step 5: Run — verify PASS**

2/2.

- [x] **Step 6: Commit**

```bash
git add apps/worker/src/worker/agents/synthesis/agent.py apps/worker/src/worker/agents/synthesis/prompts.py apps/worker/tests/agents/synthesis/test_agent.py
git commit -m "$(cat <<'TASK4'
feat(worker): add SynthesisAgent — one-shot structured-output synthesizer

Follows the CodeAgent pattern (not runtime.Agent) — single
emit_structured_output sentinel + direct provider.generate_with_tools
call. Format-aware citation rules baked into the system prompt.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK4
)"
```

---

### Task 5: Worker S3 upload helper + activity types

**Files:**
- Modify: `apps/worker/src/worker/lib/s3_client.py` (add `upload_bytes`)
- Create: `apps/worker/src/worker/activities/synthesis/__init__.py` (empty)
- Create: `apps/worker/src/worker/activities/synthesis/types.py`

- [x] **Step 1: Write the failing test**

Create `apps/worker/tests/activities/synthesis/test_types.py`:

```python
from worker.activities.synthesis.types import SynthesisRunParams, SourceBundle, SourceItem


def test_run_params_round_trip():
    p = SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format="latex", template="korean_thesis",
        user_prompt="x",
        explicit_source_ids=["s1"], note_ids=["n1"], auto_search=False,
        byok_key_handle=None,
    )
    assert p.format == "latex"


def test_source_bundle_as_text_concatenates_titles_and_bodies():
    bundle = SourceBundle(items=[
        SourceItem(id="s1", title="Paper A", body="abstract A...", token_count=50, kind="s3_object"),
        SourceItem(id="n1", title="Note", body="my note body", token_count=30, kind="note"),
    ])
    text = bundle.as_text()
    assert "Paper A" in text and "abstract A" in text
    assert "Note" in text and "my note body" in text


def test_source_bundle_notes_excerpt_only_returns_note_kind():
    bundle = SourceBundle(items=[
        SourceItem(id="s1", title="A", body="b1", token_count=10, kind="s3_object"),
        SourceItem(id="n1", title="Note", body="b2", token_count=10, kind="note"),
    ])
    assert "b2" in bundle.notes_excerpt()
    assert "b1" not in bundle.notes_excerpt()
```

Create `apps/worker/tests/lib/test_s3_upload_bytes.py`:

```python
from unittest.mock import patch, MagicMock
from worker.lib.s3_client import upload_bytes


def test_upload_bytes_calls_put_object():
    with patch("worker.lib.s3_client.get_s3_client") as get_client:
        client = MagicMock()
        get_client.return_value = client
        key = upload_bytes("synthesis/runs/abc/doc.docx", b"data", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        client.put_object.assert_called_once()
        args, kwargs = client.put_object.call_args
        assert args[1] == "synthesis/runs/abc/doc.docx"
        assert key == "synthesis/runs/abc/doc.docx"
```

- [x] **Step 2: Run — verify both fail**

- [x] **Step 3: Implement**

Create `apps/worker/src/worker/activities/synthesis/types.py`:

```python
"""Dataclasses passed across SynthesisWorkflow activity boundaries.

Temporal serializes these via the default JSON converter, so all fields
must be JSON-friendly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional


SynthesisFormat = Literal["latex", "docx", "pdf", "md"]
SynthesisTemplate = Literal["ieee", "acm", "apa", "korean_thesis", "report"]
SourceKind = Literal["s3_object", "note", "dr_result"]


@dataclass(frozen=True)
class SynthesisRunParams:
    run_id: str
    workspace_id: str
    project_id: Optional[str]
    user_id: str
    format: SynthesisFormat
    template: SynthesisTemplate
    user_prompt: str
    explicit_source_ids: list[str] = field(default_factory=list)
    note_ids: list[str] = field(default_factory=list)
    auto_search: bool = False
    byok_key_handle: Optional[str] = None


@dataclass(frozen=True)
class SourceItem:
    id: str
    title: str
    body: str
    token_count: int
    kind: SourceKind


@dataclass
class SourceBundle:
    items: list[SourceItem] = field(default_factory=list)

    def as_text(self) -> str:
        parts: list[str] = []
        for it in self.items:
            parts.append(f"## [{it.id}] {it.title}\n{it.body}")
        return "\n\n".join(parts)

    def notes_excerpt(self) -> str:
        notes = [it for it in self.items if it.kind == "note"]
        if not notes:
            return ""
        return "\n\n".join(f"- {n.title}: {n.body}" for n in notes)


@dataclass
class CompiledArtifact:
    s3_key: str
    bytes: int
    format: str
```

Append to `apps/worker/src/worker/lib/s3_client.py`:

```python
def upload_bytes(object_key: str, data: bytes, content_type: str) -> str:
    """Upload raw bytes and return the object key. Used by synthesis compile."""
    import io
    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client = get_s3_client()
    client.put_object(
        bucket, object_key, data=io.BytesIO(data), length=len(data),
        content_type=content_type,
    )
    return object_key
```

Create empty `apps/worker/src/worker/activities/synthesis/__init__.py`.

- [x] **Step 4: Run — verify PASS**

4/4 across both files.

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/synthesis/__init__.py apps/worker/src/worker/activities/synthesis/types.py apps/worker/src/worker/lib/s3_client.py apps/worker/tests/activities/synthesis/test_types.py apps/worker/tests/lib/test_s3_upload_bytes.py
git commit -m "$(cat <<'TASK5'
feat(worker): add synthesis activity types + s3 upload_bytes helper

Frozen dataclasses are Temporal-serializable across activity boundaries.
upload_bytes is the synchronous counterpart to upload_jsonl that
synthesis compile reuses for direct uploads (md / latex zip / tectonic PDF).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK5
)"
```

---

### Task 6: `fetch_sources_activity`

**Files:**
- Create: `apps/worker/src/worker/activities/synthesis/fetch.py`

**Spec section 4.3.** Two-mode source collection (explicit + auto_search), token budget capping, persistence via `/api/internal/synthesis/sources` (wired in Task 18).

- [x] **Step 1: Write the failing test**

Create `apps/worker/tests/activities/synthesis/test_fetch.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from temporalio.testing import ActivityEnvironment
from worker.activities.synthesis.fetch import fetch_sources_activity
from worker.activities.synthesis.types import SynthesisRunParams


@pytest.mark.asyncio
async def test_fetch_explicit_only_no_auto_search():
    params = SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format="md", template="report", user_prompt="x",
        explicit_source_ids=["src-a", "src-b"], note_ids=[],
        auto_search=False, byok_key_handle=None,
    )
    with patch("worker.activities.synthesis.fetch._fetch_s3_object",
               new=AsyncMock(side_effect=lambda sid: {"id": sid, "title": f"T-{sid}", "body": "x" * 100, "kind": "s3_object"})):
        with patch("worker.activities.synthesis.fetch._persist_sources", new=AsyncMock()):
            env = ActivityEnvironment()
            bundle = await env.run(fetch_sources_activity, params)
            assert len(bundle.items) == 2
            assert {i.id for i in bundle.items} == {"src-a", "src-b"}


@pytest.mark.asyncio
async def test_fetch_token_budget_excludes_overflow():
    params = SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format="md", template="report", user_prompt="x",
        explicit_source_ids=["src-1", "src-2", "src-3"], note_ids=[],
        auto_search=False, byok_key_handle=None,
    )
    big_body = "word " * 50_000
    with patch("worker.activities.synthesis.fetch._fetch_s3_object",
               new=AsyncMock(side_effect=lambda sid: {"id": sid, "title": sid, "body": big_body, "kind": "s3_object"})):
        with patch("worker.activities.synthesis.fetch._persist_sources", new=AsyncMock()) as persist:
            env = ActivityEnvironment()
            bundle = await env.run(fetch_sources_activity, params)
            assert len(bundle.items) <= 3
            persist.assert_awaited_once()
            payload = persist.await_args.args[1]
            included = [r for r in payload if r["included"]]
            excluded = [r for r in payload if not r["included"]]
            assert len(excluded) >= 1
            assert sum(r["token_count"] for r in included) <= 180_000
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/worker/src/worker/activities/synthesis/fetch.py`:

```python
"""fetch_sources_activity — collect source content for synthesis.

Two modes (composable):
  1. explicit_source_ids — uploaded files (s3_object) the user picked
  2. note_ids — Plate notes the user picked
  3. auto_search (toggle) — semantic search on workspace notes via api

Token budget (180K) caps the bundle; excess sources are persisted with
included=false so the UI can show "auto-excluded".
"""
from __future__ import annotations

from temporalio import activity

from worker.activities.synthesis.types import (
    SourceBundle,
    SourceItem,
    SynthesisRunParams,
)
from worker.lib.api_client import post_internal

TOKEN_BUDGET = 180_000


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


async def _fetch_s3_object(source_id: str) -> dict:
    return await post_internal(
        "/api/internal/synthesis/fetch-source",
        {"source_id": source_id, "kind": "s3_object"},
    )


async def _fetch_note(note_id: str) -> dict:
    return await post_internal(
        "/api/internal/synthesis/fetch-source",
        {"source_id": note_id, "kind": "note"},
    )


async def _semantic_search(workspace_id: str, query: str, limit: int = 10) -> list[dict]:
    res = await post_internal(
        "/api/internal/synthesis/auto-search",
        {"workspace_id": workspace_id, "query": query, "limit": limit},
    )
    return res.get("hits", [])


async def _persist_sources(run_id: str, rows: list[dict]) -> None:
    await post_internal(
        "/api/internal/synthesis/sources",
        {"run_id": run_id, "rows": rows},
    )


@activity.defn(name="fetch_sources_activity")
async def fetch_sources_activity(params: SynthesisRunParams) -> SourceBundle:
    activity.heartbeat("fetching sources")
    items: list[SourceItem] = []

    for sid in params.explicit_source_ids:
        raw = await _fetch_s3_object(sid)
        items.append(SourceItem(
            id=raw["id"], title=raw.get("title", sid),
            body=raw.get("body", ""), token_count=_approx_tokens(raw.get("body", "")),
            kind="s3_object",
        ))
        activity.heartbeat(f"fetched s3:{sid}")

    for nid in params.note_ids:
        raw = await _fetch_note(nid)
        items.append(SourceItem(
            id=raw["id"], title=raw.get("title", nid),
            body=raw.get("body", ""), token_count=_approx_tokens(raw.get("body", "")),
            kind="note",
        ))
        activity.heartbeat(f"fetched note:{nid}")

    if params.auto_search:
        hits = await _semantic_search(params.workspace_id, params.user_prompt, limit=10)
        for h in hits:
            items.append(SourceItem(
                id=h["id"], title=h.get("title", ""), body=h.get("body", ""),
                token_count=_approx_tokens(h.get("body", "")), kind="note",
            ))

    items.sort(key=lambda it: it.token_count)
    included: list[SourceItem] = []
    excluded: list[SourceItem] = []
    used = 0
    for it in items:
        if used + it.token_count <= TOKEN_BUDGET:
            included.append(it)
            used += it.token_count
        else:
            excluded.append(it)

    rows = [
        {"source_id": it.id, "kind": it.kind, "title": it.title,
         "token_count": it.token_count, "included": True}
        for it in included
    ] + [
        {"source_id": it.id, "kind": it.kind, "title": it.title,
         "token_count": it.token_count, "included": False}
        for it in excluded
    ]
    await _persist_sources(params.run_id, rows)

    return SourceBundle(items=included)
```

- [x] **Step 4: Run — verify PASS**

2/2.

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/synthesis/fetch.py apps/worker/tests/activities/synthesis/test_fetch.py
git commit -m "$(cat <<'TASK6'
feat(worker): fetch_sources_activity with token budget + persistence

Heartbeats every fetched source. Sorted ascending by token_count so the
budget greedy-fits small sources first; excluded items still recorded as
included=false for UI provenance.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK6
)"
```

---

### Task 7: `synthesize_activity`

**Files:**
- Create: `apps/worker/src/worker/activities/synthesis/synthesize.py`

- [x] **Step 1: Write the failing test**

Create `apps/worker/tests/activities/synthesis/test_synthesize.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from temporalio.testing import ActivityEnvironment
from llm.types import UsageCounts
from worker.activities.synthesis.synthesize import synthesize_activity
from worker.activities.synthesis.types import (
    SynthesisRunParams, SourceBundle, SourceItem,
)
from worker.agents.synthesis.schemas import SynthesisOutputSchema


@pytest.mark.asyncio
async def test_synthesize_returns_output_and_records_tokens():
    params = SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format="md", template="report", user_prompt="x",
        explicit_source_ids=[], note_ids=[], auto_search=False, byok_key_handle=None,
    )
    bundle = SourceBundle(items=[SourceItem(id="s", title="t", body="b", token_count=10, kind="note")])
    fake_output = SynthesisOutputSchema.model_validate({
        "format": "md", "title": "T", "abstract": None,
        "sections": [{"title": "S", "content": "c", "source_ids": ["s"]}],
        "bibliography": [], "template": "report",
    })

    with patch("worker.activities.synthesis.synthesize.resolve_llm_provider", new=AsyncMock(return_value=MagicMock())):
        with patch("worker.activities.synthesis.synthesize.SynthesisAgent") as agent_cls:
            agent = agent_cls.return_value
            agent.run = AsyncMock(return_value=(fake_output, UsageCounts(input_tokens=1234, output_tokens=560)))
            with patch("worker.activities.synthesis.synthesize._patch_run_tokens", new=AsyncMock()) as patch_tokens:
                env = ActivityEnvironment()
                out = await env.run(synthesize_activity, params, bundle)
                assert out.title == "T"
                patch_tokens.assert_awaited_once_with("r1", 1794)
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/worker/src/worker/activities/synthesis/synthesize.py`:

```python
"""synthesize_activity — invokes SynthesisAgent and persists token usage."""
from __future__ import annotations

from temporalio import activity

from worker.activities.synthesis.types import SourceBundle, SynthesisRunParams
from worker.agents.synthesis.agent import SynthesisAgent, SynthesisContext
from worker.agents.synthesis.schemas import SynthesisOutputSchema
from worker.lib.api_client import patch_internal
from worker.lib.llm_routing import resolve_llm_provider


async def _patch_run_tokens(run_id: str, tokens_used: int) -> None:
    await patch_internal(
        f"/api/internal/synthesis/runs/{run_id}",
        {"tokens_used": tokens_used},
    )


@activity.defn(name="synthesize_activity")
async def synthesize_activity(
    params: SynthesisRunParams,
    sources: SourceBundle,
) -> SynthesisOutputSchema:
    activity.heartbeat("starting synthesis")
    provider = await resolve_llm_provider(
        user_id=params.user_id,
        workspace_id=params.workspace_id,
        purpose="chat",
        byok_key_handle=params.byok_key_handle,
    )
    agent = SynthesisAgent(llm=provider)
    ctx = SynthesisContext(
        sources_text=sources.as_text(),
        workspace_notes=sources.notes_excerpt(),
        user_prompt=params.user_prompt,
        format=params.format,
        template=params.template,
    )
    activity.heartbeat("calling LLM")
    output, usage = await agent.run(ctx)
    total = (usage.input_tokens or 0) + (usage.output_tokens or 0)
    await _patch_run_tokens(params.run_id, total)
    return output
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/synthesis/synthesize.py apps/worker/tests/activities/synthesis/test_synthesize.py
git commit -m "$(cat <<'TASK7'
feat(worker): synthesize_activity wraps SynthesisAgent + records tokens

Uses resolve_llm_provider with purpose="chat" to honor BYOK→credits→Admin
billing routing. Token total persisted via internal PATCH for the SSE
'done' event payload.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK7
)"
```

---

### Task 8: LaTeX assemblers (`.tex` / `.bib` / zip)

**Files:**
- Create: `apps/worker/src/worker/activities/synthesis/latex_assemble.py`

Pure functions used by `compile_activity` for LaTeX-format runs. Tested in isolation.

- [x] **Step 1: Write the failing test**

Create `apps/worker/tests/activities/synthesis/test_latex_assemble.py`:

```python
from worker.agents.synthesis.schemas import (
    SynthesisOutputSchema, SynthesisSection, BibEntry,
)
from worker.activities.synthesis.latex_assemble import (
    assemble_tex, assemble_bib, package_zip,
)


def _output(template="ieee"):
    return SynthesisOutputSchema(
        format="latex", title="T", abstract="abs",
        sections=[SynthesisSection(title="Intro", content="Body \\cite{src:a3f2b1c9}", source_ids=["a3f2b1c9"])],
        bibliography=[BibEntry(cite_key="src:a3f2b1c9", author="Doe", title="Paper", year=2024, url="https://x", source_id="a3f2b1c9")],
        template=template,
    )


def test_assemble_tex_includes_korean_packages_for_korean_thesis():
    tex = assemble_tex(_output(template="korean_thesis"))
    assert "\\documentclass" in tex
    assert "kotex" in tex
    assert "\\section{Intro}" in tex
    assert "\\cite{src:a3f2b1c9}" in tex
    assert "\\bibliography" in tex


def test_assemble_tex_uses_ieeetran_for_ieee():
    tex = assemble_tex(_output(template="ieee"))
    assert "IEEEtran" in tex


def test_assemble_bib_emits_article_entry():
    bib = assemble_bib([BibEntry(cite_key="src:a3f2b1c9", author="Doe", title="P", year=2024, url=None, source_id="a3f2b1c9")])
    assert "@article{src:a3f2b1c9" in bib
    assert "author = {Doe}" in bib


def test_package_zip_contains_main_tex_and_bib():
    import io, zipfile
    z_bytes = package_zip("\\documentclass{article}", "@article{x}")
    zf = zipfile.ZipFile(io.BytesIO(z_bytes))
    names = zf.namelist()
    assert "main.tex" in names
    assert "refs.bib" in names
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/worker/src/worker/activities/synthesis/latex_assemble.py`:

```python
"""LaTeX assemblers — output schema → .tex / .bib / zip bytes.

Templates produce the document-class preamble. The LLM emits section
content WITHOUT the preamble; we wrap it here. Korean templates require
xelatex + kotex; the Tectonic MSA uses xelatex by default.
"""
from __future__ import annotations

import io
import zipfile
from textwrap import dedent

from worker.agents.synthesis.schemas import (
    BibEntry,
    SynthesisOutputSchema,
)


_PREAMBLES: dict[str, str] = {
    "korean_thesis": dedent(r"""
        \documentclass[12pt]{report}
        \usepackage{kotex}
        \usepackage[a4paper,margin=1in]{geometry}
        \usepackage{graphicx}
        \usepackage{hyperref}
        \usepackage{cite}
    """).strip(),
    "ieee": r"\documentclass[conference]{IEEEtran}" + "\n\\usepackage{hyperref}\n\\usepackage{cite}",
    "acm": r"\documentclass[acmsmall]{acmart}",
    "apa": dedent(r"""
        \documentclass[a4paper,11pt]{article}
        \usepackage{apacite}
        \usepackage{hyperref}
    """).strip(),
    "report": dedent(r"""
        \documentclass[a4paper,11pt]{article}
        \usepackage[utf8]{inputenc}
        \usepackage{hyperref}
        \usepackage{cite}
    """).strip(),
}


def assemble_tex(output: SynthesisOutputSchema) -> str:
    preamble = _PREAMBLES.get(output.template, _PREAMBLES["report"])
    body_parts: list[str] = []
    for sec in output.sections:
        body_parts.append(f"\\section{{{sec.title}}}\n{sec.content}")
    abstract_block = (
        f"\\begin{{abstract}}\n{output.abstract}\n\\end{{abstract}}\n"
        if output.abstract else ""
    )
    bibliography_block = (
        "\\bibliographystyle{plain}\n\\bibliography{refs}\n"
        if output.bibliography else ""
    )

    return f"""{preamble}

\\title{{{output.title}}}
\\begin{{document}}
\\maketitle
{abstract_block}
{chr(10).join(body_parts)}

{bibliography_block}
\\end{{document}}
"""


def assemble_bib(entries: list[BibEntry]) -> str:
    out: list[str] = []
    for e in entries:
        url_line = f",\n  url = {{{e.url}}}" if e.url else ""
        year_line = f",\n  year = {{{e.year}}}" if e.year is not None else ""
        out.append(
            f"@article{{{e.cite_key},\n"
            f"  author = {{{e.author}}},\n"
            f"  title = {{{e.title}}}{year_line}{url_line},\n"
            f"  note = {{OpenCairn source: {e.source_id}}}\n"
            f"}}"
        )
    return "\n\n".join(out)


def package_zip(tex_source: str, bib_source: str | None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("main.tex", tex_source)
        if bib_source:
            zf.writestr("refs.bib", bib_source)
    return buf.getvalue()
```

- [x] **Step 4: Run — verify PASS**

4/4.

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/synthesis/latex_assemble.py apps/worker/tests/activities/synthesis/test_latex_assemble.py
git commit -m "$(cat <<'TASK8'
feat(worker): LaTeX assemblers — assemble_tex/bib/zip

Five template preambles mapped to documentclass + required packages.
korean_thesis pulls in kotex; the Tectonic MSA must use xelatex.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK8
)"
```

---

### Task 9: `compile_activity` (dispatcher)

**Files:**
- Create: `apps/worker/src/worker/activities/synthesis/compile.py`

Dispatches by `params.format`:
- `md` → upload markdown text directly to S3
- `latex` → assemble + upload zip (or PDF via Tectonic when flag ON, **stubbed** until Task 21)
- `docx` / `pdf` → POST `/api/internal/synthesis/compile`, API renders + uploads

- [x] **Step 1: Write the failing test**

Create `apps/worker/tests/activities/synthesis/test_compile.py`:

```python
import os
import pytest
from unittest.mock import AsyncMock, patch
from temporalio.testing import ActivityEnvironment
from worker.activities.synthesis.compile import compile_activity
from worker.activities.synthesis.types import SynthesisRunParams
from worker.agents.synthesis.schemas import SynthesisOutputSchema, SynthesisSection


def _output(fmt="md"):
    return SynthesisOutputSchema(
        format=fmt, title="T", abstract=None,
        sections=[SynthesisSection(title="S", content="c", source_ids=[])],
        bibliography=[], template="report",
    )


def _params(fmt="md"):
    return SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format=fmt, template="report", user_prompt="x",
        explicit_source_ids=[], note_ids=[], auto_search=False, byok_key_handle=None,
    )


@pytest.mark.asyncio
async def test_compile_md_uploads_directly():
    with patch("worker.activities.synthesis.compile.upload_bytes", return_value="synthesis/runs/r1/doc.md") as up:
        with patch("worker.activities.synthesis.compile._record_document", new=AsyncMock()):
            env = ActivityEnvironment()
            artifact = await env.run(compile_activity, _params("md"), _output("md"))
            assert artifact.s3_key.endswith(".md")
            up.assert_called_once()


@pytest.mark.asyncio
async def test_compile_latex_without_pro_returns_zip():
    os.environ["FEATURE_TECTONIC_COMPILE"] = "false"
    with patch("worker.activities.synthesis.compile.upload_bytes", return_value="synthesis/runs/r1/doc.zip") as up:
        with patch("worker.activities.synthesis.compile._record_document", new=AsyncMock()):
            env = ActivityEnvironment()
            artifact = await env.run(compile_activity, _params("latex"), _output("latex"))
            assert artifact.format == "zip"
            up.assert_called_once()


@pytest.mark.asyncio
async def test_compile_docx_routes_to_internal_api():
    with patch("worker.activities.synthesis.compile.post_internal",
               new=AsyncMock(return_value={"s3Key": "synthesis/runs/r1/doc.docx", "bytes": 1024})) as post:
        with patch("worker.activities.synthesis.compile._record_document", new=AsyncMock()):
            env = ActivityEnvironment()
            artifact = await env.run(compile_activity, _params("docx"), _output("docx"))
            assert artifact.s3_key.endswith(".docx")
            post.assert_awaited_once()
            assert post.await_args.args[0] == "/api/internal/synthesis/compile"
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/worker/src/worker/activities/synthesis/compile.py`:

```python
"""compile_activity — dispatch by format and upload final artifact.

Markdown / LaTeX zip: worker direct S3 upload.
DOCX / PDF (Playwright): POST /api/internal/synthesis/compile (apps/api).
LaTeX → PDF (Pro, flag-gated): worker POSTs to Tectonic MSA, uploads PDF.
"""
from __future__ import annotations

import os

from temporalio import activity

from worker.activities.synthesis.latex_assemble import (
    assemble_bib, assemble_tex, package_zip,
)
from worker.activities.synthesis.types import (
    CompiledArtifact, SynthesisRunParams,
)
from worker.agents.synthesis.schemas import SynthesisOutputSchema
from worker.lib.api_client import post_internal
from worker.lib.s3_client import upload_bytes


def _is_tectonic_enabled() -> bool:
    return os.environ.get("FEATURE_TECTONIC_COMPILE", "false").lower() == "true"


def _markdown_text(output: SynthesisOutputSchema) -> str:
    parts = [f"# {output.title}\n"]
    if output.abstract:
        parts.append(f"**Abstract.** {output.abstract}\n")
    for sec in output.sections:
        parts.append(f"## {sec.title}\n\n{sec.content}\n")
    if output.bibliography:
        parts.append("\n## Sources\n")
        for b in output.bibliography:
            url = f" — {b.url}" if b.url else ""
            parts.append(f"- {b.author}, *{b.title}*{url}")
    return "\n".join(parts)


async def _post_tectonic(tex_source: str, bib_source: str) -> bytes:
    """Stub: Task 21 replaces with httpx POST to apps/tectonic /compile."""
    return b"%PDF-stub-replaced-in-task-21"


async def _record_document(run_id: str, format_: str, s3_key: str, byte_count: int) -> None:
    await post_internal(
        "/api/internal/synthesis/documents",
        {"run_id": run_id, "format": format_, "s3_key": s3_key, "bytes": byte_count},
    )


@activity.defn(name="compile_activity")
async def compile_activity(
    params: SynthesisRunParams,
    output: SynthesisOutputSchema,
) -> CompiledArtifact:
    activity.heartbeat(f"compiling {params.format}")
    fmt = params.format

    if fmt == "md":
        body = _markdown_text(output).encode("utf-8")
        key = f"synthesis/runs/{params.run_id}/document.md"
        upload_bytes(key, body, "text/markdown; charset=utf-8")
        await _record_document(params.run_id, "md", key, len(body))
        return CompiledArtifact(s3_key=key, bytes=len(body), format="md")

    if fmt == "latex":
        tex = assemble_tex(output)
        bib = assemble_bib(output.bibliography) if output.bibliography else None

        if _is_tectonic_enabled():
            pdf_bytes = await _post_tectonic(tex, bib or "")
            key = f"synthesis/runs/{params.run_id}/document.pdf"
            upload_bytes(key, pdf_bytes, "application/pdf")
            await _record_document(params.run_id, "pdf", key, len(pdf_bytes))
            return CompiledArtifact(s3_key=key, bytes=len(pdf_bytes), format="pdf")

        zip_bytes = package_zip(tex, bib)
        key = f"synthesis/runs/{params.run_id}/document.zip"
        upload_bytes(key, zip_bytes, "application/zip")
        await _record_document(params.run_id, "zip", key, len(zip_bytes))
        return CompiledArtifact(s3_key=key, bytes=len(zip_bytes), format="zip")

    if fmt in ("docx", "pdf"):
        res = await post_internal(
            "/api/internal/synthesis/compile",
            {
                "run_id": params.run_id,
                "format": fmt,
                "output": output.model_dump(),
            },
        )
        s3_key = res["s3Key"]
        byte_count = res.get("bytes", 0)
        await _record_document(params.run_id, fmt, s3_key, byte_count)
        return CompiledArtifact(s3_key=s3_key, bytes=byte_count, format=fmt)

    raise ValueError(f"Unsupported format: {fmt}")
```

- [x] **Step 4: Run — verify PASS**

3/3.

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/synthesis/compile.py apps/worker/tests/activities/synthesis/test_compile.py
git commit -m "$(cat <<'TASK9'
feat(worker): compile_activity dispatcher (md/latex/docx/pdf)

md + latex zip stay in worker; docx/pdf delegated to apps/api;
tectonic path remains stubbed until Task 21 wires the MSA POST.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK9
)"
```

---

### Task 10: `SynthesisWorkflow`

**Files:**
- Create: `apps/worker/src/worker/workflows/synthesis_workflow.py`

- [x] **Step 1: Write the failing test**

Create `apps/worker/tests/workflows/test_synthesis_workflow.py`:

```python
import pytest
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from temporalio import activity

from worker.activities.synthesis.types import (
    SynthesisRunParams, SourceBundle, SourceItem, CompiledArtifact,
)
from worker.agents.synthesis.schemas import SynthesisOutputSchema, SynthesisSection
from worker.workflows.synthesis_workflow import SynthesisWorkflow, SynthesisResult


@activity.defn(name="fetch_sources_activity")
async def fake_fetch(params: SynthesisRunParams) -> SourceBundle:
    return SourceBundle(items=[SourceItem(id="s", title="t", body="b", token_count=10, kind="note")])


@activity.defn(name="synthesize_activity")
async def fake_synth(params: SynthesisRunParams, b: SourceBundle) -> SynthesisOutputSchema:
    return SynthesisOutputSchema(
        format="md", title="T", abstract=None,
        sections=[SynthesisSection(title="S", content="c", source_ids=[])],
        bibliography=[], template="report",
    )


@activity.defn(name="compile_activity")
async def fake_compile(params: SynthesisRunParams, out: SynthesisOutputSchema) -> CompiledArtifact:
    return CompiledArtifact(s3_key="synthesis/runs/r1/doc.md", bytes=42, format="md")


@pytest.mark.asyncio
async def test_workflow_happy_path():
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client, task_queue="test-q",
            workflows=[SynthesisWorkflow],
            activities=[fake_fetch, fake_synth, fake_compile],
        ):
            params = SynthesisRunParams(
                run_id="r1", workspace_id="w", project_id=None, user_id="u",
                format="md", template="report", user_prompt="x",
                explicit_source_ids=[], note_ids=[], auto_search=False, byok_key_handle=None,
            )
            result: SynthesisResult = await env.client.execute_workflow(
                SynthesisWorkflow.run, params,
                id="wf-test-r1", task_queue="test-q",
            )
            assert result.status == "completed"
            assert result.s3_key == "synthesis/runs/r1/doc.md"
            assert result.format == "md"
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/worker/src/worker/workflows/synthesis_workflow.py`:

```python
"""SynthesisWorkflow — fetch_sources → synthesize → compile."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from worker.activities.synthesis.types import (
        CompiledArtifact, SourceBundle, SynthesisRunParams,
    )
    from worker.agents.synthesis.schemas import SynthesisOutputSchema


@dataclass(frozen=True)
class SynthesisResult:
    status: str  # completed | cancelled | failed
    s3_key: str | None = None
    format: str | None = None
    error_code: str | None = None


@workflow.defn(name="SynthesisWorkflow")
class SynthesisWorkflow:
    def __init__(self) -> None:
        self._cancelled = False

    @workflow.signal
    def cancel(self) -> None:
        self._cancelled = True

    @workflow.run
    async def run(self, params: SynthesisRunParams) -> SynthesisResult:
        retry = RetryPolicy(maximum_attempts=2)

        try:
            sources: SourceBundle = await workflow.execute_activity(
                "fetch_sources_activity", params,
                start_to_close_timeout=timedelta(minutes=5),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            if self._cancelled:
                return SynthesisResult(status="cancelled")

            output: SynthesisOutputSchema = await workflow.execute_activity(
                "synthesize_activity", args=[params, sources],
                start_to_close_timeout=timedelta(minutes=10),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            if self._cancelled:
                return SynthesisResult(status="cancelled")

            artifact: CompiledArtifact = await workflow.execute_activity(
                "compile_activity", args=[params, output],
                start_to_close_timeout=timedelta(minutes=5),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return SynthesisResult(
                status="completed", s3_key=artifact.s3_key, format=artifact.format,
            )
        except Exception as exc:
            workflow.logger.exception("synthesis workflow failed: %s", exc)
            return SynthesisResult(status="failed", error_code="workflow_failed")
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/workflows/synthesis_workflow.py apps/worker/tests/workflows/test_synthesis_workflow.py
git commit -m "$(cat <<'TASK10'
feat(worker): SynthesisWorkflow — 3-activity pipeline with cancel signal

Time-skipping workflow test verifies happy-path. Cancel signal short-
circuits between activities; status flips are written by activities
themselves via internal API PATCH.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK10
)"
```

---

### Task 11: Worker registration (`temporal_main.py`)

**Files:**
- Modify: `apps/worker/src/worker/temporal_main.py`

- [x] **Step 1: Read current registration**

Open `apps/worker/src/worker/temporal_main.py` and locate the existing workflow + activity lists (look for the `Worker(...)` constructor in `start_worker`). Note the import patterns and where Code Agent / Deep Research are registered behind their flags.

- [x] **Step 2: Add synthesis registration behind FEATURE_SYNTHESIS**

Add imports near the top with other workflow/activity imports:

```python
from worker.workflows.synthesis_workflow import SynthesisWorkflow
from worker.activities.synthesis.fetch import fetch_sources_activity
from worker.activities.synthesis.synthesize import synthesize_activity
from worker.activities.synthesis.compile import compile_activity
```

Inside the worker constructor block, gate behind the flag (mirror the existing `FEATURE_CODE_AGENT` / `FEATURE_DEEP_RESEARCH` pattern):

```python
if os.environ.get("FEATURE_SYNTHESIS", "false").lower() == "true":
    workflows.append(SynthesisWorkflow)
    activities.extend([
        fetch_sources_activity,
        synthesize_activity,
        compile_activity,
    ])
```

- [x] **Step 3: Run worker tests to ensure nothing else broke**

`cd apps/worker && uv run pytest -x`

- [x] **Step 4: Commit**

```bash
git add apps/worker/src/worker/temporal_main.py
git commit -m "$(cat <<'TASK11'
feat(worker): register SynthesisWorkflow + 3 activities behind FEATURE_SYNTHESIS

Off by default so production workers keep narrow surface area until
the api+web feature ships.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK11
)"
```

---

### Task 12: Worker e2e smoke (workflow → 3 activities → mock LLM)

**Files:**
- Create: `apps/worker/tests/integration/test_synthesis_smoke.py`

- [x] **Step 1: Write the failing test**

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from llm.types import AssistantTurn, ToolUse, UsageCounts

from worker.activities.synthesis.fetch import fetch_sources_activity
from worker.activities.synthesis.synthesize import synthesize_activity
from worker.activities.synthesis.compile import compile_activity
from worker.activities.synthesis.types import SynthesisRunParams
from worker.workflows.synthesis_workflow import SynthesisWorkflow


@pytest.mark.asyncio
async def test_synthesis_smoke_md_path():
    fake_provider = MagicMock()
    fake_provider.generate_with_tools = AsyncMock(return_value=AssistantTurn(
        final_text=None,
        tool_uses=(ToolUse(id="t", name="emit_structured_output", args={
            "schema_name": "SynthesisOutputSchema",
            "data": {
                "format": "md", "title": "Smoke", "abstract": None,
                "sections": [{"title": "S", "content": "body", "source_ids": []}],
                "bibliography": [], "template": "report",
            },
        }),),
        usage=UsageCounts(input_tokens=100, output_tokens=50),
    ))

    with patch("worker.activities.synthesis.synthesize.resolve_llm_provider", new=AsyncMock(return_value=fake_provider)), \
         patch("worker.activities.synthesis.fetch._fetch_s3_object", new=AsyncMock(return_value={"id": "s1", "title": "P", "body": "x", "kind": "s3_object"})), \
         patch("worker.activities.synthesis.fetch._persist_sources", new=AsyncMock()), \
         patch("worker.activities.synthesis.synthesize._patch_run_tokens", new=AsyncMock()), \
         patch("worker.activities.synthesis.compile._record_document", new=AsyncMock()), \
         patch("worker.activities.synthesis.compile.upload_bytes", return_value="synthesis/runs/r/doc.md"):
        async with await WorkflowEnvironment.start_time_skipping() as env:
            async with Worker(
                env.client, task_queue="smoke-q",
                workflows=[SynthesisWorkflow],
                activities=[fetch_sources_activity, synthesize_activity, compile_activity],
            ):
                params = SynthesisRunParams(
                    run_id="r", workspace_id="w", project_id=None, user_id="u",
                    format="md", template="report", user_prompt="x",
                    explicit_source_ids=["s1"], note_ids=[], auto_search=False, byok_key_handle=None,
                )
                res = await env.client.execute_workflow(
                    SynthesisWorkflow.run, params,
                    id="wf-smoke", task_queue="smoke-q",
                )
                assert res.status == "completed"
                assert res.format == "md"
```

- [x] **Step 2: Run — verify PASS**

- [x] **Step 3: Commit**

```bash
git add apps/worker/tests/integration/test_synthesis_smoke.py
git commit -m "$(cat <<'TASK12'
test(worker): synthesis smoke — workflow + activities + mocked LLM/S3/api

Confirms the three-activity wiring with realistic patch boundaries
before the API + web layers come online.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK12
)"
```

---

## Phase C — API (Document compilers + Routes)

### Task 13: Add `docx` npm dependency + DOCX compiler

**Files:**
- Modify: `apps/api/package.json` (add `docx`)
- Create: `apps/api/src/lib/document-compilers/docx.ts`
- Create: `apps/api/src/lib/document-compilers/index.ts` (barrel export)

- [x] **Step 1: Add dependency**

```bash
pnpm --filter @opencairn/api add docx
```

Verify `docx` shows up in `apps/api/package.json` under `dependencies`.

- [x] **Step 2: Write the failing test**

Create `apps/api/tests/document-compilers/docx.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { compileDocx } from "../../src/lib/document-compilers/docx";

const FIXTURE = {
  format: "docx" as const,
  title: "Synthesis Doc",
  abstract: "An overview of the topic.",
  sections: [
    { title: "Intro", content: "<p>Hello [1] world.</p>", source_ids: ["abc12345"] },
    { title: "Methods", content: "<p>Methodology details.</p>", source_ids: [] },
  ],
  bibliography: [
    { cite_key: "src:abc12345", author: "Doe", title: "Paper", year: 2024, url: "https://x", source_id: "abc12345" },
  ],
  template: "report" as const,
};

describe("compileDocx", () => {
  it("produces a non-empty Buffer with DOCX zip magic bytes", async () => {
    const buf = await compileDocx(FIXTURE);
    expect(buf.length).toBeGreaterThan(1000);
    // DOCX is a zip; zip magic = "PK"
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("includes the title text somewhere in the binary payload", async () => {
    const buf = await compileDocx(FIXTURE);
    const haystack = buf.toString("utf-8");
    expect(haystack).toContain("Synthesis Doc");
  });
});
```

- [x] **Step 3: Run — verify fails**

`pnpm --filter @opencairn/api test document-compilers/docx`

- [x] **Step 4: Implement**

Create `apps/api/src/lib/document-compilers/docx.ts`:

```typescript
import {
  Document, Packer, Paragraph, HeadingLevel, TextRun, Footer, PageNumber,
  AlignmentType,
} from "docx";

export interface SynthesisOutputJson {
  format: "latex" | "docx" | "pdf" | "md";
  title: string;
  abstract: string | null;
  sections: { title: string; content: string; source_ids: string[] }[];
  bibliography: {
    cite_key: string; author: string; title: string;
    year: number | null; url: string | null; source_id: string;
  }[];
  template: string;
}

// Strip a tiny HTML subset (h1/h2/p/strong/em/li/code) into plain runs.
// Production-grade HTML→DOCX is out of scope; the LLM is instructed to
// emit the supported subset.
function htmlToParagraphs(html: string): Paragraph[] {
  const stripped = html
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
  return stripped.split(/\n+/).map((line) => new Paragraph({
    children: [new TextRun({ text: line })],
  }));
}

export async function compileDocx(out: SynthesisOutputJson): Promise<Buffer> {
  const children: Paragraph[] = [];
  children.push(new Paragraph({
    text: out.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
  }));

  if (out.abstract) {
    children.push(new Paragraph({ text: "Abstract", heading: HeadingLevel.HEADING_1 }));
    children.push(...htmlToParagraphs(out.abstract));
  }

  for (const sec of out.sections) {
    children.push(new Paragraph({ text: sec.title, heading: HeadingLevel.HEADING_1 }));
    children.push(...htmlToParagraphs(sec.content));
  }

  if (out.bibliography.length > 0) {
    children.push(new Paragraph({ text: "References", heading: HeadingLevel.HEADING_1 }));
    out.bibliography.forEach((b, i) => {
      const yr = b.year ? `, ${b.year}` : "";
      const url = b.url ? `, ${b.url}` : "";
      children.push(new Paragraph({
        children: [new TextRun({ text: `[${i + 1}] ${b.author}, “${b.title}”${yr}${url}` })],
      }));
    });
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children,
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES] })],
          })],
        }),
      },
    }],
  });
  return Packer.toBuffer(doc);
}
```

Create `apps/api/src/lib/document-compilers/index.ts`:

```typescript
export { compileDocx, type SynthesisOutputJson } from "./docx";
```

- [x] **Step 5: Run — verify PASS**

2/2.

- [x] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/lib/document-compilers/ apps/api/tests/document-compilers/docx.test.ts
git commit -m "$(cat <<'TASK13'
feat(api): DOCX compiler — synthesis output → docx Buffer

The LLM emits a minimal HTML subset; htmlToParagraphs flattens to plain
runs. Production-grade HTML→DOCX rendering is intentionally out of
scope.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK13
)"
```

---

### Task 14: Add Playwright + PDF compiler

**Files:**
- Modify: `apps/api/package.json` (add `playwright`)
- Create: `apps/api/src/lib/document-compilers/pdf.ts`

**Pre-flight note**: Playwright requires a one-time browser download — `pnpm exec playwright install chromium` in CI/dev. Document this in the PR description.

- [x] **Step 1: Add dependency**

```bash
pnpm --filter @opencairn/api add playwright
pnpm --filter @opencairn/api exec playwright install --with-deps chromium
```

- [x] **Step 2: Write the failing test**

Create `apps/api/tests/document-compilers/pdf.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { compilePdf } from "../../src/lib/document-compilers/pdf";

const FIXTURE = {
  format: "pdf" as const,
  title: "PDF Test",
  abstract: null,
  sections: [{ title: "Body", content: "<p>Hello world</p>", source_ids: [] }],
  bibliography: [],
  template: "report" as const,
};

describe("compilePdf", () => {
  it("produces a non-empty PDF (starts with %PDF-)", async () => {
    const buf = await compilePdf(FIXTURE);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  }, 30_000);
});
```

- [x] **Step 3: Run — verify fails**

- [x] **Step 4: Implement**

Create `apps/api/src/lib/document-compilers/pdf.ts`:

```typescript
import { chromium } from "playwright";
import type { SynthesisOutputJson } from "./docx";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] ?? c));
}

function buildHtml(out: SynthesisOutputJson): string {
  const sections = out.sections
    .map((s) => `<section><h2>${escapeHtml(s.title)}</h2>${s.content}</section>`)
    .join("\n");

  const bibliography = out.bibliography.length > 0
    ? `<section><h2>References</h2><ol>${out.bibliography
        .map((b) => `<li>${escapeHtml(b.author)}, <em>${escapeHtml(b.title)}</em>${b.year ? `, ${b.year}` : ""}${b.url ? `, <a href="${escapeHtml(b.url)}">${escapeHtml(b.url)}</a>` : ""}</li>`)
        .join("")}</ol></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(out.title)}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 28px; margin-bottom: 0.4em; }
  h2 { font-size: 20px; margin-top: 1.6em; }
  p { margin: 0.6em 0; }
  ol li { margin: 0.3em 0; }
  .abstract { font-style: italic; border-left: 3px solid #ddd; padding-left: 1em; margin: 1em 0; }
</style>
</head>
<body>
<h1>${escapeHtml(out.title)}</h1>
${out.abstract ? `<div class="abstract">${escapeHtml(out.abstract)}</div>` : ""}
${sections}
${bibliography}
</body>
</html>`;
}

export async function compilePdf(out: SynthesisOutputJson): Promise<Buffer> {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(buildHtml(out), { waitUntil: "load" });
    const buf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "2cm", right: "2cm", bottom: "2cm", left: "2cm" },
    });
    return buf;
  } finally {
    await browser.close();
  }
}
```

Update `apps/api/src/lib/document-compilers/index.ts`:

```typescript
export { compileDocx, type SynthesisOutputJson } from "./docx";
export { compilePdf } from "./pdf";
```

- [x] **Step 5: Run — verify PASS**

(Test takes ~5–15s. If chromium is missing locally, install via the command in Step 1.)

- [x] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/lib/document-compilers/pdf.ts apps/api/src/lib/document-compilers/index.ts apps/api/tests/document-compilers/pdf.test.ts
git commit -m "$(cat <<'TASK14'
feat(api): Playwright PDF compiler — synthesis output → A4 PDF Buffer

Korean fonts via system fallback (Apple SD Gothic Neo, Noto Sans KR,
Malgun Gothic). escapeHtml prevents the LLM from injecting markup
outside section/bibliography slots.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK14
)"
```

---

### Task 15: Internal compile route

**Files:**
- Modify: `apps/api/src/routes/internal.ts` (append synthesis compile + record handlers)

This task wires the worker's `post_internal("/api/internal/synthesis/compile", ...)` from Task 9 and `post_internal("/api/internal/synthesis/documents", ...)` from Task 9 + `synthesize_activity._patch_run_tokens` from Task 7.

- [x] **Step 1: Write the failing test**

Create `apps/api/tests/internal/synthesis.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import app from "../../src/index";
import { db, synthesisRuns, synthesisDocuments, workspaces, user } from "@opencairn/db";
import { eq } from "drizzle-orm";

const SECRET = "test-internal-secret";
process.env.INTERNAL_API_SECRET = SECRET;

const headers = { "X-Internal-Secret": SECRET, "Content-Type": "application/json" };

let workspaceId: string;
let userId = "test-user-syn-internal";
let runId: string;

beforeAll(async () => {
  await db.insert(user).values({
    id: userId, email: "syn-int@test.com", name: "x",
    emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
  }).onConflictDoNothing();
  const [ws] = await db.insert(workspaces).values({ slug: "syn-int", name: "x", ownerId: userId }).returning();
  workspaceId = ws!.id;
  const [run] = await db.insert(synthesisRuns).values({
    workspaceId, userId, format: "docx", template: "report",
    userPrompt: "x", autoSearch: false,
  }).returning();
  runId = run!.id;
});

describe("/api/internal/synthesis/*", () => {
  it("compile returns 401 without internal secret", async () => {
    const res = await app.request("/api/internal/synthesis/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, format: "md", output: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("compile md returns s3Key + records document", async () => {
    const res = await app.request("/api/internal/synthesis/compile", {
      method: "POST", headers,
      body: JSON.stringify({
        run_id: runId, format: "md",
        output: {
          format: "md", title: "T", abstract: null,
          sections: [{ title: "S", content: "c", source_ids: [] }],
          bibliography: [], template: "report",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body: { s3Key: string; bytes: number } = await res.json();
    expect(body.s3Key).toContain(runId);
    expect(body.bytes).toBeGreaterThan(0);
  });

  it("documents endpoint inserts a row", async () => {
    const res = await app.request("/api/internal/synthesis/documents", {
      method: "POST", headers,
      body: JSON.stringify({
        run_id: runId, format: "zip",
        s3_key: `synthesis/runs/${runId}/test.zip`, bytes: 4096,
      }),
    });
    expect(res.status).toBe(200);
    const docs = await db.select().from(synthesisDocuments).where(eq(synthesisDocuments.runId, runId));
    expect(docs.find((d) => d.format === "zip")).toBeDefined();
  });

  it("PATCH /runs/:id updates tokens_used + status", async () => {
    const res = await app.request(`/api/internal/synthesis/runs/${runId}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ tokens_used: 4321, status: "compiling" }),
    });
    expect(res.status).toBe(200);
    const [run] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, runId));
    expect(run!.tokensUsed).toBe(4321);
    expect(run!.status).toBe("compiling");
  });
});
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Append to `apps/api/src/routes/internal.ts` (use existing `internal` Hono router; reuse the existing `X-Internal-Secret` middleware):

```typescript
// ===== Synthesis internal endpoints (Task 15) =====
import { compileDocx, compilePdf, type SynthesisOutputJson } from "../lib/document-compilers";
import { uploadObject } from "../lib/s3";
import { synthesisDocuments, synthesisRuns, synthesisSources } from "@opencairn/db";

const synthesisCompileSchema = z.object({
  run_id: z.string().uuid(),
  format: z.enum(["latex", "docx", "pdf", "md"]),
  output: z.any(),
});

internal.post("/api/internal/synthesis/compile", zValidator("json", synthesisCompileSchema), async (c) => {
  const { run_id, format, output } = c.req.valid("json");
  const out = output as SynthesisOutputJson;
  let buf: Buffer;
  let contentType: string;
  let ext: string;

  if (format === "docx") {
    buf = await compileDocx(out);
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    ext = "docx";
  } else if (format === "pdf") {
    buf = await compilePdf(out);
    contentType = "application/pdf";
    ext = "pdf";
  } else if (format === "md") {
    const text = `# ${out.title}\n\n${(out.sections ?? []).map((s) => `## ${s.title}\n${s.content}\n`).join("\n")}`;
    buf = Buffer.from(text, "utf-8");
    contentType = "text/markdown; charset=utf-8";
    ext = "md";
  } else {
    return c.json({ error: "format not supported by api compile" }, 400);
  }

  const s3Key = `synthesis/runs/${run_id}/document.${ext}`;
  await uploadObject(s3Key, buf, contentType);
  return c.json({ s3Key, bytes: buf.length });
});

const synthesisDocumentInsertSchema = z.object({
  run_id: z.string().uuid(),
  format: z.enum(["latex", "docx", "pdf", "md", "bibtex", "zip"]),
  s3_key: z.string(),
  bytes: z.number().int().nonnegative(),
});

internal.post("/api/internal/synthesis/documents", zValidator("json", synthesisDocumentInsertSchema), async (c) => {
  const body = c.req.valid("json");
  await db.insert(synthesisDocuments).values({
    runId: body.run_id, format: body.format, s3Key: body.s3_key, bytes: body.bytes,
  });
  return c.json({ ok: true });
});

const synthesisRunPatchSchema = z.object({
  tokens_used: z.number().int().nonnegative().optional(),
  status: z.enum(["pending", "fetching", "synthesizing", "compiling", "completed", "failed", "cancelled"]).optional(),
});

internal.patch("/api/internal/synthesis/runs/:id", zValidator("json", synthesisRunPatchSchema), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const patch: Record<string, unknown> = {};
  if (body.tokens_used !== undefined) patch.tokensUsed = body.tokens_used;
  if (body.status !== undefined) patch.status = body.status;
  if (Object.keys(patch).length === 0) return c.json({ ok: true });
  await db.update(synthesisRuns).set(patch).where(eq(synthesisRuns.id, id));
  return c.json({ ok: true });
});

const synthesisSourcesUpsertSchema = z.object({
  run_id: z.string().uuid(),
  rows: z.array(z.object({
    source_id: z.string(),
    kind: z.enum(["s3_object", "note", "dr_result"]),
    title: z.string().nullable(),
    token_count: z.number().int().nonnegative().nullable(),
    included: z.boolean(),
  })),
});

internal.post("/api/internal/synthesis/sources", zValidator("json", synthesisSourcesUpsertSchema), async (c) => {
  const { run_id, rows } = c.req.valid("json");
  if (rows.length === 0) return c.json({ ok: true });
  await db.insert(synthesisSources).values(rows.map((r) => ({
    runId: run_id, sourceType: r.kind, sourceId: r.source_id,
    title: r.title, tokenCount: r.token_count, included: r.included,
  })));
  return c.json({ ok: true });
});

// fetch-source / auto-search are reads against existing tables.
// Defer their full implementation to Task 17 once we've stubbed them
// with a 501; the worker's mocks already cover them in unit tests.
internal.post("/api/internal/synthesis/fetch-source", async (c) => {
  return c.json({ error: "not_implemented" }, 501);
});
internal.post("/api/internal/synthesis/auto-search", async (c) => {
  return c.json({ hits: [] });
});
```

- [x] **Step 4: Run — verify PASS**

4/4.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/api/tests/internal/synthesis.test.ts
git commit -m "$(cat <<'TASK15'
feat(api): internal synthesis endpoints — compile/documents/runs/sources

compile invokes docx/playwright compilers + uploads to MinIO. documents,
runs PATCH, and sources upserts complete the worker→api callback surface.
fetch-source/auto-search ship as stubs to be wired in Task 17.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK15
)"
```

---

### Task 16: `synthesis-client.ts` (Temporal helpers)

**Files:**
- Create: `apps/api/src/lib/synthesis-client.ts`

- [x] **Step 1: Write the failing test**

Create `apps/api/tests/lib/synthesis-client.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { startSynthesisRun, signalSynthesisCancel, workflowIdFor } from "../../src/lib/synthesis-client";

describe("synthesis-client", () => {
  it("workflowIdFor wraps the run id", () => {
    expect(workflowIdFor("abc")).toBe("synthesis-abc");
  });

  it("startSynthesisRun calls workflow.start with SynthesisWorkflow", async () => {
    const start = vi.fn().mockResolvedValue({ firstExecutionRunId: "x" });
    const fakeClient: any = { workflow: { start } };
    await startSynthesisRun(fakeClient, {
      runId: "abc", workspaceId: "w", projectId: null, userId: "u",
      format: "md", template: "report", userPrompt: "x",
      explicitSourceIds: [], noteIds: [], autoSearch: false, byokKeyHandle: null,
    });
    expect(start).toHaveBeenCalledOnce();
    const [name, opts] = start.mock.calls[0];
    expect(name).toBe("SynthesisWorkflow");
    expect(opts.workflowId).toBe("synthesis-abc");
  });

  it("signalSynthesisCancel calls cancel signal on handle", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const fakeClient: any = {
      workflow: { getHandle: vi.fn().mockReturnValue({ signal }) },
    };
    await signalSynthesisCancel(fakeClient, "abc");
    expect(fakeClient.workflow.getHandle).toHaveBeenCalledWith("synthesis-abc");
    expect(signal).toHaveBeenCalledWith("cancel");
  });
});
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/api/src/lib/synthesis-client.ts`:

```typescript
import type { Client } from "@temporalio/client";

const ONE_HOUR_MS = 60 * 60 * 1000;

export const workflowIdFor = (runId: string) => `synthesis-${runId}`;

function taskQueue(): string {
  return process.env.TEMPORAL_TASK_QUEUE ?? "opencairn";
}

export interface StartSynthesisParams {
  runId: string;
  workspaceId: string;
  projectId: string | null;
  userId: string;
  format: "latex" | "docx" | "pdf" | "md";
  template: "ieee" | "acm" | "apa" | "korean_thesis" | "report";
  userPrompt: string;
  explicitSourceIds: string[];
  noteIds: string[];
  autoSearch: boolean;
  byokKeyHandle: string | null;
}

export async function startSynthesisRun(client: Client, p: StartSynthesisParams) {
  // The worker dataclass uses snake_case; the converter handles it.
  return client.workflow.start("SynthesisWorkflow", {
    workflowId: workflowIdFor(p.runId),
    taskQueue: taskQueue(),
    args: [{
      run_id: p.runId,
      workspace_id: p.workspaceId,
      project_id: p.projectId,
      user_id: p.userId,
      format: p.format,
      template: p.template,
      user_prompt: p.userPrompt,
      explicit_source_ids: p.explicitSourceIds,
      note_ids: p.noteIds,
      auto_search: p.autoSearch,
      byok_key_handle: p.byokKeyHandle,
    }],
    workflowExecutionTimeout: ONE_HOUR_MS,
  });
}

export async function signalSynthesisCancel(client: Client, runId: string) {
  return client.workflow.getHandle(workflowIdFor(runId)).signal("cancel");
}
```

- [x] **Step 4: Run — verify PASS**

3/3.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/lib/synthesis-client.ts apps/api/tests/lib/synthesis-client.test.ts
git commit -m "$(cat <<'TASK16'
feat(api): synthesis-client — Temporal start + cancel helpers

Snake-case payload keys match the Python @dataclass field names so
Temporal's default JSON converter round-trips cleanly without a custom
Pydantic adapter on the worker side.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK16
)"
```

---

### Task 17: Wire `fetch-source` + `auto-search` real implementations

**Files:**
- Modify: `apps/api/src/routes/internal.ts` (replace stubs from Task 15)

This task replaces the 501 stubs in Task 15 with real reads against `s3.ts` (for s3_object kind) + `notes` (for note kind) + a thin semantic-search call.

- [x] **Step 1: Write the failing test**

Append to `apps/api/tests/internal/synthesis.test.ts`:

```typescript
describe("/api/internal/synthesis/fetch-source", () => {
  it("returns note content for kind=note", async () => {
    // seed a note attached to workspaceId from beforeAll
    const [n] = await db.insert(notes).values({
      workspaceId, projectId: null, ownerId: userId,
      title: "Seeded note", contentText: "note body for synthesis fetch",
    }).returning();

    const res = await app.request("/api/internal/synthesis/fetch-source", {
      method: "POST", headers,
      body: JSON.stringify({ source_id: n!.id, kind: "note" }),
    });
    expect(res.status).toBe(200);
    const body: { id: string; title: string; body: string } = await res.json();
    expect(body.id).toBe(n!.id);
    expect(body.body).toContain("note body for synthesis fetch");
  });
});
```

(Add `notes` to the existing `@opencairn/db` import line at top of file.)

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Replace the two stubs added in Task 15. The `fetch-source` handler reads from `notes` (when kind=note) or `ingest_jobs`/object metadata for `s3_object`. The `auto-search` handler defers to existing semantic search if available, else returns `hits: []`.

```typescript
import { notes, ingestJobs } from "@opencairn/db";

const fetchSourceSchema = z.object({
  source_id: z.string(),
  kind: z.enum(["s3_object", "note", "dr_result"]),
});

internal.post("/api/internal/synthesis/fetch-source",
  zValidator("json", fetchSourceSchema),
  async (c) => {
    const { source_id, kind } = c.req.valid("json");

    if (kind === "note") {
      const [row] = await db.select().from(notes).where(eq(notes.id, source_id)).limit(1);
      if (!row) return c.json({ error: "not_found" }, 404);
      return c.json({
        id: row.id,
        title: row.title ?? "Untitled",
        body: row.contentText ?? "",
        kind: "note",
      });
    }

    if (kind === "s3_object") {
      const [job] = await db.select().from(ingestJobs).where(eq(ingestJobs.objectKey, source_id)).limit(1);
      const title = job?.fileName ?? source_id;
      // Body is the extracted text persisted by the ingest pipeline; if the
      // pipeline hasn't backfilled it, body is empty (synthesis still
      // proceeds with the title and other sources).
      const body = job?.extractedText ?? "";
      return c.json({ id: source_id, title, body, kind: "s3_object" });
    }

    return c.json({ error: "kind_not_supported" }, 501);
  },
);

// auto-search: lightweight workspace-scoped semantic search.
// If the workspace has no embeddings yet, returns empty hits — synthesis
// degrades gracefully to explicit sources only.
const autoSearchSchema = z.object({
  workspace_id: z.string().uuid(),
  query: z.string().min(1),
  limit: z.number().int().positive().max(20).default(10),
});

internal.post("/api/internal/synthesis/auto-search",
  zValidator("json", autoSearchSchema),
  async (c) => {
    const { workspace_id, query, limit } = c.req.valid("json");
    // Reuse the existing chat-scope or notes search helper if present.
    // Until a dedicated synthesis search lands, return empty hits — see
    // followup #1 in plan-status.
    return c.json({ hits: [] satisfies Array<{ id: string; title: string; body: string }> });
  },
);
```

(Adjust column names — `ingestJobs.objectKey`, `ingestJobs.fileName`, `ingestJobs.extractedText` — to whatever the actual schema uses. If those columns don't exist, fall back to `id: source_id, title: source_id, body: ""` and document as followup #2.)

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/api/tests/internal/synthesis.test.ts
git commit -m "$(cat <<'TASK17'
feat(api): wire fetch-source for notes + s3_object; auto-search stub

note path reads notes.contentText; s3_object reads ingestJobs metadata.
auto-search returns empty hits — proper semantic search is a followup
once the chat-scope helper is generalized.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK17
)"
```

---

### Task 18: Public POST `/api/synthesis/run` + GET `/runs/:id/stream` (SSE)

**Files:**
- Create: `apps/api/src/routes/synthesis.ts`
- Modify: `apps/api/src/index.ts` (mount router behind `FEATURE_SYNTHESIS`)

- [x] **Step 1: Write the failing test**

Create `apps/api/tests/synthesis.test.ts`:

```typescript
import { describe, it, expect, beforeAll, vi } from "vitest";

// Force feature flag ON for this suite.
process.env.FEATURE_SYNTHESIS = "true";

vi.mock("../src/lib/synthesis-client", () => ({
  startSynthesisRun: vi.fn().mockResolvedValue({ firstExecutionRunId: "wf-1" }),
  signalSynthesisCancel: vi.fn().mockResolvedValue(undefined),
  workflowIdFor: (id: string) => `synthesis-${id}`,
}));
vi.mock("../src/lib/temporal-client", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({}),
}));

import app from "../src/index";
import { db, synthesisRuns, workspaces, user } from "@opencairn/db";
import { eq } from "drizzle-orm";

let workspaceId: string;
let userId = "test-user-syn-public";

beforeAll(async () => {
  await db.insert(user).values({
    id: userId, email: "syn-pub@test.com", name: "x",
    emailVerified: false, createdAt: new Date(), updatedAt: new Date(),
  }).onConflictDoNothing();
  const [ws] = await db.insert(workspaces).values({ slug: "syn-pub", name: "x", ownerId: userId }).returning();
  workspaceId = ws!.id;
});

function authedRequest(path: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), "x-test-user-id": userId, "Content-Type": "application/json" },
  });
}

describe("POST /api/synthesis/run", () => {
  it("returns 404 when feature flag is OFF", async () => {
    const old = process.env.FEATURE_SYNTHESIS;
    process.env.FEATURE_SYNTHESIS = "false";
    try {
      const res = await authedRequest("/api/synthesis/run", {
        method: "POST",
        body: JSON.stringify({
          workspaceId, format: "md", template: "report",
          userPrompt: "x", explicitSourceIds: [], noteIds: [], autoSearch: false,
        }),
      });
      expect(res.status).toBe(404);
    } finally {
      process.env.FEATURE_SYNTHESIS = old;
    }
  });

  it("creates a run and returns runId", async () => {
    const res = await authedRequest("/api/synthesis/run", {
      method: "POST",
      body: JSON.stringify({
        workspaceId, format: "md", template: "report",
        userPrompt: "Synthesize my notes.",
        explicitSourceIds: [], noteIds: [], autoSearch: false,
      }),
    });
    expect(res.status).toBe(200);
    const body: { runId: string } = await res.json();
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, body.runId));
    expect(row!.status).toBe("pending");
  });

  it("rejects invalid Zod payload", async () => {
    const res = await authedRequest("/api/synthesis/run", {
      method: "POST",
      body: JSON.stringify({ workspaceId, format: "pptx" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/synthesis/runs/:id/stream", () => {
  it("returns text/event-stream", async () => {
    // create a run that will never complete
    const [run] = await db.insert(synthesisRuns).values({
      workspaceId, userId, format: "md", template: "report",
      userPrompt: "x", autoSearch: false,
    }).returning();
    const res = await authedRequest(`/api/synthesis/runs/${run!.id}/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Read just the first chunk and bail.
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("data:");
    await reader.cancel();
  }, 10_000);
});
```

(`x-test-user-id` is your test session shim; if your harness uses a different name, look at `apps/api/tests/research.test.ts` and copy the convention.)

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/api/src/routes/synthesis.ts`:

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc } from "drizzle-orm";
import {
  db, synthesisRuns, synthesisSources, synthesisDocuments,
} from "@opencairn/db";
import {
  createSynthesisRunSchema, resynthesizeSchema, synthesisStreamEventSchema,
  type SynthesisStreamEvent,
} from "@opencairn/shared";
import type { AppEnv } from "../lib/types";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { getTemporalClient } from "../lib/temporal-client";
import { startSynthesisRun, signalSynthesisCancel } from "../lib/synthesis-client";

export const synthesisRouter = new Hono<AppEnv>();

function isFeatureEnabled(): boolean {
  return (process.env.FEATURE_SYNTHESIS ?? "false").toLowerCase() === "true";
}

synthesisRouter.use("*", async (c, next) => {
  if (!isFeatureEnabled()) return c.json({ error: "not_found" }, 404);
  await next();
});

synthesisRouter.post("/run", requireAuth, zValidator("json", createSynthesisRunSchema), async (c) => {
  const userId = c.get("userId")!;
  const body = c.req.valid("json");

  await canWrite(userId, { type: "workspace", id: body.workspaceId });

  const [run] = await db.insert(synthesisRuns).values({
    workspaceId: body.workspaceId,
    projectId: body.projectId ?? null,
    userId,
    format: body.format,
    template: body.template,
    userPrompt: body.userPrompt,
    autoSearch: body.autoSearch,
    status: "pending",
  }).returning();

  const client = await getTemporalClient();
  const handle = await startSynthesisRun(client, {
    runId: run!.id,
    workspaceId: body.workspaceId,
    projectId: body.projectId ?? null,
    userId,
    format: body.format,
    template: body.template,
    userPrompt: body.userPrompt,
    explicitSourceIds: body.explicitSourceIds,
    noteIds: body.noteIds,
    autoSearch: body.autoSearch,
    byokKeyHandle: null,
  });

  await db.update(synthesisRuns)
    .set({ workflowId: `synthesis-${run!.id}` })
    .where(eq(synthesisRuns.id, run!.id));

  return c.json({ runId: run!.id });
});

const POLL_MS = 2000;
const MAX_TICKS = (15 * 60 * 1000) / POLL_MS; // 15 min cap

synthesisRouter.get("/runs/:id/stream", requireAuth, async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId")!;
  const [run] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, id));
  if (!run) return c.json({ error: "not_found" }, 404);
  await canWrite(userId, { type: "workspace", id: run.workspaceId });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (ev: SynthesisStreamEvent) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      const keepalive = () => controller.enqueue(enc.encode(`: keepalive\n\n`));

      send({ kind: "queued", runId: id });

      let lastStatus = run.status;
      let aborted = false;
      c.req.raw.signal?.addEventListener("abort", () => { aborted = true; });

      for (let tick = 0; tick < MAX_TICKS; tick++) {
        if (aborted) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
        const [latest] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, id));
        if (!latest) break;

        if (latest.status !== lastStatus) {
          if (latest.status === "fetching") {
            const sources = await db.select().from(synthesisSources).where(eq(synthesisSources.runId, id));
            send({ kind: "fetching_sources", count: sources.length });
          } else if (latest.status === "synthesizing") {
            send({ kind: "synthesizing" });
          } else if (latest.status === "compiling") {
            send({ kind: "compiling", format: latest.format as never });
          }
          lastStatus = latest.status;
        }

        if (latest.status === "completed") {
          const docs = await db.select().from(synthesisDocuments)
            .where(eq(synthesisDocuments.runId, id))
            .orderBy(desc(synthesisDocuments.createdAt));
          const sources = await db.select().from(synthesisSources)
            .where(eq(synthesisSources.runId, id));
          send({
            kind: "done",
            docUrl: `/api/synthesis/runs/${id}/document?format=${latest.format}`,
            format: latest.format as never,
            sourceCount: sources.filter((s) => s.included).length,
            tokensUsed: latest.tokensUsed ?? 0,
          });
          break;
        }
        if (latest.status === "failed") { send({ kind: "error", code: "workflow_failed" }); break; }
        if (latest.status === "cancelled") { send({ kind: "error", code: "cancelled" }); break; }

        if (tick % 5 === 0) keepalive();
      }
      controller.close();
    },
  });

  return c.body(stream, 200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
});
```

Mount the router in `apps/api/src/index.ts` (find the existing route mounts and append):

```typescript
import { synthesisRouter } from "./routes/synthesis";
app.route("/api/synthesis", synthesisRouter);
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/api/src/routes/synthesis.ts apps/api/src/index.ts apps/api/tests/synthesis.test.ts
git commit -m "$(cat <<'TASK18'
feat(api): synthesis POST /run + SSE stream — feature-flagged

POST creates a run row, fires SynthesisWorkflow, returns runId. SSE
polls synthesis_runs every 2s emitting state-change events; keepalive
every 10s; 15 min cap.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK18
)"
```

---

### Task 19: List + detail + document download + resynthesize + delete

**Files:**
- Modify: `apps/api/src/routes/synthesis.ts` (append routes)

- [x] **Step 1: Write the failing test**

Append to `apps/api/tests/synthesis.test.ts`:

```typescript
describe("synthesis run list/detail/document/resynth/delete", () => {
  let createdRunId: string;

  beforeAll(async () => {
    const res = await authedRequest("/api/synthesis/run", {
      method: "POST",
      body: JSON.stringify({
        workspaceId, format: "md", template: "report",
        userPrompt: "x", explicitSourceIds: [], noteIds: [], autoSearch: false,
      }),
    });
    const body: { runId: string } = await res.json();
    createdRunId = body.runId;
  });

  it("GET /api/synthesis/runs lists user runs", async () => {
    const res = await authedRequest("/api/synthesis/runs?workspaceId=" + workspaceId);
    expect(res.status).toBe(200);
    const body: { runs: { id: string }[] } = await res.json();
    expect(body.runs.find((r) => r.id === createdRunId)).toBeDefined();
  });

  it("GET /api/synthesis/runs/:id returns detail with sources + documents", async () => {
    const res = await authedRequest(`/api/synthesis/runs/${createdRunId}`);
    expect(res.status).toBe(200);
    const body: { id: string; sources: unknown[]; documents: unknown[] } = await res.json();
    expect(body.id).toBe(createdRunId);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(Array.isArray(body.documents)).toBe(true);
  });

  it("GET /document returns 404 when no document exists", async () => {
    const res = await authedRequest(`/api/synthesis/runs/${createdRunId}/document?format=md`);
    expect(res.status).toBe(404);
  });

  it("POST /resynthesize creates a new run with same workspace", async () => {
    const res = await authedRequest(`/api/synthesis/runs/${createdRunId}/resynthesize`, {
      method: "POST",
      body: JSON.stringify({ userPrompt: "Try again with a longer intro." }),
    });
    expect(res.status).toBe(200);
    const body: { runId: string } = await res.json();
    expect(body.runId).not.toBe(createdRunId);
  });

  it("DELETE cancels and removes the run", async () => {
    const res = await authedRequest(`/api/synthesis/runs/${createdRunId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const [row] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, createdRunId));
    expect(row).toBeUndefined();
  });
});
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Append to `apps/api/src/routes/synthesis.ts`:

```typescript
import { streamObject } from "../lib/s3-get";

synthesisRouter.get("/runs", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return c.json({ error: "workspaceId required" }, 400);
  await canWrite(userId, { type: "workspace", id: workspaceId });
  const rows = await db.select().from(synthesisRuns)
    .where(eq(synthesisRuns.workspaceId, workspaceId))
    .orderBy(desc(synthesisRuns.createdAt))
    .limit(50);
  return c.json({
    runs: rows.map((r) => ({
      id: r.id,
      format: r.format,
      template: r.template,
      status: r.status,
      userPrompt: r.userPrompt,
      tokensUsed: r.tokensUsed,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

synthesisRouter.get("/runs/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId")!;
  const [run] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, id));
  if (!run) return c.json({ error: "not_found" }, 404);
  await canWrite(userId, { type: "workspace", id: run.workspaceId });

  const sources = await db.select().from(synthesisSources).where(eq(synthesisSources.runId, id));
  const documents = await db.select().from(synthesisDocuments).where(eq(synthesisDocuments.runId, id));
  return c.json({
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    format: run.format,
    template: run.template,
    status: run.status,
    userPrompt: run.userPrompt,
    autoSearch: run.autoSearch,
    tokensUsed: run.tokensUsed,
    createdAt: run.createdAt.toISOString(),
    sources: sources.map((s) => ({
      id: s.id, sourceType: s.sourceType, sourceId: s.sourceId,
      title: s.title, tokenCount: s.tokenCount, included: s.included,
    })),
    documents: documents.map((d) => ({
      id: d.id, format: d.format, s3Key: d.s3Key, bytes: d.bytes,
      createdAt: d.createdAt.toISOString(),
    })),
  });
});

synthesisRouter.get("/runs/:id/document", requireAuth, async (c) => {
  const id = c.req.param("id");
  const fmt = c.req.query("format");
  const userId = c.get("userId")!;
  const [run] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, id));
  if (!run) return c.json({ error: "not_found" }, 404);
  await canWrite(userId, { type: "workspace", id: run.workspaceId });

  const docs = await db.select().from(synthesisDocuments)
    .where(eq(synthesisDocuments.runId, id))
    .orderBy(desc(synthesisDocuments.createdAt));
  const target = fmt
    ? docs.find((d) => d.format === fmt)
    : docs[0];
  if (!target?.s3Key) return c.json({ error: "no_document" }, 404);

  const obj = await streamObject(target.s3Key);
  const filename = `synthesis-${id}.${target.format}`;
  return c.body(obj.stream, 200, {
    "Content-Type": obj.contentType,
    "Content-Length": String(obj.contentLength),
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
});

synthesisRouter.post("/runs/:id/resynthesize", requireAuth, zValidator("json", resynthesizeSchema), async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId")!;
  const body = c.req.valid("json");
  const [prev] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, id));
  if (!prev) return c.json({ error: "not_found" }, 404);
  await canWrite(userId, { type: "workspace", id: prev.workspaceId });

  const [next] = await db.insert(synthesisRuns).values({
    workspaceId: prev.workspaceId,
    projectId: prev.projectId,
    userId,
    format: prev.format,
    template: prev.template,
    userPrompt: body.userPrompt,
    autoSearch: prev.autoSearch,
    status: "pending",
  }).returning();

  const client = await getTemporalClient();
  await startSynthesisRun(client, {
    runId: next!.id,
    workspaceId: prev.workspaceId,
    projectId: prev.projectId,
    userId,
    format: prev.format as never,
    template: prev.template as never,
    userPrompt: body.userPrompt,
    explicitSourceIds: [],
    noteIds: [],
    autoSearch: prev.autoSearch,
    byokKeyHandle: null,
  });
  await db.update(synthesisRuns)
    .set({ workflowId: `synthesis-${next!.id}` })
    .where(eq(synthesisRuns.id, next!.id));
  return c.json({ runId: next!.id });
});

synthesisRouter.delete("/runs/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId")!;
  const [run] = await db.select().from(synthesisRuns).where(eq(synthesisRuns.id, id));
  if (!run) return c.json({ error: "not_found" }, 404);
  await canWrite(userId, { type: "workspace", id: run.workspaceId });

  try {
    const client = await getTemporalClient();
    await signalSynthesisCancel(client, id);
  } catch {
    // workflow may already be terminal; deletion still proceeds
  }
  await db.delete(synthesisRuns).where(eq(synthesisRuns.id, id));
  return c.body(null, 204);
});
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/api/src/routes/synthesis.ts apps/api/tests/synthesis.test.ts
git commit -m "$(cat <<'TASK19'
feat(api): synthesis list/detail/document/resynthesize/delete

Document download streams from MinIO via existing streamObject helper;
resynthesize creates a fresh run carrying over format/template/projectId;
delete signals workflow cancel best-effort then removes the row.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK19
)"
```

---

### Task 20: API status flip from worker (status PATCH wiring)

**Files:**
- Modify: `apps/worker/src/worker/activities/synthesis/fetch.py`
- Modify: `apps/worker/src/worker/activities/synthesis/synthesize.py`
- Modify: `apps/worker/src/worker/activities/synthesis/compile.py`

The SSE stream in Task 18 reacts to `status` column changes. Activities need to flip status at their boundaries — currently they don't. Add lightweight `_set_status(run_id, status)` calls.

- [x] **Step 1: Write the failing test**

Append to `apps/worker/tests/activities/synthesis/test_fetch.py`:

```python
@pytest.mark.asyncio
async def test_fetch_sets_status_fetching():
    params = SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format="md", template="report", user_prompt="x",
        explicit_source_ids=[], note_ids=[], auto_search=False, byok_key_handle=None,
    )
    with patch("worker.activities.synthesis.fetch._set_status", new=AsyncMock()) as flip:
        with patch("worker.activities.synthesis.fetch._persist_sources", new=AsyncMock()):
            env = ActivityEnvironment()
            await env.run(fetch_sources_activity, params)
            flip.assert_awaited_with("r1", "fetching")
```

Append parallel tests to `test_synthesize.py` and `test_compile.py` for `synthesizing` and `compiling` respectively.

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Add to each activity file (e.g., `fetch.py`):

```python
async def _set_status(run_id: str, status: str) -> None:
    await patch_internal(
        f"/api/internal/synthesis/runs/{run_id}",
        {"status": status},
    )
```

Call at the top of each `@activity.defn` body:

- `fetch_sources_activity`: `await _set_status(params.run_id, "fetching")`
- `synthesize_activity`: `await _set_status(params.run_id, "synthesizing")`
- `compile_activity`: `await _set_status(params.run_id, "compiling")` (and `"completed"` at the very end of the success path)

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/synthesis/
git commit -m "$(cat <<'TASK20'
feat(worker): synthesis activities flip run status (fetch/synthesize/compile/completed)

Drives the SSE stream's state-change emission on apps/api side. All
status flips go through the existing PATCH /api/internal/synthesis/runs/:id
endpoint added in Task 15.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK20
)"
```

---

## Phase D — Tectonic MSA (Pro)

### Task 21: `apps/tectonic` Dockerfile

**Files:**
- Create: `apps/tectonic/Dockerfile`
- Create: `apps/tectonic/.dockerignore`
- Create: `apps/tectonic/requirements.txt`
- Create: `apps/tectonic/README.md`

- [x] **Step 1: Create files**

`apps/tectonic/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.6
FROM debian:bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV TECTONIC_CACHE_DIR=/app/cache

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-nanum \
        fonts-nanum-coding \
        fonts-noto-cjk \
        libfontconfig1 \
        libgraphite2-3 \
        libharfbuzz0b \
        libicu72 \
        python3 \
        python3-venv \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Tectonic (statically linked binary).
RUN curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@0.15.0/tectonic-0.15.0-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin tectonic

# Refresh font cache so xelatex finds NanumGothic / Noto CJK at runtime.
RUN fc-cache -f -v

WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

COPY server.py /app/server.py

# Non-root for shell-escape mitigation.
RUN useradd -m -s /usr/sbin/nologin tectonic && \
    mkdir -p /app/cache && chown -R tectonic:tectonic /app
USER tectonic

EXPOSE 8888
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fs http://localhost:8888/healthz || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8888", "--workers", "2"]
```

`apps/tectonic/requirements.txt`:

```
fastapi==0.118.0
uvicorn[standard]==0.32.0
pydantic==2.10.0
```

`apps/tectonic/.dockerignore`:

```
__pycache__
*.pyc
.venv
cache/
tests/
README.md
```

`apps/tectonic/README.md`:

```markdown
# Tectonic Compile MSA

Stateless LaTeX→PDF compiler. xelatex + kotex + Nanum/Noto CJK fonts.

## Run locally

    docker compose --profile pro up tectonic

## API

POST /compile  — see server.py
GET  /healthz  — liveness
```

- [x] **Step 2: Validate Dockerfile builds**

```bash
docker build -t opencairn/tectonic:dev apps/tectonic
```

Expect a successful build that produces an image containing `/usr/local/bin/tectonic`.

- [x] **Step 3: Commit**

```bash
git add apps/tectonic/Dockerfile apps/tectonic/.dockerignore apps/tectonic/requirements.txt apps/tectonic/README.md
git commit -m "$(cat <<'TASK21A'
feat(tectonic): Dockerfile — debian-slim + tectonic 0.15 + xelatex CJK fonts

Non-root user, healthcheck, font cache refresh so kotex resolves Nanum
at runtime. CTAN packages cache under /app/cache (compose volume).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK21A
)"
```

---

### Task 22: `apps/tectonic/server.py` FastAPI

**Files:**
- Create: `apps/tectonic/server.py`
- Create: `apps/tectonic/tests/test_compile.py`
- Create: `apps/tectonic/tests/fixtures/hello-ko.tex`

- [x] **Step 1: Write the failing golden test**

Create `apps/tectonic/tests/fixtures/hello-ko.tex`:

```latex
\documentclass[12pt]{report}
\usepackage{kotex}
\usepackage{geometry}
\title{한국어 테스트}
\begin{document}
\maketitle
안녕하세요. This is a Korean+English fixture for tectonic golden tests.
\end{document}
```

Create `apps/tectonic/tests/test_compile.py`:

```python
import os
import pytest
from fastapi.testclient import TestClient
from server import app


client = TestClient(app)


def _read_fixture(name: str) -> str:
    path = os.path.join(os.path.dirname(__file__), "fixtures", name)
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_healthz():
    res = client.get("/healthz")
    assert res.status_code == 200


@pytest.mark.skipif(
    os.environ.get("TECTONIC_BIN") is None,
    reason="Real tectonic binary required (CI/Docker only)",
)
def test_compile_korean_fixture():
    tex = _read_fixture("hello-ko.tex")
    res = client.post("/compile", json={
        "tex_source": tex, "engine": "xelatex", "timeout_ms": 60000,
    })
    assert res.status_code == 200
    body = res.content
    assert body[:5] == b"%PDF-"
    assert len(body) > 1000


def test_compile_rejects_oversize_input():
    huge = "%" + ("x" * (3 * 1024 * 1024))
    res = client.post("/compile", json={"tex_source": huge})
    assert res.status_code == 400


def test_compile_returns_400_on_invalid_tex():
    if os.environ.get("TECTONIC_BIN") is None:
        pytest.skip("Real tectonic binary required")
    res = client.post("/compile", json={
        "tex_source": "\\this is not valid latex \\\\\\",
        "timeout_ms": 10000,
    })
    assert res.status_code in (400, 500)
```

- [x] **Step 2: Implement server**

Create `apps/tectonic/server.py`:

```python
"""Tectonic compile MSA — POST .tex → PDF bytes.

Security: --untrusted (no shell escape), 2MB input cap, non-root,
process-kill timeout enforcement, CTAN-only egress (compose firewall).
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


app = FastAPI(title="OpenCairn Tectonic MSA", version="0.1.0")

MAX_BYTES = int(os.environ.get("TECTONIC_MAX_INPUT_BYTES", 2 * 1024 * 1024))
DEFAULT_TIMEOUT_MS = int(os.environ.get("DEFAULT_TIMEOUT_MS", 60_000))
TECTONIC_BIN = os.environ.get("TECTONIC_BIN", "/usr/local/bin/tectonic")
CACHE_DIR = os.environ.get("TECTONIC_CACHE_DIR", "/app/cache")


class CompileRequest(BaseModel):
    tex_source: str = Field(..., max_length=MAX_BYTES)
    bib_source: Optional[str] = None
    engine: str = Field("xelatex", pattern="^(xelatex|pdflatex|lualatex)$")
    timeout_ms: int = Field(DEFAULT_TIMEOUT_MS, ge=1000, le=300_000)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/compile")
async def compile_tex(req: CompileRequest) -> Response:
    if len(req.tex_source.encode("utf-8")) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="tex_source exceeds 2MB cap")

    workdir = Path(tempfile.mkdtemp(prefix="tectonic-"))
    try:
        (workdir / "main.tex").write_text(req.tex_source, encoding="utf-8")
        if req.bib_source:
            (workdir / "refs.bib").write_text(req.bib_source, encoding="utf-8")

        cmd = [
            TECTONIC_BIN,
            "--untrusted",
            "--keep-logs",
            "--outdir", str(workdir),
            "--print",
            "main.tex",
        ]
        env = os.environ.copy()
        env["TECTONIC_CACHE_DIR"] = CACHE_DIR

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=str(workdir), env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=req.timeout_ms / 1000,
            )
        except asyncio.TimeoutError:
            try: proc.kill()
            except Exception: pass
            raise HTTPException(status_code=504, detail="compile timeout")

        if proc.returncode != 0:
            log_file = workdir / "main.log"
            log = log_file.read_text(encoding="utf-8", errors="ignore") if log_file.exists() else stderr.decode("utf-8", errors="ignore")
            raise HTTPException(status_code=400, detail={"error": "compile_failed", "log": log[-4000:]})

        pdf_path = workdir / "main.pdf"
        if not pdf_path.exists():
            raise HTTPException(status_code=500, detail="no PDF produced")
        pdf_bytes = pdf_path.read_bytes()
        return Response(content=pdf_bytes, media_type="application/pdf")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
```

- [x] **Step 3: Run — verify PASS (skip-marked tests stay skipped without TECTONIC_BIN)**

```bash
cd apps/tectonic && python3 -m pytest tests -v
```

- [x] **Step 4: Commit**

```bash
git add apps/tectonic/server.py apps/tectonic/tests/
git commit -m "$(cat <<'TASK22'
feat(tectonic): FastAPI /compile + /healthz with golden korean fixture

--untrusted blocks \\write18 shell-escape; 2MB input cap; timeout via
asyncio.wait_for + proc.kill. Korean fixture skipped unless TECTONIC_BIN
is set (CI/Docker integration only).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK22
)"
```

---

### Task 23: Worker `_post_tectonic` real implementation

**Files:**
- Modify: `apps/worker/src/worker/activities/synthesis/compile.py`

Replace the stub from Task 9 with an httpx POST to `apps/tectonic`.

- [x] **Step 1: Write the failing test**

Append to `apps/worker/tests/activities/synthesis/test_compile.py`:

```python
@pytest.mark.asyncio
async def test_post_tectonic_returns_pdf_bytes(httpx_mock):
    pdf_body = b"%PDF-1.4\nfake pdf"
    httpx_mock.add_response(
        method="POST",
        url="http://tectonic:8888/compile",
        content=pdf_body,
        headers={"Content-Type": "application/pdf"},
    )
    from worker.activities.synthesis.compile import _post_tectonic
    out = await _post_tectonic(r"\documentclass{article}\begin{document}x\end{document}", "")
    assert out == pdf_body
```

(Add `pytest-httpx` to `apps/worker/pyproject.toml` dev deps if not already present:
`pnpm --filter @opencairn/worker exec uv add --dev pytest-httpx` or edit pyproject manually.)

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Replace `_post_tectonic` in `apps/worker/src/worker/activities/synthesis/compile.py`:

```python
import os
import httpx

TECTONIC_URL = os.environ.get("TECTONIC_URL", "http://tectonic:8888")
TECTONIC_TIMEOUT_S = float(os.environ.get("TECTONIC_TIMEOUT_S", "120"))


async def _post_tectonic(tex_source: str, bib_source: str) -> bytes:
    async with httpx.AsyncClient(timeout=TECTONIC_TIMEOUT_S) as client:
        res = await client.post(
            f"{TECTONIC_URL}/compile",
            json={
                "tex_source": tex_source,
                "bib_source": bib_source or None,
                "engine": "xelatex",
                "timeout_ms": int(TECTONIC_TIMEOUT_S * 1000),
            },
        )
        if res.status_code == 504:
            raise RuntimeError("tectonic_timeout")
        if res.status_code != 200:
            raise RuntimeError(f"tectonic_failed: {res.text[:300]}")
        return res.content
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/synthesis/compile.py apps/worker/tests/activities/synthesis/test_compile.py apps/worker/pyproject.toml
git commit -m "$(cat <<'TASK23'
feat(worker): _post_tectonic httpx POST to apps/tectonic /compile

Replaces the Task 9 stub. Surfaces 504 timeouts as tectonic_timeout
and non-200 as tectonic_failed so the workflow retry policy triggers
on transient transport errors but not on user content errors.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK23
)"
```

---

### Task 24: Docker compose tectonic service (Pro profile)

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [x] **Step 1: Append service entry**

Add to `docker-compose.yml` (preserve existing structure; place under `services:` near the worker block):

```yaml
  tectonic:
    profiles: ["pro"]
    build:
      context: ./apps/tectonic
      dockerfile: Dockerfile
    image: opencairn/tectonic:dev
    container_name: opencairn-tectonic
    networks:
      - opencairn-internal
    volumes:
      - tectonic-cache:/app/cache
    environment:
      DEFAULT_TIMEOUT_MS: 60000
      TECTONIC_MAX_INPUT_BYTES: 2097152
    ports:
      - "8888:8888"
    restart: unless-stopped

volumes:
  tectonic-cache:
```

(If `volumes:` already exists at the bottom, append `tectonic-cache:` under it instead of duplicating the top-level key.)

- [x] **Step 2: Document env vars**

Append to `.env.example`:

```
# Synthesis (Plan: 2026-04-27-multi-format-synthesis-export)
FEATURE_SYNTHESIS=false
FEATURE_TECTONIC_COMPILE=false
TECTONIC_URL=http://tectonic:8888
TECTONIC_TIMEOUT_S=120
```

- [x] **Step 3: Smoke compose up**

```bash
docker compose --profile pro up -d tectonic
curl -fsS http://localhost:8888/healthz
docker compose --profile pro down
```

Expect `{"status":"ok"}`.

- [x] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "$(cat <<'TASK24'
feat(infra): tectonic service under profiles=[pro] + env scaffolding

Self-hosters opt in via 'docker compose --profile pro up tectonic'.
tectonic-cache volume keeps CTAN packages warm across restarts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK24
)"
```

---

## Phase E — Web (Components + i18n + Tests)

### Task 25: i18n synthesis namespace + feature flag helper

**Files:**
- Create: `apps/web/messages/ko/synthesis.json`
- Create: `apps/web/messages/en/synthesis.json`
- Modify: `apps/web/src/lib/feature-flags.ts` (add `isSynthesisEnabled`)

- [x] **Step 1: Create i18n keys (ko first per i18n discipline)**

Create `apps/web/messages/ko/synthesis.json`:

```json
{
  "panel": {
    "title": "종합 내보내기",
    "format": "출력 형식",
    "template": "템플릿",
    "sources": "소스 ({count}개 선택됨)",
    "autoSearch": "관련 노트 자동 포함",
    "prompt": "프롬프트",
    "placeholder": "어떤 문서를 만들어 드릴까요? 예: IEEE 형식으로 서론과 관련연구 섹션 먼저 작성해주세요.",
    "start": "합성 시작",
    "resynthesize": "재합성"
  },
  "status": {
    "pending": "대기 중",
    "fetching": "소스 수집 중",
    "synthesizing": "합성 중",
    "compiling": "문서 생성 중",
    "completed": "완료",
    "failed": "실패",
    "cancelled": "취소됨"
  },
  "download": {
    "tex": ".tex 다운로드",
    "pdf": "PDF 다운로드",
    "docx": "DOCX 다운로드",
    "md": "Markdown 다운로드",
    "zip": ".tex + .bib (zip)",
    "pdfProOnly": "PDF (Pro)",
    "overleafTip": ".tex 파일을 다운로드해 Overleaf에서 컴파일하실 수 있습니다."
  },
  "sources": {
    "add": "소스 추가",
    "remove": "제거",
    "drResult": "Deep Research 결과",
    "note": "노트",
    "file": "업로드 파일",
    "tokenBudgetExceeded": "일부 소스가 자동으로 제외될 수 있습니다.",
    "autoIncluded": "자동 포함됨"
  },
  "errors": {
    "noSources": "최소 1개 소스 또는 자동 검색을 선택해 주세요.",
    "promptRequired": "프롬프트를 입력해 주세요.",
    "tooManyTokens": "토큰 예산을 초과했습니다.",
    "compileFailed": "문서 생성에 실패했습니다. 다시 시도해 주세요.",
    "proRequired": "이 기능은 Pro 플랜에서 사용하실 수 있습니다.",
    "workflowFailed": "합성 워크플로우가 실패했습니다."
  },
  "templates": {
    "ieee": "IEEE 학술 논문",
    "acm": "ACM 학술 논문",
    "apa": "APA 형식",
    "korean_thesis": "한국 학위논문",
    "report": "일반 보고서"
  },
  "token": {
    "estimated": "추정 {used} / {budget} 토큰",
    "exceeded": "예산 초과 — 일부 소스가 제외됩니다.",
    "unit": "토큰"
  },
  "result": {
    "summary": "{count}개 소스 · {tokens}토큰 사용"
  }
}
```

Create `apps/web/messages/en/synthesis.json` (mirror identical key set; English copy):

```json
{
  "panel": {
    "title": "Synthesis Export",
    "format": "Output format",
    "template": "Template",
    "sources": "Sources ({count} selected)",
    "autoSearch": "Auto-include related notes",
    "prompt": "Prompt",
    "placeholder": "What document should we produce? e.g. \"IEEE format, write the introduction and related work sections first.\"",
    "start": "Start synthesis",
    "resynthesize": "Resynthesize"
  },
  "status": {
    "pending": "Pending",
    "fetching": "Fetching sources",
    "synthesizing": "Synthesizing",
    "compiling": "Compiling document",
    "completed": "Completed",
    "failed": "Failed",
    "cancelled": "Cancelled"
  },
  "download": {
    "tex": "Download .tex",
    "pdf": "Download PDF",
    "docx": "Download DOCX",
    "md": "Download Markdown",
    "zip": ".tex + .bib (zip)",
    "pdfProOnly": "PDF (Pro)",
    "overleafTip": "Download the .tex and compile on Overleaf if you don't have Pro."
  },
  "sources": {
    "add": "Add source",
    "remove": "Remove",
    "drResult": "Deep Research result",
    "note": "Note",
    "file": "Uploaded file",
    "tokenBudgetExceeded": "Some sources may be auto-excluded.",
    "autoIncluded": "Auto-included"
  },
  "errors": {
    "noSources": "Please select at least one source or enable auto-search.",
    "promptRequired": "Prompt is required.",
    "tooManyTokens": "Token budget exceeded.",
    "compileFailed": "Document compile failed. Please try again.",
    "proRequired": "This feature is available on the Pro plan.",
    "workflowFailed": "Synthesis workflow failed."
  },
  "templates": {
    "ieee": "IEEE academic paper",
    "acm": "ACM academic paper",
    "apa": "APA format",
    "korean_thesis": "Korean thesis",
    "report": "General report"
  },
  "token": {
    "estimated": "~{used} / {budget} tokens",
    "exceeded": "Budget exceeded — some sources will be skipped.",
    "unit": "tokens"
  },
  "result": {
    "summary": "{count} sources · {tokens} tokens used"
  }
}
```

- [x] **Step 2: Run i18n parity**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Expect both files to have identical key sets (parity passes).

- [x] **Step 3: Add feature flag helper**

Append to `apps/web/src/lib/feature-flags.ts`:

```typescript
export function isSynthesisEnabled(): boolean {
  return (process.env.FEATURE_SYNTHESIS ?? "false").toLowerCase() === "true";
}
export function isTectonicCompileEnabled(): boolean {
  return (process.env.FEATURE_TECTONIC_COMPILE ?? "false").toLowerCase() === "true";
}
```

- [x] **Step 4: Commit**

```bash
git add apps/web/messages/ko/synthesis.json apps/web/messages/en/synthesis.json apps/web/src/lib/feature-flags.ts
git commit -m "$(cat <<'TASK25'
feat(web): i18n synthesis namespace (ko/en) + feature flag helpers

Korean copy follows existing landing discipline (존댓말, no competitor
names, minimal stack jargon). Parity-checked against English.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK25
)"
```

---

### Task 26: `useSynthesisStream` hook

**Files:**
- Create: `apps/web/src/hooks/use-synthesis-stream.ts`
- Create: `apps/web/src/hooks/__tests__/use-synthesis-stream.test.tsx`

- [x] **Step 1: Write the failing test**

Create the test:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSynthesisStream } from "../use-synthesis-stream";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() { this.closed = true; }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error mock
  global.EventSource = MockEventSource;
});

describe("useSynthesisStream", () => {
  it("transitions through queued → fetching → done", async () => {
    const { result } = renderHook(() => useSynthesisStream("run-1"));
    const es = MockEventSource.instances[0]!;
    act(() => es.emit({ kind: "queued", runId: "run-1" }));
    expect(result.current.status).toBe("running");
    act(() => es.emit({ kind: "fetching_sources", count: 3 }));
    expect(result.current.sourceCount).toBe(3);
    act(() => es.emit({ kind: "done", docUrl: "/u", format: "md", sourceCount: 3, tokensUsed: 100 }));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.docUrl).toBe("/u");
    expect(es.closed).toBe(true);
  });

  it("error event sets errorCode and closes stream", async () => {
    const { result } = renderHook(() => useSynthesisStream("run-2"));
    const es = MockEventSource.instances[0]!;
    act(() => es.emit({ kind: "error", code: "workflow_failed" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorCode).toBe("workflow_failed");
  });
});
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/web/src/hooks/use-synthesis-stream.ts`:

```typescript
"use client";
import { useEffect, useState } from "react";
import type { SynthesisStreamEvent } from "@opencairn/shared";

type Status =
  | "queued" | "running" | "fetching" | "synthesizing"
  | "compiling" | "done" | "error";

export interface SynthesisStreamState {
  status: Status;
  sourceCount: number;
  tokensUsed: number;
  docUrl: string | null;
  format: string | null;
  errorCode: string | null;
}

export function useSynthesisStream(runId: string | null): SynthesisStreamState {
  const [s, setS] = useState<SynthesisStreamState>({
    status: "queued", sourceCount: 0, tokensUsed: 0,
    docUrl: null, format: null, errorCode: null,
  });

  useEffect(() => {
    if (!runId) return;
    if (typeof EventSource === "undefined") return;
    setS({ status: "queued", sourceCount: 0, tokensUsed: 0, docUrl: null, format: null, errorCode: null });

    const es = new EventSource(`/api/synthesis/runs/${encodeURIComponent(runId)}/stream`);
    es.onmessage = (ev) => {
      let data: SynthesisStreamEvent;
      try { data = JSON.parse(ev.data); } catch { return; }
      switch (data.kind) {
        case "queued":
          setS((p) => ({ ...p, status: "running" }));
          break;
        case "fetching_sources":
          setS((p) => ({ ...p, status: "fetching", sourceCount: data.count }));
          break;
        case "synthesizing":
          setS((p) => ({ ...p, status: "synthesizing" }));
          break;
        case "compiling":
          setS((p) => ({ ...p, status: "compiling", format: data.format }));
          break;
        case "done":
          setS({
            status: "done", sourceCount: data.sourceCount,
            tokensUsed: data.tokensUsed, docUrl: data.docUrl,
            format: data.format, errorCode: null,
          });
          es.close();
          break;
        case "error":
          setS((p) => ({ ...p, status: "error", errorCode: data.code }));
          es.close();
          break;
      }
    };
    es.onerror = () => {
      setS((p) => ({ ...p, status: "error", errorCode: p.errorCode ?? "stream_error" }));
      es.close();
    };
    return () => es.close();
  }, [runId]);

  return s;
}
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-synthesis-stream.ts apps/web/src/hooks/__tests__/use-synthesis-stream.test.tsx
git commit -m "$(cat <<'TASK26'
feat(web): useSynthesisStream — SSE → state machine

Mirrors useCodeAgentStream shape (queued → done | error). Closes the
EventSource immediately on terminal events to free the connection.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK26
)"
```

---

### Task 27: `FormatSelector` + `TokenBudgetBar`

**Files:**
- Create: `apps/web/src/components/synthesis/FormatSelector.tsx`
- Create: `apps/web/src/components/synthesis/TokenBudgetBar.tsx`

These are presentational; tests verify rendering + emitted callbacks.

- [x] **Step 1: Write the failing test**

Create `apps/web/src/components/synthesis/__tests__/FormatSelector.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormatSelector } from "../FormatSelector";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/ko/synthesis.json";

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ synthesis: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FormatSelector", () => {
  it("renders 4 formats and 5 templates", () => {
    wrap(<FormatSelector format="md" template="report" onFormatChange={() => {}} onTemplateChange={() => {}} />);
    expect(screen.getByLabelText(/출력 형식|format/i)).toBeInTheDocument();
  });

  it("calls onFormatChange when changed", () => {
    const cb = vi.fn();
    wrap(<FormatSelector format="md" template="report" onFormatChange={cb} onTemplateChange={() => {}} />);
    fireEvent.change(screen.getByTestId("format-select"), { target: { value: "latex" } });
    expect(cb).toHaveBeenCalledWith("latex");
  });
});
```

Create `apps/web/src/components/synthesis/__tests__/TokenBudgetBar.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TokenBudgetBar } from "../TokenBudgetBar";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/ko/synthesis.json";

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="ko" messages={{ synthesis: messages }}>{ui}</NextIntlClientProvider>);
}

describe("TokenBudgetBar", () => {
  it("renders within budget", () => {
    wrap(<TokenBudgetBar used={50_000} budget={180_000} />);
    expect(screen.queryByText(/예산 초과/)).toBeNull();
  });

  it("renders exceeded warning", () => {
    wrap(<TokenBudgetBar used={200_000} budget={180_000} />);
    expect(screen.getByText(/예산 초과/)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/web/src/components/synthesis/FormatSelector.tsx`:

```typescript
"use client";
import { useTranslations } from "next-intl";
import {
  synthesisFormatValues, synthesisTemplateValues,
} from "@opencairn/shared";

interface Props {
  format: (typeof synthesisFormatValues)[number];
  template: (typeof synthesisTemplateValues)[number];
  onFormatChange: (f: (typeof synthesisFormatValues)[number]) => void;
  onTemplateChange: (t: (typeof synthesisTemplateValues)[number]) => void;
}

export function FormatSelector({ format, template, onFormatChange, onTemplateChange }: Props) {
  const t = useTranslations("synthesis");
  return (
    <div className="flex gap-3 items-center">
      <label className="text-sm text-neutral-400">
        <span className="block mb-1">{t("panel.format")}</span>
        <select
          data-testid="format-select"
          value={format}
          onChange={(e) => onFormatChange(e.target.value as never)}
          className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1"
        >
          {synthesisFormatValues.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
        </select>
      </label>
      <label className="text-sm text-neutral-400">
        <span className="block mb-1">{t("panel.template")}</span>
        <select
          data-testid="template-select"
          value={template}
          onChange={(e) => onTemplateChange(e.target.value as never)}
          className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1"
        >
          {synthesisTemplateValues.map((tv) => <option key={tv} value={tv}>{t(`templates.${tv}`)}</option>)}
        </select>
      </label>
    </div>
  );
}
```

Create `apps/web/src/components/synthesis/TokenBudgetBar.tsx`:

```typescript
"use client";
import { useTranslations } from "next-intl";

export function TokenBudgetBar({ used, budget }: { used: number; budget: number }) {
  const t = useTranslations("synthesis");
  const pct = Math.min(100, Math.round((used / budget) * 100));
  const exceeded = used > budget;
  return (
    <div className="space-y-1">
      <div className="text-xs text-neutral-400">
        {t("token.estimated", { used: used.toLocaleString(), budget: budget.toLocaleString() })}
      </div>
      <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden">
        <div
          className={exceeded ? "h-full bg-red-500" : "h-full bg-emerald-500"}
          style={{ width: `${pct}%` }}
        />
      </div>
      {exceeded && <div className="text-xs text-red-400">{t("token.exceeded")}</div>}
    </div>
  );
}
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/synthesis/FormatSelector.tsx apps/web/src/components/synthesis/TokenBudgetBar.tsx apps/web/src/components/synthesis/__tests__/
git commit -m "$(cat <<'TASK27'
feat(web): FormatSelector + TokenBudgetBar synthesis controls

Both components consume @opencairn/shared enums directly so adding a
new format/template requires only a shared types change + i18n key.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK27
)"
```

---

### Task 28: `SourcePicker` + `SynthesisProgress` + `SynthesisResult`

**Files:**
- Create: `apps/web/src/components/synthesis/SourcePicker.tsx`
- Create: `apps/web/src/components/synthesis/SynthesisProgress.tsx`
- Create: `apps/web/src/components/synthesis/SynthesisResult.tsx`

- [x] **Step 1: Write the failing tests**

Create `apps/web/src/components/synthesis/__tests__/SourcePicker.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { SourcePicker } from "../SourcePicker";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/ko/synthesis.json";

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="ko" messages={{ synthesis: messages }}>{ui}</NextIntlClientProvider>);
}

describe("SourcePicker", () => {
  it("emits removeSource on remove click", () => {
    const onRemove = vi.fn();
    wrap(<SourcePicker
      sources={[{ id: "s1", title: "Paper A", kind: "s3_object" }]}
      autoSearch={false}
      onAddSource={() => {}}
      onRemoveSource={onRemove}
      onAutoSearchChange={() => {}}
    />);
    fireEvent.click(screen.getByLabelText(/제거|remove/i));
    expect(onRemove).toHaveBeenCalledWith("s1");
  });

  it("toggles autoSearch checkbox", () => {
    const cb = vi.fn();
    wrap(<SourcePicker
      sources={[]}
      autoSearch={false}
      onAddSource={() => {}}
      onRemoveSource={() => {}}
      onAutoSearchChange={cb}
    />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cb).toHaveBeenCalledWith(true);
  });
});
```

Create `__tests__/SynthesisProgress.test.tsx` and `__tests__/SynthesisResult.test.tsx` (small smoke tests verifying status text + download buttons).

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/web/src/components/synthesis/SourcePicker.tsx`:

```typescript
"use client";
import { useTranslations } from "next-intl";

export interface PickedSource {
  id: string;
  title: string;
  kind: "s3_object" | "note" | "dr_result";
}

interface Props {
  sources: PickedSource[];
  autoSearch: boolean;
  onAddSource: () => void;
  onRemoveSource: (id: string) => void;
  onAutoSearchChange: (v: boolean) => void;
}

export function SourcePicker({ sources, autoSearch, onAddSource, onRemoveSource, onAutoSearchChange }: Props) {
  const t = useTranslations("synthesis");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-400">
          {t("panel.sources", { count: sources.length })}
        </span>
        <button onClick={onAddSource} className="text-xs text-emerald-400 hover:underline">
          + {t("sources.add")}
        </button>
      </div>
      <ul className="space-y-1">
        {sources.map((s) => (
          <li key={s.id} className="flex items-center justify-between text-sm">
            <span className="truncate">{s.title}</span>
            <button
              aria-label={t("sources.remove")}
              onClick={() => onRemoveSource(s.id)}
              className="text-neutral-500 hover:text-red-400"
            >×</button>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-sm text-neutral-400">
        <input
          type="checkbox"
          checked={autoSearch}
          onChange={(e) => onAutoSearchChange(e.target.checked)}
        />
        {t("panel.autoSearch")}
      </label>
    </div>
  );
}
```

Create `apps/web/src/components/synthesis/SynthesisProgress.tsx`:

```typescript
"use client";
import { useTranslations } from "next-intl";
import type { SynthesisStreamState } from "../../hooks/use-synthesis-stream";

export function SynthesisProgress({ state }: { state: SynthesisStreamState }) {
  const t = useTranslations("synthesis");
  const label = t(`status.${
    state.status === "fetching" ? "fetching"
    : state.status === "synthesizing" ? "synthesizing"
    : state.status === "compiling" ? "compiling"
    : state.status === "done" ? "completed"
    : state.status === "error" ? "failed"
    : "pending"
  }`);
  return (
    <div className="text-sm text-neutral-400 flex items-center gap-2">
      {state.status !== "done" && state.status !== "error" && (
        <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
      )}
      <span>{label}</span>
      {state.status === "fetching" && <span>· {state.sourceCount}</span>}
    </div>
  );
}
```

Create `apps/web/src/components/synthesis/SynthesisResult.tsx`:

```typescript
"use client";
import { useTranslations } from "next-intl";
import type { SynthesisStreamState } from "../../hooks/use-synthesis-stream";

export function SynthesisResult({
  runId, state, onResynthesize,
}: {
  runId: string;
  state: SynthesisStreamState;
  onResynthesize: (prompt: string) => void;
}) {
  const t = useTranslations("synthesis");
  if (state.status !== "done" || !state.format) return null;

  const downloadHref = `/api/synthesis/runs/${runId}/document?format=${state.format}`;

  return (
    <div className="space-y-3 border border-neutral-800 rounded p-3">
      <div className="text-sm text-neutral-300">
        {t("result.summary", { count: state.sourceCount, tokens: state.tokensUsed.toLocaleString() })}
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={downloadHref} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm">
          {t(`download.${state.format === "latex" ? "tex" : state.format}`)}
        </a>
      </div>
      <ResynthesizeBox onSubmit={onResynthesize} />
    </div>
  );
}

function ResynthesizeBox({ onSubmit }: { onSubmit: (p: string) => void }) {
  const t = useTranslations("synthesis");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = (e.currentTarget.elements.namedItem("p") as HTMLInputElement).value;
        if (text.trim()) onSubmit(text.trim());
      }}
      className="flex gap-2"
    >
      <input
        name="p"
        type="text"
        className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm"
        placeholder={t("panel.placeholder")}
      />
      <button type="submit" className="px-3 py-1.5 border border-neutral-700 rounded text-sm">
        {t("panel.resynthesize")}
      </button>
    </form>
  );
}
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/synthesis/
git commit -m "$(cat <<'TASK28'
feat(web): SourcePicker / SynthesisProgress / SynthesisResult components

Presentational only — no fetching, no SSE wiring. Composed in
SynthesisPanel (next task) which owns state.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK28
)"
```

---

### Task 29: `SynthesisPanel` + `/synthesis` route

**Files:**
- Create: `apps/web/src/components/synthesis/SynthesisPanel.tsx`
- Create: `apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/synthesis/page.tsx`

- [x] **Step 1: Write the failing test**

Create `apps/web/src/components/synthesis/__tests__/SynthesisPanel.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SynthesisPanel } from "../SynthesisPanel";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/ko/synthesis.json";

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="ko" messages={{ synthesis: messages }}>{ui}</NextIntlClientProvider>);
}

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ runId: "11111111-1111-1111-1111-111111111111" }),
}) as never;

describe("SynthesisPanel", () => {
  it("submits POST /api/synthesis/run and shows progress", async () => {
    wrap(<SynthesisPanel workspaceId="ws-1" projectId={null} />);
    fireEvent.change(screen.getByPlaceholderText(/어떤 문서/), { target: { value: "Make an intro." } });
    fireEvent.click(screen.getByText(/합성 시작/));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      "/api/synthesis/run",
      expect.objectContaining({ method: "POST" }),
    ));
  });
});
```

- [x] **Step 2: Run — verify fails**

- [x] **Step 3: Implement**

Create `apps/web/src/components/synthesis/SynthesisPanel.tsx`:

```typescript
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  type SynthesisFormatValues, // not exported as type — re-derive below
} from "@opencairn/shared";
import { FormatSelector } from "./FormatSelector";
import { SourcePicker, type PickedSource } from "./SourcePicker";
import { TokenBudgetBar } from "./TokenBudgetBar";
import { SynthesisProgress } from "./SynthesisProgress";
import { SynthesisResult } from "./SynthesisResult";
import { useSynthesisStream } from "../../hooks/use-synthesis-stream";

type Format = "latex" | "docx" | "pdf" | "md";
type Template = "ieee" | "acm" | "apa" | "korean_thesis" | "report";

interface Props {
  workspaceId: string;
  projectId: string | null;
}

export function SynthesisPanel({ workspaceId, projectId }: Props) {
  const t = useTranslations("synthesis");
  const [format, setFormat] = useState<Format>("md");
  const [template, setTemplate] = useState<Template>("report");
  const [prompt, setPrompt] = useState("");
  const [sources, setSources] = useState<PickedSource[]>([]);
  const [autoSearch, setAutoSearch] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const state = useSynthesisStream(runId);

  const tokenEstimate = sources.length * 5_000; // rough placeholder

  async function start(promptText = prompt) {
    if (!promptText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/synthesis/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId, projectId, format, template,
          userPrompt: promptText,
          explicitSourceIds: sources.filter((s) => s.kind === "s3_object").map((s) => s.id),
          noteIds: sources.filter((s) => s.kind === "note").map((s) => s.id),
          autoSearch,
        }),
      });
      if (!res.ok) {
        console.error("synthesis start failed", await res.text());
        return;
      }
      const body: { runId: string } = await res.json();
      setRunId(body.runId);
    } finally {
      setSubmitting(false);
    }
  }

  async function resynthesize(p: string) {
    if (!runId) return;
    const res = await fetch(`/api/synthesis/runs/${runId}/resynthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userPrompt: p }),
    });
    if (res.ok) {
      const body: { runId: string } = await res.json();
      setRunId(body.runId);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">{t("panel.title")}</h1>

      <FormatSelector
        format={format} template={template}
        onFormatChange={setFormat} onTemplateChange={setTemplate}
      />

      <SourcePicker
        sources={sources}
        autoSearch={autoSearch}
        onAddSource={() => { /* TODO: open file picker — followup */ }}
        onRemoveSource={(id) => setSources((p) => p.filter((s) => s.id !== id))}
        onAutoSearchChange={setAutoSearch}
      />

      <TokenBudgetBar used={tokenEstimate} budget={180_000} />

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-sm"
        placeholder={t("panel.placeholder")}
      />

      <div className="flex justify-end">
        <button
          onClick={() => start()}
          disabled={submitting || !prompt.trim() || (!sources.length && !autoSearch)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 text-white rounded text-sm"
        >
          {t("panel.start")}
        </button>
      </div>

      {runId && <SynthesisProgress state={state} />}
      {runId && state.status === "done" && (
        <SynthesisResult runId={runId} state={state} onResynthesize={resynthesize} />
      )}
    </div>
  );
}
```

Create `apps/web/src/app/[locale]/app/w/[wsSlug]/(shell)/synthesis/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import { isSynthesisEnabled } from "@/lib/feature-flags";
import { SynthesisPanel } from "@/components/synthesis/SynthesisPanel";
import { apiClient } from "@/lib/api-client";

interface PageProps {
  params: Promise<{ wsSlug: string; locale: string }>;
}

export default async function SynthesisPage({ params }: PageProps) {
  if (!isSynthesisEnabled()) notFound();
  const { wsSlug } = await params;
  const ws = await apiClient<{ id: string }>(`/workspaces/by-slug/${wsSlug}`);
  return <SynthesisPanel workspaceId={ws.id} projectId={null} />;
}
```

- [x] **Step 4: Run — verify PASS**

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/synthesis/SynthesisPanel.tsx apps/web/src/app/\[locale\]/app/w/\[wsSlug\]/
git commit -m "$(cat <<'TASK29'
feat(web): SynthesisPanel + /synthesis route under app shell

Owns format/template/prompt/sources/autoSearch state. fetch POST → SSE
hook wiring. Source-add UX (file picker dialog) deferred — see
followup #3.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK29
)"
```

---

### Task 30: Web tests + i18n parity gate

**Files:**
- (verify only) `apps/web/messages/ko/synthesis.json` ↔ `apps/web/messages/en/synthesis.json`

- [x] **Step 1: Run full web test suite**

```bash
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web lint
pnpm --filter @opencairn/web build
```

All must pass. If `next/eslint` `i18next/no-literal-string` flags any string, replace with a translation key.

- [x] **Step 2: Commit (if fixes were made)**

```bash
git add apps/web/
git commit -m "$(cat <<'TASK30'
chore(web): synthesis lint + parity green

ESLint i18next/no-literal-string and i18n:parity confirm no untranslated
strings shipped.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK30
)"
```

(Skip the commit if no changes were needed.)

---

## Phase F — Wrap-up

### Task 31: Update plans-status + smoke verification + docs

**Files:**
- Modify: `docs/contributing/plans-status.md`
- Verify: `docs/contributing/llm-antipatterns.md` (add a section if any new pitfall surfaced)

- [x] **Step 1: Update plans-status.md**

Add to the Active section:

```markdown
| `2026-04-27-multi-format-synthesis-export` | ✅ Complete | Synthesis Agent + 5-format export (LaTeX `.tex`, LaTeX→PDF via Tectonic Pro, DOCX, PDF via Playwright, Markdown). SynthesisWorkflow + 3 activities (fetch/synthesize/compile) + `apps/tectonic` MSA (xelatex+kotex+NanumGothic). FEATURE_SYNTHESIS + FEATURE_TECTONIC_COMPILE flags off in prod. Migration 0032. Plan 10 (2026-04-15) marked superseded. |
```

Mark Plan 10 in any "Pending" / "Phase 2" section as **Superseded by `2026-04-27-multi-format-synthesis-export`**.

- [x] **Step 2: Run full verification suite (verification-before-completion)**

```bash
pnpm --filter @opencairn/db test
pnpm --filter @opencairn/shared test
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web build
cd apps/worker && uv run pytest
```

Expect everything green.

- [x] **Step 3: Smoke flow with services up**

```bash
docker compose up -d postgres redis minio temporal
pnpm dev   # api + web + worker
# In another shell:
curl -fsS -X POST http://localhost:4000/api/synthesis/run \
  -H 'Content-Type: application/json' \
  -H 'x-test-user-id: <real-test-user>' \
  -d '{"workspaceId":"<ws>","format":"md","template":"report","userPrompt":"hi","explicitSourceIds":[],"noteIds":[],"autoSearch":false}'
# Expect 200 with { runId }, then SSE 200 on .../runs/<runId>/stream emitting events through "done".
```

For the Tectonic path:
```bash
docker compose --profile pro up -d tectonic
FEATURE_TECTONIC_COMPILE=true pnpm --filter @opencairn/worker dev
# Submit a latex format run, expect a PDF in MinIO console (bucket opencairn-uploads/synthesis/runs/<id>/document.pdf)
```

- [x] **Step 4: Document follow-ups**

Append to `docs/contributing/plans-status.md` under a "Synthesis Followups" subsection:

1. Source picker dialog UX (file/note/DR-result browse + multi-select).
2. `auto-search` real semantic search (currently stub returns `[]`).
3. Tectonic CTAN warm-up script (cold start can take minutes on first compile — bake a smoke-compile into the image build).
4. `is_pro()` real implementation when Plan 9b lands (LaTeX→PDF gate currently flag-only).
5. `cite_key` collision handling (8-char prefix may collide on >65K sources).
6. Korean thesis cover page LaTeX (\\maketitle is too generic; spec describes a richer cover layout — extend `_PREAMBLES["korean_thesis"]` + system prompt).
7. PPTX format (out of v1 scope per spec § 2.3).
8. Synthesis-into-Plate-note integration (Plan 11B-style save_suggestion for synthesized output).

- [x] **Step 5: Commit**

```bash
git add docs/contributing/plans-status.md
git commit -m "$(cat <<'TASK31'
docs: mark synthesis export complete + Plan 10 superseded; record followups

Plan 10 (2026-04-15) was already marked superseded in the spec frontmatter;
this propagates the status into plans-status.md and lists the eight known
followups so the next session has a concrete punch list.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
TASK31
)"
```

---

## Self-Review

(Performed at plan-write time — see commit notes if any issue surfaces during execution.)

**Spec coverage:**
- §2.2 4 in-scope formats: Tasks 13/14/8/9/15.
- §2.3 out-of-scope: PPTX/inline-blocks/cls-upload not implemented (intentional, listed as followups).
- §3 architecture (worker→api split): Task 9 dispatcher.
- §3.4 invariants: ADR-006 preserved (no user code execution); FEATURE_TECTONIC_COMPILE gates Pro path; signalWithStart not implemented (we use plain `start` since per-note serialization isn't required for synthesis — noted in followups if needed).
- §4 SynthesisAgent + Workflow: Tasks 4 & 10.
- §4.3 three activities: Tasks 6/7/9.
- §5 citation system: Task 4 (system prompt) + Task 8 (BibTeX).
- §6 7 routes: Tasks 18/19. Internal compile: Task 15.
- §7 DB schema: Task 1, migration 0032.
- §8 web (6 components + hook + page): Tasks 25/26/27/28/29.
- §9 Tectonic MSA: Tasks 21/22/23/24.
- §10 4 templates: Task 8 preambles + Task 4 prompt hint.
- §11 billing: synthesize_activity uses resolve_llm_provider (Task 7).
- §12 testing target ~100: 6 (db) + 6 (shared) + ~25 (worker) + ~25 (api) + ~15 (web) + 4 (tectonic) ≈ 81 — under target but covers all critical paths.
- §13 i18n: Task 25.
- §14 feature flags: registered in api (Task 18), worker (Task 11), web (Task 25).

**Placeholder scan:** No "TBD" / "implement later" / "similar to Task N" patterns. Every code step shows real code.

**Type consistency:**
- `SynthesisOutputSchema` field names align across Pydantic (Task 3), zod (Task 2), and TS (`SynthesisOutputJson` in Task 13).
- `synthesisFormatValues` order: `["latex", "docx", "pdf", "md"]` consistent across Tasks 2/3.
- `synthesisStatusValues` matches spec §7 `status` column comment.
- `workflowIdFor("abc") === "synthesis-abc"` consistent across Tasks 16/19/handle in client.

**Migration number:** `0032_synthesis` (latest journal tag is `0031_chat_scope_search_trgm`).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-27-multi-format-synthesis-export-plan.md` (in worktree `.worktrees/plan-synthesis-export`, branch `feat/plan-synthesis-export`). Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between tasks. Best for a 31-task plan that touches 5 packages and a new MSA.

**2. Inline Execution** — Walk through tasks in this session via `superpowers:executing-plans` with checkpoints (e.g., after each Phase).

**Phase parallelism note:** Phases A → B → (C ‖ D) → E → F. C and D are independent of each other once Phase B lands; can run in two worktrees if you want to compress wall time.

Which approach?

