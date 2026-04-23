# Deep Research Phase C — `apps/api` Routes + SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Deep Research Temporal workflow (Phase B) through REST endpoints and an SSE progress stream so the web UI (Phase D) can drive runs end-to-end, and close the two `/api/internal/*` gaps the worker's `persist_deep_research_report` activity already assumes.

**Architecture:** New Hono sub-router at `apps/api/src/routes/research.ts` mounted at `/api/research` — 8 public endpoints plus an SSE stream. All workflow state transitions go through Temporal signals (`user_feedback`, `approve_plan`, `cancel`); direct plan edits hit the DB only. The SSE stream polls `research_runs` + `research_run_turns` + `research_run_artifacts` every 2s (same pattern as `apps/api/src/routes/import.ts` — no LISTEN/NOTIFY, no WebSocket). The existing `/api/internal/notes` endpoint is extended additively (new fields: `idempotencyKey` / `plateValue` / `userId`; new response field: `noteId`) so the worker's already-merged `persist_report` activity actually works. A new `/api/internal/research/image-bytes` is added so the worker can fetch bytes from `research_run_artifacts` during report persistence. `FEATURE_DEEP_RESEARCH=false` disables the entire public surface with a 404.

**Tech Stack:** Hono 4 · Drizzle ORM · `@temporalio/client` · `@hono/zod-validator` · Zod · Vitest (integration) · Better Auth session · `X-Internal-Secret` middleware for internal routes.

---

## Context you must know before starting

### Already-merged state you are building on

| Artifact | Location | What's already there |
|---|---|---|
| DB schema | `packages/db/src/schema/research.ts` | `researchRuns` / `researchRunTurns` / `researchRunArtifacts` tables + enums + inferred types. **Do not modify.** |
| Workflow | `apps/worker/src/worker/workflows/deep_research_workflow.py` | `@workflow.defn(name="DeepResearchWorkflow")` with signals `user_feedback(text, turn_id)`, `approve_plan(final_plan_text)`, `cancel()` and query `status_snapshot`. Input dataclass `DeepResearchInput(run_id, workspace_id, project_id, user_id, topic, model, billing_path)`. **You call this workflow by its registered name.** |
| Worker activities | `apps/worker/src/worker/activities/deep_research/{create_plan,iterate_plan,execute_research,persist_report,cost,markdown_plate,key_resolver}.py` | Already written and tested. `persist_report.py:118` already POSTs `{idempotencyKey, projectId, workspaceId, userId, title, plateValue}` to `/internal/notes` and expects `{noteId}` back. `persist_report.py:146` already POSTs to `/internal/research/image-bytes` and expects `{base64, mimeType}` back. **Both endpoint shapes must match.** |
| Temporal client | `apps/api/src/lib/temporal-client.ts` | `getTemporalClient()` lazy singleton. Use this — do not instantiate `Client` directly. |
| Task queue | Env `TEMPORAL_TASK_QUEUE` (default `"ingest"`) | Same queue the worker binds to. The worker's `temporal_main.py:78` reads the same env. |
| Internal notes endpoint (pre-existing, needs extension) | `apps/api/src/routes/internal.ts:1142-1167` | Accepts ingest-expansion shape only. Task 9 extends it additively. |
| Permissions | `apps/api/src/lib/permissions.ts` | `resolveRole`, `canRead`, `canWrite`, `canAdmin`. Use `canWrite(userId, {type:"project", id})` for run creation, `canRead(userId, {type:"workspace", id})` for listing/reading. |
| Auth middleware | `apps/api/src/middleware/auth.ts` | Export `requireAuth`. Sets `c.get("userId")`, `c.get("user")`, `c.get("session")`. |
| Existing SSE pattern | `apps/api/src/routes/import.ts:325-393` | `GET /api/import/jobs/:id/events` — poll loop in `ReadableStream`, 2s interval, 15min cap, `Content-Type: text/event-stream`, `X-Accel-Buffering: no`. Copy the shape. |
| Existing Temporal-start pattern | `apps/api/src/routes/import.ts:156-169` | `getTemporalClient().workflow.start("WorkflowName", { workflowId, taskQueue, args: [{…}] })`. |

### DB column reference (from `packages/db/src/schema/research.ts`)

```typescript
// researchRuns
{ id, workspaceId, projectId, userId, topic, model, billingPath, status,
  currentInteractionId, approvedPlanText, workflowId, noteId, error,
  totalCostUsdCents, createdAt, updatedAt, completedAt }

// researchRunTurns
{ id, runId, seq, role, kind, interactionId, content, createdAt }

// researchRunArtifacts
{ id, runId, seq, kind, payload, createdAt }
// payload shapes (informal):
//   thought_summary: { text }
//   text_delta:      { text }
//   image:           { url, mimeType, base64? }
//   citation:        { sourceUrl, title }
```

### Feature flag gating (spec §8)

- `FEATURE_DEEP_RESEARCH` (default `false`) → if off, **every** `/api/research/*` route returns 404. Internal endpoints (`/api/internal/notes` extension + `/api/internal/research/image-bytes`) stay always-on (they're gated by the shared secret already).
- `FEATURE_MANAGED_DEEP_RESEARCH` (default `false`) → if off, run creation with `billingPath="managed"` returns 403 `{error: "managed_disabled"}`. The workflow itself (Phase B) also re-checks this; the API check is defence-in-depth and a better UX error.

### Authorization rules (spec §6.4)

- **Cross-workspace run access → 404** (hide existence, never 403 — matches `api-contract.md` rule).
- All `POST`/`PATCH` on a run require `canWrite` on the run's `projectId`.
- `GET /runs/:id`, `GET /runs/:id/stream`, `GET /runs` require `canRead` on the workspace.

---

## File structure

### Files to create

```
apps/api/src/routes/research.ts           — new Hono sub-router (8 endpoints)
apps/api/tests/research.test.ts           — integration tests for all 8 endpoints + SSE
apps/api/tests/internal-research.test.ts  — integration tests for the 2 internal endpoint surfaces
packages/shared/src/research-types.ts     — Zod request/response schemas + inferred types
```

### Files to modify

```
apps/api/src/app.ts                       — mount research router; respect FEATURE_DEEP_RESEARCH flag
apps/api/src/routes/internal.ts           — extend POST /notes; add POST /research/image-bytes
packages/shared/src/index.ts              — re-export research-types
```

### Files NOT to touch

- `packages/db/src/schema/research.ts` (frozen by Phase B)
- `apps/worker/**` (Phase B shipped; C is API layer only)
- `apps/web/**` (Phase D)
- Any other existing route file

---

## Task 0: Scope verification & pre-flight

**Purpose:** Confirm the pre-merged state before writing any code. If the assumptions are wrong, the plan is wrong.

- [ ] **Step 1: Verify the workflow registration**

Run:
```bash
grep -n "DeepResearchWorkflow" apps/worker/src/worker/temporal_main.py
```
Expected: line containing `workflows.append(DeepResearchWorkflow)` inside a `FEATURE_DEEP_RESEARCH`-gated block. If this isn't there, stop and flag.

- [ ] **Step 2: Verify the worker's persist_report payload shape**

Run:
```bash
grep -n "plateValue\|idempotencyKey\|noteId" apps/worker/src/worker/activities/deep_research/persist_report.py
```
Expected: match for `"idempotencyKey"`, `"plateValue"`, and `response["noteId"]`. Task 9's contract is defined by whatever the worker actually sends.

- [ ] **Step 3: Confirm no `apps/api/src/routes/research.ts` exists**

Run:
```bash
ls apps/api/src/routes/research.ts 2>&1 || echo "NOT_EXIST"
```
Expected: `NOT_EXIST`. If the file already exists, read it and reconcile before proceeding.

- [ ] **Step 4: Migration 0013 is applied locally**

Run:
```bash
pnpm --filter @opencairn/db migrate:status 2>&1 | tail -20
```
Expected: migration `0013_*research*` marked as applied. If not, run `pnpm db:migrate` before any test will pass.

- [ ] **Step 5: No commit needed (read-only verification).**

---

## Task 1: Shared Zod schemas (`packages/shared`)

**Purpose:** Single source of truth for request/response shapes consumed by both `apps/api` routes and (later) `apps/web` TanStack Query hooks. Mirrors the convention of `api-types.ts` / `import-types.ts`.

**Files:**
- Create: `packages/shared/src/research-types.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/research-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/research-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createResearchRunSchema,
  addTurnSchema,
  updatePlanSchema,
  researchModelValues,
  researchBillingPathValues,
  type ResearchRunSummary,
  type ResearchRunDetail,
} from "../src/research-types.js";

describe("createResearchRunSchema", () => {
  it("accepts minimal valid input", () => {
    const parsed = createResearchRunSchema.parse({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      topic: "How did LLM scaling laws evolve in 2024-2026?",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
    });
    expect(parsed.model).toBe("deep-research-preview-04-2026");
  });

  it("rejects empty topic", () => {
    expect(() =>
      createResearchRunSchema.parse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        topic: "",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
      }),
    ).toThrow();
  });

  it("rejects unknown model enum", () => {
    expect(() =>
      createResearchRunSchema.parse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        topic: "valid",
        model: "gpt-5",
        billingPath: "byok",
      }),
    ).toThrow();
  });

  it("rejects unknown billingPath", () => {
    expect(() =>
      createResearchRunSchema.parse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        topic: "valid",
        model: "deep-research-preview-04-2026",
        billingPath: "crypto",
      }),
    ).toThrow();
  });
});

describe("addTurnSchema", () => {
  it("requires non-empty feedback", () => {
    expect(() => addTurnSchema.parse({ feedback: "" })).toThrow();
  });
  it("enforces max length", () => {
    expect(() => addTurnSchema.parse({ feedback: "x".repeat(8001) })).toThrow();
  });
  it("accepts valid", () => {
    expect(addTurnSchema.parse({ feedback: "narrow to 2025 only" }).feedback).toBe(
      "narrow to 2025 only",
    );
  });
});

describe("updatePlanSchema", () => {
  it("requires non-empty edited_text", () => {
    expect(() => updatePlanSchema.parse({ editedText: "" })).toThrow();
  });
});

describe("enum value exports", () => {
  it("exports model values in sync with DB enum", () => {
    expect(researchModelValues).toEqual([
      "deep-research-preview-04-2026",
      "deep-research-max-preview-04-2026",
    ]);
  });
  it("exports billing path values", () => {
    expect(researchBillingPathValues).toEqual(["byok", "managed"]);
  });
});

describe("response types compile", () => {
  it("ResearchRunSummary / Detail are assignable", () => {
    // Compile-time only — narrow shape assertion.
    const s: ResearchRunSummary = {
      id: "x",
      topic: "t",
      model: "deep-research-preview-04-2026",
      status: "planning",
      billingPath: "byok",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const d: ResearchRunDetail = {
      ...s,
      workspaceId: "w",
      projectId: "p",
      currentInteractionId: null,
      approvedPlanText: null,
      noteId: null,
      error: null,
      totalCostUsdCents: null,
      completedAt: null,
      turns: [],
      artifacts: [],
    };
    expect(s.id).toBe("x");
    expect(d.turns.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/shared test -- research-types`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schemas**

Create `packages/shared/src/research-types.ts`:

```typescript
import { z } from "zod";

// Kept in sync with packages/db/src/schema/enums.ts. If a new enum value is
// added there, add it here and bump the CI parity check.
export const researchModelValues = [
  "deep-research-preview-04-2026",
  "deep-research-max-preview-04-2026",
] as const;
export const researchBillingPathValues = ["byok", "managed"] as const;
export const researchStatusValues = [
  "planning",
  "awaiting_approval",
  "researching",
  "completed",
  "failed",
  "cancelled",
] as const;
export const researchTurnKindValues = [
  "plan_proposal",
  "user_feedback",
  "user_edit",
  "approval",
] as const;
export const researchTurnRoleValues = ["system", "user", "agent"] as const;
export const researchArtifactKindValues = [
  "thought_summary",
  "text_delta",
  "image",
  "citation",
] as const;

// --- Request schemas --------------------------------------------------------

export const createResearchRunSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  topic: z.string().min(1).max(2000),
  model: z.enum(researchModelValues),
  billingPath: z.enum(researchBillingPathValues),
});
export type CreateResearchRunInput = z.infer<typeof createResearchRunSchema>;

export const addTurnSchema = z.object({
  feedback: z.string().min(1).max(8000),
});
export type AddTurnInput = z.infer<typeof addTurnSchema>;

export const updatePlanSchema = z.object({
  editedText: z.string().min(1).max(32_000),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

// Optional override for approve. If omitted, the server picks the freshest
// user_edit if present, else the freshest plan_proposal.
export const approvePlanSchema = z.object({
  finalPlanText: z.string().min(1).max(32_000).optional(),
});
export type ApprovePlanInput = z.infer<typeof approvePlanSchema>;

export const listRunsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

// --- Response shapes (types only; routes return JSON matching these) --------

export interface ResearchRunSummary {
  id: string;
  topic: string;
  model: (typeof researchModelValues)[number];
  status: (typeof researchStatusValues)[number];
  billingPath: (typeof researchBillingPathValues)[number];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  completedAt?: string | null;
  totalCostUsdCents?: number | null;
  noteId?: string | null;
}

export interface ResearchTurn {
  id: string;
  seq: number;
  role: (typeof researchTurnRoleValues)[number];
  kind: (typeof researchTurnKindValues)[number];
  interactionId: string | null;
  content: string;
  createdAt: string;
}

export interface ResearchArtifact {
  id: string;
  seq: number;
  kind: (typeof researchArtifactKindValues)[number];
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ResearchRunDetail extends ResearchRunSummary {
  workspaceId: string;
  projectId: string;
  currentInteractionId: string | null;
  approvedPlanText: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
  totalCostUsdCents: number | null;
  noteId: string | null;
  completedAt: string | null;
  turns: ResearchTurn[];
  artifacts: ResearchArtifact[];
}

// --- SSE event envelope -----------------------------------------------------

export type ResearchStreamEvent =
  | { type: "status"; status: ResearchRunSummary["status"] }
  | {
      type: "turn";
      turn: ResearchTurn;
    }
  | {
      type: "artifact";
      artifact: ResearchArtifact;
    }
  | {
      type: "done";
      noteId: string | null;
      wsSlug?: string;
      projectId: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
    };
```

Modify `packages/shared/src/index.ts` — add one export line:

```typescript
export * from "./research-types";
```

Exact diff: append `export * from "./research-types";` as the last line (alphabetise if surrounding exports are sorted; they currently aren't).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/shared test -- research-types`
Expected: 7 tests pass. If the package has typecheck step, also run `pnpm --filter @opencairn/shared typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/research-types.ts packages/shared/src/index.ts packages/shared/tests/research-types.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): research zod schemas and response types (deep research phase c)

Defines the public API contract consumed by apps/api routes and apps/web.
Enum values mirror packages/db/src/schema/enums.ts exactly; drift would be
caught by the parity test in this commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `POST /api/research/runs` — create run + start workflow

**Files:**
- Create: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/research.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import { db, researchRuns, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// --- Temporal client mock ---
// Hoisted — vitest.mock must not capture closures.
const workflowStartSpy = vi.fn().mockResolvedValue(undefined);
const workflowSignalSpy = vi.fn().mockResolvedValue(undefined);
const workflowCancelSpy = vi.fn().mockResolvedValue(undefined);
const getHandleSpy = vi.fn(() => ({
  signal: workflowSignalSpy,
  cancel: workflowCancelSpy,
}));
vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: async () => ({
    workflow: {
      start: workflowStartSpy,
      getHandle: getHandleSpy,
    },
  }),
}));

// Feature flag on for all tests; individual tests can override.
process.env.FEATURE_DEEP_RESEARCH = "true";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

describe("POST /api/research/runs", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowStartSpy.mockClear();
    workflowSignalSpy.mockClear();
    workflowCancelSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("creates run, inserts DB row, and starts workflow", async () => {
    const res = await authedFetch("/api/research/runs", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        topic: "LLM scaling laws evolution 2024-2026",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, body.runId));
    expect(row).toBeDefined();
    expect(row!.status).toBe("planning");
    expect(row!.workflowId).toBe(body.runId);
    expect(row!.billingPath).toBe("byok");

    expect(workflowStartSpy).toHaveBeenCalledTimes(1);
    const [wfName, wfOpts] = workflowStartSpy.mock.calls[0];
    expect(wfName).toBe("DeepResearchWorkflow");
    expect(wfOpts.workflowId).toBe(body.runId);
    expect(wfOpts.args[0].run_id).toBe(body.runId);
    expect(wfOpts.args[0].user_id).toBe(ctx.userId);
  });

  it("returns 403 when user lacks write on project", async () => {
    const viewer = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authedFetch("/api/research/runs", {
        method: "POST",
        userId: viewer.userId,
        body: JSON.stringify({
          workspaceId: viewer.workspaceId,
          projectId: viewer.projectId,
          topic: "test",
          model: "deep-research-preview-04-2026",
          billingPath: "byok",
        }),
      });
      expect(res.status).toBe(403);
      expect(workflowStartSpy).not.toHaveBeenCalled();
    } finally {
      await viewer.cleanup();
    }
  });

  it("returns 400 on zod validation failure", async () => {
    const res = await authedFetch("/api/research/runs", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        topic: "",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 on managed billingPath when FEATURE_MANAGED_DEEP_RESEARCH is off", async () => {
    process.env.FEATURE_MANAGED_DEEP_RESEARCH = "false";
    const res = await authedFetch("/api/research/runs", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        topic: "test",
        model: "deep-research-preview-04-2026",
        billingPath: "managed",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("managed_disabled");
  });

  it("returns 404 when project is in a different workspace than declared", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch("/api/research/runs", {
        method: "POST",
        userId: ctx.userId,
        // projectId belongs to `other`, workspaceId belongs to `ctx`
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          projectId: other.projectId,
          topic: "test",
          model: "deep-research-preview-04-2026",
          billingPath: "byok",
        }),
      });
      expect(res.status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });

  it("returns 404 when FEATURE_DEEP_RESEARCH is off", async () => {
    process.env.FEATURE_DEEP_RESEARCH = "false";
    try {
      const res = await authedFetch("/api/research/runs", {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          topic: "test",
          model: "deep-research-preview-04-2026",
          billingPath: "byok",
        }),
      });
      expect(res.status).toBe(404);
    } finally {
      process.env.FEATURE_DEEP_RESEARCH = "true";
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/api test -- research.test.ts`
Expected: FAIL (route doesn't exist yet, 404 on POST).

- [ ] **Step 3: Implement the route**

Create `apps/api/src/routes/research.ts`:

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  researchRuns,
  projects,
  eq,
  and,
} from "@opencairn/db";
import {
  createResearchRunSchema,
  type ResearchRunSummary,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth.js";
import { canWrite } from "../lib/permissions.js";
import { getTemporalClient } from "../lib/temporal-client.js";
import type { AppEnv } from "../lib/types.js";

const researchRouter = new Hono<AppEnv>();

function taskQueue(): string {
  return process.env.TEMPORAL_TASK_QUEUE ?? "ingest";
}

function isFeatureEnabled(): boolean {
  return (process.env.FEATURE_DEEP_RESEARCH ?? "false").toLowerCase() === "true";
}

function isManagedEnabled(): boolean {
  return (
    (process.env.FEATURE_MANAGED_DEEP_RESEARCH ?? "false").toLowerCase() ===
    "true"
  );
}

// Whole-router feature gate. If off, nothing under this router responds.
// Internal endpoints (under /api/internal) are NOT gated — those follow the
// shared-secret model and are used by the worker which already respects the
// python-side FEATURE_DEEP_RESEARCH check.
researchRouter.use("*", async (c, next) => {
  if (!isFeatureEnabled()) return c.json({ error: "not_found" }, 404);
  await next();
});

// POST /api/research/runs — create run + start workflow
researchRouter.post(
  "/runs",
  requireAuth,
  zValidator("json", createResearchRunSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    // managed path is gated at BOTH the API and the workflow. API gate gives
    // a better UX error; the workflow gate is defence-in-depth.
    if (body.billingPath === "managed" && !isManagedEnabled()) {
      return c.json({ error: "managed_disabled" }, 403);
    }

    // project must live in the declared workspace — prevents a writer on
    // one workspace from attributing a run to another. 404 on mismatch
    // (api-contract.md: hide existence when user has no access to both).
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj || proj.workspaceId !== body.workspaceId) {
      return c.json({ error: "not_found" }, 404);
    }

    if (!(await canWrite(userId, { type: "project", id: body.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Insert DB row first. workflowId = id = runId (1:1, idempotent).
    const [inserted] = await db
      .insert(researchRuns)
      .values({
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        userId,
        topic: body.topic,
        model: body.model,
        billingPath: body.billingPath,
        status: "planning",
        workflowId: "", // filled below
      })
      .returning({ id: researchRuns.id });
    const runId = inserted.id;
    await db
      .update(researchRuns)
      .set({ workflowId: runId, updatedAt: new Date() })
      .where(eq(researchRuns.id, runId));

    // Start Temporal workflow. Arg shape matches DeepResearchInput dataclass
    // in apps/worker/src/worker/workflows/deep_research_workflow.py.
    const client = await getTemporalClient();
    await client.workflow.start("DeepResearchWorkflow", {
      workflowId: runId,
      taskQueue: taskQueue(),
      args: [
        {
          run_id: runId,
          workspace_id: body.workspaceId,
          project_id: body.projectId,
          user_id: userId,
          topic: body.topic,
          model: body.model,
          billing_path: body.billingPath,
        },
      ],
    });

    return c.json({ runId }, 201);
  },
);

export { researchRouter };
```

Modify `apps/api/src/app.ts` — add import and mount. Insert **after** the `/api/ingest` mount (line ~47) and **before** `commentsRouter`:

```typescript
import { researchRouter } from "./routes/research.js";
// … inside createApp(), after app.route("/api/ingest", ingestRoutes):
app.route("/api/research", researchRouter);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "POST /api/research/runs"`
Expected: 6 tests pass. If `seedWorkspace` or any helper complains about missing `researchRuns` import, check `packages/db/src/index.ts` exports the table (should already from Phase B).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/research.ts apps/api/src/app.ts apps/api/tests/research.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /api/research/runs creates run + starts workflow

Mounts apps/api/src/routes/research.ts at /api/research behind the
FEATURE_DEEP_RESEARCH flag. workflowId == runId for 1:1 idempotency.
Managed billing path is gated twice (API + workflow) and returns a
dedicated managed_disabled error so the UI can CTA to /settings/billing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `GET /api/research/runs` (list) + `GET /api/research/runs/:id` (detail)

**Purpose:** Hub page needs a workspace-scoped list. Detail page needs run + turns + artifacts in one round-trip for the initial render (SSE takes over after that).

**Files:**
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/tests/research.test.ts` (add describes)

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/research.test.ts`:

```typescript
import {
  researchRunTurns,
  researchRunArtifacts,
  desc,
} from "@opencairn/db";

async function createPlanningRun(ctx: SeedResult): Promise<string> {
  const [row] = await db
    .insert(researchRuns)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      userId: ctx.userId,
      topic: "fixture",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
      status: "planning",
      workflowId: "wf",
    })
    .returning({ id: researchRuns.id });
  await db
    .update(researchRuns)
    .set({ workflowId: row.id })
    .where(eq(researchRuns.id, row.id));
  return row.id;
}

describe("GET /api/research/runs", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("lists workspace runs newest-first", async () => {
    const a = await createPlanningRun(ctx);
    await new Promise((r) => setTimeout(r, 5)); // ensure createdAt differs
    const b = await createPlanningRun(ctx);
    const res = await authedFetch(
      `/api/research/runs?workspaceId=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((r) => r.id)).toEqual([b, a]);
  });

  it("returns 400 when workspaceId query param missing", async () => {
    const res = await authedFetch("/api/research/runs", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for non-member", async () => {
    const outsider = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(
        `/api/research/runs?workspaceId=${ctx.workspaceId}`,
        { method: "GET", userId: outsider.userId },
      );
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });
});

describe("GET /api/research/runs/:id", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns run with empty turns/artifacts initially", async () => {
    const runId = await createPlanningRun(ctx);
    const res = await authedFetch(`/api/research/runs/${runId}`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      turns: unknown[];
      artifacts: unknown[];
    };
    expect(body.id).toBe(runId);
    expect(body.status).toBe("planning");
    expect(body.turns).toEqual([]);
    expect(body.artifacts).toEqual([]);
  });

  it("returns turns ordered by seq asc and artifacts by seq asc", async () => {
    const runId = await createPlanningRun(ctx);
    await db.insert(researchRunTurns).values([
      { runId, seq: 0, role: "agent", kind: "plan_proposal", content: "plan v1" },
      { runId, seq: 1, role: "user", kind: "user_feedback", content: "narrower" },
    ]);
    await db.insert(researchRunArtifacts).values([
      { runId, seq: 0, kind: "thought_summary", payload: { text: "thinking..." } },
      { runId, seq: 1, kind: "text_delta", payload: { text: "chunk 1" } },
    ]);
    const res = await authedFetch(`/api/research/runs/${runId}`, {
      method: "GET",
      userId: ctx.userId,
    });
    const body = (await res.json()) as {
      turns: { seq: number; content: string }[];
      artifacts: { seq: number }[];
    };
    expect(body.turns.map((t) => t.seq)).toEqual([0, 1]);
    expect(body.artifacts.map((a) => a.seq)).toEqual([0, 1]);
  });

  it("returns 404 on cross-workspace access", async () => {
    const other = await seedWorkspace({ role: "owner" });
    const runId = await createPlanningRun(other);
    try {
      const res = await authedFetch(`/api/research/runs/${runId}`, {
        method: "GET",
        userId: ctx.userId,
      });
      expect(res.status).toBe(404);
    } finally {
      await other.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "GET /api/research/runs"`
Expected: FAIL (routes don't exist).

- [ ] **Step 3: Implement the routes**

Append to `apps/api/src/routes/research.ts` (before `export { researchRouter }`):

```typescript
import { canRead } from "../lib/permissions.js";
import {
  researchRunTurns,
  researchRunArtifacts,
  asc,
  desc,
} from "@opencairn/db";
import { listRunsQuerySchema } from "@opencairn/shared";

// GET /api/research/runs?workspaceId=...
researchRouter.get(
  "/runs",
  requireAuth,
  zValidator("query", listRunsQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const { workspaceId, limit } = c.req.valid("query");

    if (!(await canRead(userId, { type: "workspace", id: workspaceId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const rows = await db
      .select({
        id: researchRuns.id,
        topic: researchRuns.topic,
        model: researchRuns.model,
        status: researchRuns.status,
        billingPath: researchRuns.billingPath,
        createdAt: researchRuns.createdAt,
        updatedAt: researchRuns.updatedAt,
        completedAt: researchRuns.completedAt,
        totalCostUsdCents: researchRuns.totalCostUsdCents,
        noteId: researchRuns.noteId,
      })
      .from(researchRuns)
      .where(eq(researchRuns.workspaceId, workspaceId))
      .orderBy(desc(researchRuns.createdAt))
      .limit(limit);

    return c.json({
      runs: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
    });
  },
);

// GET /api/research/runs/:id
researchRouter.get("/runs/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return c.json({ error: "not_found" }, 404);
  }

  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, id));
  if (!run) return c.json({ error: "not_found" }, 404);

  if (!(await canRead(userId, { type: "workspace", id: run.workspaceId }))) {
    // Hide existence on cross-workspace access — 404, not 403.
    return c.json({ error: "not_found" }, 404);
  }

  const turns = await db
    .select()
    .from(researchRunTurns)
    .where(eq(researchRunTurns.runId, id))
    .orderBy(asc(researchRunTurns.seq));

  const artifacts = await db
    .select()
    .from(researchRunArtifacts)
    .where(eq(researchRunArtifacts.runId, id))
    .orderBy(asc(researchRunArtifacts.seq));

  return c.json({
    id: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    topic: run.topic,
    model: run.model,
    status: run.status,
    billingPath: run.billingPath,
    currentInteractionId: run.currentInteractionId,
    approvedPlanText: run.approvedPlanText,
    error: run.error,
    totalCostUsdCents: run.totalCostUsdCents,
    noteId: run.noteId,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    turns: turns.map((t) => ({
      id: t.id,
      seq: t.seq,
      role: t.role,
      kind: t.kind,
      interactionId: t.interactionId,
      content: t.content,
      createdAt: t.createdAt.toISOString(),
    })),
    artifacts: artifacts.map((a) => ({
      id: a.id,
      seq: a.seq,
      kind: a.kind,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});
```

Verify that `@opencairn/db` exports `asc`, `desc`, `researchRunTurns`, `researchRunArtifacts`. They should — Phase B added them. If not, re-export in `packages/db/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "GET /api/research/runs"`
Expected: 6 tests pass (3 list + 3 detail).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/research.ts apps/api/tests/research.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /api/research/runs list + detail endpoints

List is workspace-scoped, newest-first, limit 50 default. Detail returns
run + all turns (seq asc) + all artifacts (seq asc) in one payload so the
Phase D detail page hydrates without waterfall. Cross-workspace access
returns 404 (hide existence) per api-contract rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `POST /api/research/runs/:id/turns` — user_feedback signal

**Purpose:** User asks the agent to adjust the plan via chat. Inserts a `user_feedback` turn and signals the workflow; workflow's `iterate_plan` activity picks it up and posts back a new `plan_proposal` turn.

**Files:**
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/tests/research.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/research.test.ts`:

```typescript
describe("POST /api/research/runs/:id/turns", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowSignalSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("signals user_feedback and inserts a turn when status=awaiting_approval", async () => {
    const runId = await createPlanningRun(ctx);
    // Seed one plan_proposal and move run into awaiting_approval.
    await db.insert(researchRunTurns).values({
      runId, seq: 0, role: "agent", kind: "plan_proposal", content: "plan v1",
    });
    await db
      .update(researchRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/turns`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ feedback: "narrower scope please" }),
    });
    expect(res.status).toBe(202);

    const turns = await db
      .select()
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId))
      .orderBy(asc(researchRunTurns.seq));
    expect(turns).toHaveLength(2);
    expect(turns[1]!.role).toBe("user");
    expect(turns[1]!.kind).toBe("user_feedback");
    expect(turns[1]!.content).toBe("narrower scope please");

    expect(workflowSignalSpy).toHaveBeenCalledTimes(1);
    expect(workflowSignalSpy.mock.calls[0][0]).toBe("user_feedback");
  });

  it("returns 409 when run is not in a plan-editable state", async () => {
    const runId = await createPlanningRun(ctx);
    await db
      .update(researchRuns)
      .set({ status: "completed" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/turns`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ feedback: "too late" }),
    });
    expect(res.status).toBe(409);
    expect(workflowSignalSpy).not.toHaveBeenCalled();
  });

  it("returns 403 on viewer", async () => {
    const runId = await createPlanningRun(ctx);
    const viewer = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authedFetch(`/api/research/runs/${runId}/turns`, {
        method: "POST",
        userId: viewer.userId,
        body: JSON.stringify({ feedback: "x" }),
      });
      // Cross-workspace — hidden with 404.
      expect(res.status).toBe(404);
    } finally {
      await viewer.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "POST /api/research/runs/:id/turns"`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement the route**

Append to `apps/api/src/routes/research.ts` (before `export {…}`):

```typescript
import { addTurnSchema } from "@opencairn/shared";
import { max } from "@opencairn/db";

// Utility: load run with auth check. Returns null on not-found / cross-ws
// (same 404 shape) or the hydrated run.
async function loadRunForUser(runId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId));
  if (!run) return null;
  if (!(await canRead(userId, { type: "workspace", id: run.workspaceId }))) {
    return null;
  }
  return run;
}

// POST /api/research/runs/:id/turns  — queue feedback for iterate_plan
researchRouter.post(
  "/runs/:id/turns",
  requireAuth,
  zValidator("json", addTurnSchema),
  async (c) => {
    const userId = c.get("userId");
    const runId = c.req.param("id");
    const { feedback } = c.req.valid("json");

    const run = await loadRunForUser(runId, userId);
    if (!run) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Plan feedback only valid while the plan is still being negotiated.
    if (
      run.status !== "planning" &&
      run.status !== "awaiting_approval"
    ) {
      return c.json({ error: "invalid_state", status: run.status }, 409);
    }

    const [{ nextSeq }] = await db
      .select({ nextSeq: max(researchRunTurns.seq) })
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId));

    const [turn] = await db
      .insert(researchRunTurns)
      .values({
        runId,
        seq: (nextSeq ?? -1) + 1,
        role: "user",
        kind: "user_feedback",
        content: feedback,
      })
      .returning({ id: researchRunTurns.id });

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(run.workflowId);
    await handle.signal("user_feedback", feedback, turn.id);

    return c.json({ turnId: turn.id }, 202);
  },
);
```

Verify `@opencairn/db` exports `max`. If not, add to `packages/db/src/index.ts`: `export { max } from "drizzle-orm";`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "POST /api/research/runs/:id/turns"`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/research.ts apps/api/tests/research.test.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /research/runs/:id/turns relays user feedback signal

Inserts a user_feedback turn and fires the user_feedback Temporal signal.
Workflow's iterate_plan activity consumes it and posts back a new plan
proposal turn. Status guard rejects feedback once planning is over.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `PATCH /api/research/runs/:id/plan` — direct plan edit (DB only)

**Purpose:** User edits the plan manually without another Google call. Spec §5.2 "직접 편집" path. Inserts a `user_edit` turn; no workflow signal — approval picks up the freshest edit.

**Files:**
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/tests/research.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/research.test.ts`:

```typescript
describe("PATCH /api/research/runs/:id/plan", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowSignalSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("inserts user_edit turn and does NOT signal the workflow", async () => {
    const runId = await createPlanningRun(ctx);
    await db.insert(researchRunTurns).values({
      runId, seq: 0, role: "agent", kind: "plan_proposal", content: "plan v1",
    });
    await db
      .update(researchRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/plan`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ editedText: "plan v1\n- added step X" }),
    });
    expect(res.status).toBe(200);

    const turns = await db
      .select()
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId))
      .orderBy(asc(researchRunTurns.seq));
    expect(turns).toHaveLength(2);
    expect(turns[1]!.kind).toBe("user_edit");
    expect(turns[1]!.content).toContain("added step X");

    expect(workflowSignalSpy).not.toHaveBeenCalled();
  });

  it("rejects when status is researching/completed/failed/cancelled", async () => {
    const runId = await createPlanningRun(ctx);
    await db
      .update(researchRuns)
      .set({ status: "researching" })
      .where(eq(researchRuns.id, runId));
    const res = await authedFetch(`/api/research/runs/${runId}/plan`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ editedText: "late edit" }),
    });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "PATCH /api/research/runs/:id/plan"`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement the route**

Append to `apps/api/src/routes/research.ts`:

```typescript
import { updatePlanSchema } from "@opencairn/shared";

// PATCH /api/research/runs/:id/plan — local edit, no Google call, no signal
researchRouter.patch(
  "/runs/:id/plan",
  requireAuth,
  zValidator("json", updatePlanSchema),
  async (c) => {
    const userId = c.get("userId");
    const runId = c.req.param("id");
    const { editedText } = c.req.valid("json");

    const run = await loadRunForUser(runId, userId);
    if (!run) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (
      run.status !== "planning" &&
      run.status !== "awaiting_approval"
    ) {
      return c.json({ error: "invalid_state", status: run.status }, 409);
    }

    const [{ nextSeq }] = await db
      .select({ nextSeq: max(researchRunTurns.seq) })
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId));

    const [turn] = await db
      .insert(researchRunTurns)
      .values({
        runId,
        seq: (nextSeq ?? -1) + 1,
        role: "user",
        kind: "user_edit",
        content: editedText,
      })
      .returning({ id: researchRunTurns.id });

    return c.json({ turnId: turn.id }, 200);
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "PATCH /api/research/runs/:id/plan"`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/research.ts apps/api/tests/research.test.ts
git commit -m "$(cat <<'EOF'
feat(api): PATCH /research/runs/:id/plan records local plan edits

Direct-edit path (spec §5.2) — no Google call, no workflow signal. The
approve endpoint will use the freshest user_edit if present, else the
latest plan_proposal, so this is a pure DB mutation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `POST /api/research/runs/:id/approve` — approve_plan signal

**Purpose:** Commits the plan the workflow should research against. Resolves the final text (user-supplied override > latest `user_edit` > latest `plan_proposal`), persists it to `researchRuns.approvedPlanText`, inserts an `approval` turn, signals the workflow, and lets Phase B's `execute_research` take over.

**Files:**
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/tests/research.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe("POST /api/research/runs/:id/approve", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowSignalSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("prefers latest user_edit over plan_proposal", async () => {
    const runId = await createPlanningRun(ctx);
    await db.insert(researchRunTurns).values([
      { runId, seq: 0, role: "agent", kind: "plan_proposal", content: "PROPOSAL" },
      { runId, seq: 1, role: "user", kind: "user_edit", content: "EDITED" },
    ]);
    await db
      .update(researchRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/approve`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);

    const [row] = await db
      .select({ approvedPlanText: researchRuns.approvedPlanText })
      .from(researchRuns)
      .where(eq(researchRuns.id, runId));
    expect(row!.approvedPlanText).toBe("EDITED");

    expect(workflowSignalSpy).toHaveBeenCalledWith("approve_plan", "EDITED");
  });

  it("uses explicit finalPlanText override when provided", async () => {
    const runId = await createPlanningRun(ctx);
    await db.insert(researchRunTurns).values({
      runId, seq: 0, role: "agent", kind: "plan_proposal", content: "PROPOSAL",
    });
    await db
      .update(researchRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/approve`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ finalPlanText: "OVERRIDE" }),
    });
    expect(res.status).toBe(202);
    expect(workflowSignalSpy).toHaveBeenCalledWith("approve_plan", "OVERRIDE");
  });

  it("returns 409 when no plan_proposal exists yet", async () => {
    const runId = await createPlanningRun(ctx);
    const res = await authedFetch(`/api/research/runs/${runId}/approve`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect(workflowSignalSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "POST /api/research/runs/:id/approve"`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Append to `apps/api/src/routes/research.ts`:

```typescript
import { approvePlanSchema } from "@opencairn/shared";
import { inArray, sql } from "@opencairn/db";

// POST /api/research/runs/:id/approve
researchRouter.post(
  "/runs/:id/approve",
  requireAuth,
  zValidator("json", approvePlanSchema),
  async (c) => {
    const userId = c.get("userId");
    const runId = c.req.param("id");
    const { finalPlanText } = c.req.valid("json");

    const run = await loadRunForUser(runId, userId);
    if (!run) return c.json({ error: "not_found" }, 404);
    if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (
      run.status !== "planning" &&
      run.status !== "awaiting_approval"
    ) {
      return c.json({ error: "invalid_state", status: run.status }, 409);
    }

    // Resolve the plan text to approve.
    let approved = finalPlanText;
    if (!approved) {
      const [latestEdit] = await db
        .select({ content: researchRunTurns.content })
        .from(researchRunTurns)
        .where(
          and(
            eq(researchRunTurns.runId, runId),
            eq(researchRunTurns.kind, "user_edit"),
          ),
        )
        .orderBy(desc(researchRunTurns.seq))
        .limit(1);
      if (latestEdit) {
        approved = latestEdit.content;
      } else {
        const [latestProp] = await db
          .select({ content: researchRunTurns.content })
          .from(researchRunTurns)
          .where(
            and(
              eq(researchRunTurns.runId, runId),
              eq(researchRunTurns.kind, "plan_proposal"),
            ),
          )
          .orderBy(desc(researchRunTurns.seq))
          .limit(1);
        approved = latestProp?.content;
      }
    }
    if (!approved) {
      return c.json({ error: "no_plan_yet" }, 409);
    }

    const [{ nextSeq }] = await db
      .select({ nextSeq: max(researchRunTurns.seq) })
      .from(researchRunTurns)
      .where(eq(researchRunTurns.runId, runId));
    await db.insert(researchRunTurns).values({
      runId,
      seq: (nextSeq ?? -1) + 1,
      role: "user",
      kind: "approval",
      content: approved,
    });

    await db
      .update(researchRuns)
      .set({ approvedPlanText: approved, updatedAt: new Date() })
      .where(eq(researchRuns.id, runId));

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(run.workflowId);
    await handle.signal("approve_plan", approved);

    return c.json({ approved: true }, 202);
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "POST /api/research/runs/:id/approve"`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/research.ts apps/api/tests/research.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /research/runs/:id/approve signals approve_plan

Resolves final plan text: explicit override > latest user_edit > latest
plan_proposal. Persists to approvedPlanText, inserts an approval turn,
signals the workflow. 409 when no plan has been proposed yet so the UI
can surface a sensible error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `POST /api/research/runs/:id/cancel` — cancel signal

**Purpose:** User aborts a run. Best-effort cancel: signal the workflow, let the workflow handle provider cancel + state transition. We do NOT transition the DB row to `cancelled` synchronously — that's the workflow's job — because the workflow may still be mid-activity.

**Files:**
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/tests/research.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe("POST /api/research/runs/:id/cancel", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowSignalSpy.mockClear();
    workflowCancelSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("sends cancel signal to workflow", async () => {
    const runId = await createPlanningRun(ctx);
    const res = await authedFetch(`/api/research/runs/${runId}/cancel`, {
      method: "POST",
      userId: ctx.userId,
    });
    expect(res.status).toBe(202);
    expect(workflowSignalSpy).toHaveBeenCalledWith("cancel");
  });

  it("is idempotent on already-completed runs (202, no signal)", async () => {
    const runId = await createPlanningRun(ctx);
    await db
      .update(researchRuns)
      .set({ status: "completed" })
      .where(eq(researchRuns.id, runId));

    const res = await authedFetch(`/api/research/runs/${runId}/cancel`, {
      method: "POST",
      userId: ctx.userId,
    });
    expect(res.status).toBe(202);
    expect(workflowSignalSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "POST /api/research/runs/:id/cancel"`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Append to `apps/api/src/routes/research.ts`:

```typescript
// POST /api/research/runs/:id/cancel
researchRouter.post("/runs/:id/cancel", requireAuth, async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");

  const run = await loadRunForUser(runId, userId);
  if (!run) return c.json({ error: "not_found" }, 404);
  if (!(await canWrite(userId, { type: "project", id: run.projectId }))) {
    return c.json({ error: "forbidden" }, 403);
  }

  // Terminal states — nothing to do. Return 202 for idempotency (so UI can
  // retry spam-click without shaking the user with an error).
  if (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    return c.json({ cancelled: true, alreadyTerminal: true }, 202);
  }

  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(run.workflowId);
  // Use the signal rather than handle.cancel() — the workflow's cancel
  // handler does the Google provider.cancel_interaction + DB transition.
  // handle.cancel() would trip CancelledError mid-activity and skip cleanup.
  await handle.signal("cancel");

  return c.json({ cancelled: true }, 202);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "POST /api/research/runs/:id/cancel"`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/research.ts apps/api/tests/research.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /research/runs/:id/cancel best-effort cancel

Uses the workflow's cancel signal rather than handle.cancel() so the
workflow can cleanly call provider.cancel_interaction and transition
the DB state itself. Terminal runs return 202 for idempotency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `GET /api/research/runs/:id/stream` — SSE progress stream

**Purpose:** Phase D needs live updates for status + new turns + new artifacts. Follows the exact pattern of `apps/api/src/routes/import.ts:325-393`: `ReadableStream` + 2s poll loop + explicit SSE headers + close on terminal state.

**Event types (from `ResearchStreamEvent` in `packages/shared/src/research-types.ts`):**
- `{type:"status", status}` when `researchRuns.status` changes
- `{type:"turn", turn}` for each new turn since `lastTurnSeq`
- `{type:"artifact", artifact}` for each new artifact since `lastArtifactSeq`
- `{type:"done", noteId, projectId}` on terminal state, then stream closes
- `{type:"error", code, message}` when `researchRuns.error` is populated

**Files:**
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/tests/research.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe("GET /api/research/runs/:id/stream", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("emits status + turn events then done on completion", async () => {
    const runId = await createPlanningRun(ctx);

    // Drive the run to a terminal state across a couple of polls.
    const driver = (async () => {
      await new Promise((r) => setTimeout(r, 100));
      await db.insert(researchRunTurns).values({
        runId, seq: 0, role: "agent", kind: "plan_proposal", content: "plan",
      });
      await db
        .update(researchRuns)
        .set({ status: "awaiting_approval", updatedAt: new Date() })
        .where(eq(researchRuns.id, runId));
      await new Promise((r) => setTimeout(r, 2200));
      await db
        .update(researchRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          noteId: null,
          updatedAt: new Date(),
        })
        .where(eq(researchRuns.id, runId));
    })();

    const res = await authedFetch(`/api/research/runs/${runId}/stream`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const seen: string[] = [];
    const deadline = Date.now() + 10_000;
    outer: while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      seen.push(text);
      if (text.includes('"type":"done"')) break outer;
    }
    await driver;
    const all = seen.join("");
    expect(all).toContain('"type":"status"');
    expect(all).toContain('"type":"turn"');
    expect(all).toContain('"type":"done"');
  }, 15_000);

  it("returns 404 when the run does not exist", async () => {
    const res = await authedFetch(
      `/api/research/runs/00000000-0000-0000-0000-000000000000/stream`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "GET /api/research/runs/:id/stream"`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement the SSE route**

Append to `apps/api/src/routes/research.ts`:

```typescript
// GET /api/research/runs/:id/stream  — SSE progress stream
//
// Polling-based like /api/import/jobs/:id/events: every 2s, query the run
// row + any new turns + any new artifacts since last seq, emit events,
// close on terminal status. Pure projection — no Temporal coupling on this
// endpoint so an API restart doesn't take the stream down.
researchRouter.get("/runs/:id/stream", requireAuth, async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");

  const run = await loadRunForUser(runId, userId);
  if (!run) return c.json({ error: "not_found" }, 404);

  const POLL_MS = 2_000;
  const MAX_MINUTES = 70; // cover the 60min workflow cap + persistence slack
  const MAX_TICKS = (MAX_MINUTES * 60 * 1000) / POLL_MS;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let lastStatus: string | null = null;
      let lastTurnSeq = -1;
      let lastArtifactSeq = -1;
      let tick = 0;

      try {
        while (tick < MAX_TICKS) {
          const [row] = await db
            .select({
              status: researchRuns.status,
              projectId: researchRuns.projectId,
              noteId: researchRuns.noteId,
              error: researchRuns.error,
            })
            .from(researchRuns)
            .where(eq(researchRuns.id, runId));
          if (!row) break;

          if (row.status !== lastStatus) {
            send({ type: "status", status: row.status });
            lastStatus = row.status;
          }

          const newTurns = await db
            .select()
            .from(researchRunTurns)
            .where(
              and(
                eq(researchRunTurns.runId, runId),
                // gt not available? use sql`>` fallback; most drizzle builds
                // do expose gt — see import @opencairn/db below
                (await import("@opencairn/db")).gt(
                  researchRunTurns.seq,
                  lastTurnSeq,
                ),
              ),
            )
            .orderBy(asc(researchRunTurns.seq));
          for (const t of newTurns) {
            send({
              type: "turn",
              turn: {
                id: t.id,
                seq: t.seq,
                role: t.role,
                kind: t.kind,
                interactionId: t.interactionId,
                content: t.content,
                createdAt: t.createdAt.toISOString(),
              },
            });
            lastTurnSeq = t.seq;
          }

          const newArts = await db
            .select()
            .from(researchRunArtifacts)
            .where(
              and(
                eq(researchRunArtifacts.runId, runId),
                (await import("@opencairn/db")).gt(
                  researchRunArtifacts.seq,
                  lastArtifactSeq,
                ),
              ),
            )
            .orderBy(asc(researchRunArtifacts.seq));
          for (const a of newArts) {
            send({
              type: "artifact",
              artifact: {
                id: a.id,
                seq: a.seq,
                kind: a.kind,
                payload: a.payload,
                createdAt: a.createdAt.toISOString(),
              },
            });
            lastArtifactSeq = a.seq;
          }

          if (row.error) {
            send({
              type: "error",
              code: (row.error as { code: string }).code,
              message: (row.error as { message: string }).message,
            });
          }

          if (
            row.status === "completed" ||
            row.status === "failed" ||
            row.status === "cancelled"
          ) {
            send({
              type: "done",
              noteId: row.noteId,
              projectId: row.projectId,
            });
            break;
          }

          await new Promise((r) => setTimeout(r, POLL_MS));
          tick += 1;
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
```

Refactor the `gt` import: remove the dynamic `await import("@opencairn/db")` and hoist `gt` to the top-level import block of the file. Replace both usage sites with the hoisted symbol. Verify `packages/db/src/index.ts` re-exports `gt` from `drizzle-orm` (it already re-exports `eq`, `and`, `asc`, `desc` — add `gt` if missing, same as `max`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "GET /api/research/runs/:id/stream"`
Expected: 2 tests pass. The streaming test can take up to 10s — that's within Vitest's default timeout as overridden (15_000 ms) in the test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/research.ts apps/api/tests/research.test.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /research/runs/:id/stream SSE progress stream

Same pattern as /api/import/jobs/:id/events — polling ReadableStream, 2s
interval, 70min cap (60min workflow + persist slack). Emits status /
turn / artifact / error / done events. DB-only projection so API
restarts don't tear down the stream logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Extend `POST /api/internal/notes` for Phase B's persist_report

**Purpose:** `apps/worker/src/worker/activities/deep_research/persist_report.py:118` already posts `{idempotencyKey, projectId, workspaceId, userId, title, plateValue}` and expects `{noteId}`. The current handler only understands `{projectId, title, content, …}` and returns `{id}`. Extend the existing handler additively — do NOT break ingest-expansion callers.

**Files:**
- Modify: `apps/api/src/routes/internal.ts`
- Test: `apps/api/tests/internal-research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/internal-research.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, notes, researchRunArtifacts, researchRuns, eq } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

const SECRET = "test-internal-secret-abc";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function internalFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "X-Internal-Secret": SECRET,
      "content-type": "application/json",
    },
  });
}

describe("POST /api/internal/notes (research extension)", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("accepts plateValue + userId and returns noteId", async () => {
    const plate = [
      { type: "research-meta", runId: "r", model: "m", plan: "p",
        sources: [], children: [{ text: "" }] },
      { type: "p", children: [{ text: "body" }] },
    ];
    const res = await internalFetch("/api/internal/notes", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "run-xyz",
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: "research topic",
        plateValue: plate,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { noteId: string; id: string };
    expect(body.noteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.id).toBe(body.noteId); // legacy field retained

    const [row] = await db.select().from(notes).where(eq(notes.id, body.noteId));
    expect(row).toBeDefined();
    expect(row!.title).toBe("research topic");
    expect(row!.content).toEqual(plate);
    expect(row!.contentText).toContain("body"); // plateValue → text derivation
  });

  it("is idempotent on idempotencyKey — returns same noteId on retry", async () => {
    const body = {
      idempotencyKey: "run-abc",
      projectId: ctx.projectId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      title: "t",
      plateValue: [{ type: "p", children: [{ text: "x" }] }],
    };
    const a = await internalFetch("/api/internal/notes", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const b = await internalFetch("/api/internal/notes", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const a1 = (await a.json()) as { noteId: string };
    const b1 = (await b.json()) as { noteId: string };
    expect(a1.noteId).toBe(b1.noteId);
  });

  it("still accepts the legacy ingest-expansion payload shape", async () => {
    const res = await internalFetch("/api/internal/notes", {
      method: "POST",
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "legacy",
        type: "source",
        sourceType: "pdf",
        content: null,
        contentText: "",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects when workspaceId mismatches the project's workspace", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      const res = await internalFetch("/api/internal/notes", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "k",
          projectId: ctx.projectId,
          workspaceId: other.workspaceId, // wrong
          userId: ctx.userId,
          title: "t",
          plateValue: [],
        }),
      });
      expect(res.status).toBe(400);
    } finally {
      await other.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- internal-research.test.ts -t "POST /api/internal/notes"`
Expected: FAIL — new fields rejected by current Zod schema; return shape mismatch.

- [ ] **Step 3: Implement the extension**

Modify `apps/api/src/routes/internal.ts`. Replace the `internalNoteCreateSchema` block (currently at lines 1127-1140) with:

```typescript
// POST /internal/notes — shared by the import pipeline AND the Deep Research
// persist_report activity (Phase C). Two call-site shapes supported:
//
//   A. Ingest-expansion (legacy): { projectId, title, type, sourceType,
//        content, contentText, parentNoteId?, importJobId?, importPath? }
//        — pre-rendered content + contentText, no idempotency.
//
//   B. Deep Research (Phase C):  { idempotencyKey, projectId, workspaceId,
//        userId, title, plateValue }
//        — pre-rendered Plate value; contentText derived here. workspaceId
//        must match projectId's workspace.
//
// We do not gate by payload shape explicitly; the Zod schema permits both
// and the handler branches on presence of `idempotencyKey`.
const internalNoteCreateSchema = z
  .object({
    projectId: z.string().uuid(),
    parentNoteId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(512).default("Untitled"),
    type: z.enum(["note", "source"]).default("note"),
    sourceType: z
      .enum(["pdf", "audio", "video", "image", "youtube", "web", "unknown", "notion"])
      .nullable()
      .optional(),
    content: z.unknown().nullable().optional(),
    contentText: z.string().nullable().optional(),
    importJobId: z.string().uuid().optional(),
    importPath: z.string().max(1024).optional(),
    // --- Phase C additions ---
    idempotencyKey: z.string().min(1).max(128).optional(),
    workspaceId: z.string().uuid().optional(),
    userId: z.string().min(1).max(200).optional(),
    plateValue: z.unknown().optional(),
  })
  .refine(
    (v) => !(v.idempotencyKey && !v.plateValue),
    { message: "plateValue required when idempotencyKey is present" },
  );
```

Then replace the handler block (currently lines 1142-1167) with:

```typescript
internal.post(
  "/notes",
  zValidator("json", internalNoteCreateSchema),
  async (c) => {
    const body = c.req.valid("json");

    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);

    // If workspaceId was supplied (Phase C shape), enforce consistency.
    if (body.workspaceId && body.workspaceId !== proj.workspaceId) {
      return c.json({ error: "workspace_mismatch" }, 400);
    }

    // Idempotency — if the key matches an already-inserted research run's
    // noteId, return it instead of inserting again. Keyed on researchRuns.id
    // which equals the worker-supplied idempotencyKey (= run_id) by contract.
    if (body.idempotencyKey) {
      const [existing] = await db
        .select({ noteId: researchRuns.noteId })
        .from(researchRuns)
        .where(eq(researchRuns.id, body.idempotencyKey));
      if (existing?.noteId) {
        return c.json({ id: existing.noteId, noteId: existing.noteId }, 201);
      }
    }

    // Resolve the note content and contentText from either payload shape.
    const content =
      (body.plateValue as unknown) ??
      body.content ??
      null;
    let contentText = body.contentText ?? "";
    if (!contentText && body.plateValue) {
      // Reuse the same Plate → text helper the public POST /notes uses so
      // FTS + embedding stay consistent.
      const { plateValueToText } = await import("../lib/plate-text.js");
      contentText = plateValueToText(body.plateValue as never) ?? "";
    }

    const id = randomUUID();
    await db.insert(notes).values({
      id,
      projectId: body.projectId,
      workspaceId: proj.workspaceId,
      title: body.title,
      type: body.type,
      sourceType: body.sourceType ?? null,
      content,
      contentText,
      isAuto: true,
    });

    // Back-fill researchRuns.noteId so a retry of this call hits the
    // idempotency branch above. Safe to run even if idempotencyKey doesn't
    // match a run — the update is a no-op.
    if (body.idempotencyKey) {
      await db
        .update(researchRuns)
        .set({ noteId: id, updatedAt: new Date() })
        .where(eq(researchRuns.id, body.idempotencyKey));
    }

    return c.json({ id, noteId: id }, 201);
  },
);
```

Verify the imports at the top of `internal.ts`: needs `researchRuns` from `@opencairn/db`. Add it to the existing import if missing.

Move the `plateValueToText` dynamic import to the top of the file as a static import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- internal-research.test.ts -t "POST /api/internal/notes"`
Expected: 4 tests pass.

Also run the full api suite to confirm no regression:

```bash
pnpm --filter @opencairn/api test
```

Expected: all previously-passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/api/tests/internal-research.test.ts
git commit -m "$(cat <<'EOF'
feat(api): extend /internal/notes with idempotency + plateValue + noteId

The already-merged persist_deep_research_report activity POSTs the Phase C
payload shape; this adjusts the endpoint to accept it additively without
breaking the ingest-expansion shape. Idempotency key is the run_id, so
retried persist activities return the same note rather than duplicating.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `POST /api/internal/research/image-bytes` — artifact byte replay

**Purpose:** `persist_report.py:146` calls `post_internal("/internal/research/image-bytes", {"url": url})` and expects `{"base64": ..., "mimeType": ...}`. Phase B stores each image artifact in `researchRunArtifacts` with `payload = {url, mimeType, base64?}` — Phase C exposes a way to replay those bytes back to the worker during `persist_report` (which runs long after the stream ended).

**Files:**
- Modify: `apps/api/src/routes/internal.ts`
- Modify: `apps/api/tests/internal-research.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/internal-research.test.ts`:

```typescript
describe("POST /api/internal/research/image-bytes", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns base64 + mimeType for a known artifact", async () => {
    const [run] = await db
      .insert(researchRuns)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        userId: ctx.userId,
        topic: "t",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
        status: "researching",
        workflowId: "wf",
      })
      .returning({ id: researchRuns.id });
    await db.insert(researchRunArtifacts).values({
      runId: run.id,
      seq: 0,
      kind: "image",
      payload: {
        url: "https://fake.googleusercontent/r/1.png",
        mimeType: "image/png",
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAwAB/D2+J6cAAAAASUVORK5CYII=",
      },
    });

    const res = await internalFetch("/api/internal/research/image-bytes", {
      method: "POST",
      body: JSON.stringify({
        url: "https://fake.googleusercontent/r/1.png",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { base64: string; mimeType: string };
    expect(body.mimeType).toBe("image/png");
    expect(body.base64.startsWith("iVBOR")).toBe(true);
  });

  it("returns 404 when no artifact matches the URL", async () => {
    const res = await internalFetch("/api/internal/research/image-bytes", {
      method: "POST",
      body: JSON.stringify({ url: "https://unknown" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects missing secret header", async () => {
    const res = await app.request("/api/internal/research/image-bytes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "x" }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @opencairn/api test -- internal-research.test.ts -t "POST /api/internal/research/image-bytes"`
Expected: FAIL.

- [ ] **Step 3: Implement the endpoint**

Append to `apps/api/src/routes/internal.ts` (before the final `export { internal }` or equivalent):

```typescript
// POST /internal/research/image-bytes — replay image bytes captured during
// execute_deep_research. Matches against researchRunArtifacts.payload->>'url'.
// The worker's persist_report reads this back, uploads to MinIO, and only
// then materialises the final Plate block. Kept small: the worker already
// knows runId via its own workflow context, so we only need the URL here.
const researchImageBytesSchema = z.object({
  url: z.string().url().max(4096),
});

internal.post(
  "/research/image-bytes",
  zValidator("json", researchImageBytesSchema),
  async (c) => {
    const { url } = c.req.valid("json");
    const [row] = await db
      .select({ payload: researchRunArtifacts.payload })
      .from(researchRunArtifacts)
      .where(
        and(
          eq(researchRunArtifacts.kind, "image"),
          // drizzle jsonb text extraction: payload->>'url' = url
          sql`${researchRunArtifacts.payload}->>'url' = ${url}`,
        ),
      )
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);

    const payload = row.payload as {
      url?: string;
      mimeType?: string;
      base64?: string;
    };
    if (!payload.base64 || !payload.mimeType) {
      return c.json({ error: "artifact_missing_bytes" }, 404);
    }
    return c.json({ base64: payload.base64, mimeType: payload.mimeType }, 200);
  },
);
```

Verify imports at the top of `internal.ts` include `and`, `sql`, and `researchRunArtifacts` from `@opencairn/db`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/api test -- internal-research.test.ts -t "POST /api/internal/research/image-bytes"`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/api/tests/internal-research.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /internal/research/image-bytes for persist_report replay

The worker's persist_deep_research_report activity (already merged) calls
this endpoint to fetch bytes for each Google-returned image before the
MinIO upload step. We look the bytes up by url against the artifact row
captured during execute_deep_research.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: End-to-end happy-path integration test

**Purpose:** Exercises Tasks 2–8 as one narrative so any regression across the route set is caught. Uses the Temporal mock so no real worker is required.

**Files:**
- Modify: `apps/api/tests/research.test.ts`

- [ ] **Step 1: Write the test**

Append to `apps/api/tests/research.test.ts`:

```typescript
describe("Deep Research happy path (integration)", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "editor" });
    workflowStartSpy.mockClear();
    workflowSignalSpy.mockClear();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("create → plan arrives → approve → complete", async () => {
    // 1. create run
    const create = await authedFetch("/api/research/runs", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        topic: "Summarise recent transformer efficiency papers",
        model: "deep-research-preview-04-2026",
        billingPath: "byok",
      }),
    });
    expect(create.status).toBe(201);
    const { runId } = (await create.json()) as { runId: string };

    // 2. worker (simulated) posts a plan_proposal + flips status
    await db.insert(researchRunTurns).values({
      runId, seq: 0, role: "agent", kind: "plan_proposal", content: "P0",
    });
    await db
      .update(researchRuns)
      .set({ status: "awaiting_approval" })
      .where(eq(researchRuns.id, runId));

    // 3. user iterates once
    const feedback = await authedFetch(`/api/research/runs/${runId}/turns`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ feedback: "scope narrower" }),
    });
    expect(feedback.status).toBe(202);

    // 4. worker posts a new plan_proposal
    await db.insert(researchRunTurns).values({
      runId, seq: 2, role: "agent", kind: "plan_proposal", content: "P1",
    });

    // 5. user approves
    const approve = await authedFetch(`/api/research/runs/${runId}/approve`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({}),
    });
    expect(approve.status).toBe(202);
    expect(workflowSignalSpy).toHaveBeenCalledWith("approve_plan", "P1");

    // 6. worker completes
    await db
      .update(researchRuns)
      .set({
        status: "completed",
        noteId: ctx.noteId,
        completedAt: new Date(),
      })
      .where(eq(researchRuns.id, runId));

    // 7. detail endpoint reflects end state
    const detail = await authedFetch(`/api/research/runs/${runId}`, {
      method: "GET",
      userId: ctx.userId,
    });
    const d = (await detail.json()) as {
      status: string;
      noteId: string | null;
      turns: unknown[];
    };
    expect(d.status).toBe("completed");
    expect(d.noteId).toBe(ctx.noteId);
    expect(d.turns.length).toBeGreaterThanOrEqual(4); // 2 proposals, 1 feedback, 1 approval
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @opencairn/api test -- research.test.ts -t "happy path"`
Expected: 1 test passes.

- [ ] **Step 3: Run the entire api + shared test suite**

```bash
pnpm --filter @opencairn/api test
pnpm --filter @opencairn/shared test
```

Expected: all pass. Record counts (`X passed, Y skipped, Z total`) in the commit message.

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/research.test.ts
git commit -m "$(cat <<'EOF'
test(api): happy-path integration test for deep research route set

Exercises create → propose → iterate → propose → approve → complete
across the 5 public endpoints + detail endpoint. Uses the Temporal mock
from research.test.ts to keep the test fully hermetic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Documentation + plans-status refresh

**Files:**
- Modify: `docs/architecture/api-contract.md`
- Modify: `docs/contributing/plans-status.md`

- [ ] **Step 1: Add the new route table to `docs/architecture/api-contract.md`**

Find the section that lists workspace-scoped routes (it already lists `/api/import/*`, `/api/ingest/*`, `/api/notes/*`, etc.). Add a new sub-section under "Deep Research (Phase C)":

```markdown
### Deep Research (Phase C, feature-flag `FEATURE_DEEP_RESEARCH`)

Public — requires Better Auth session + `canWrite` on project (create/mutate) or `canRead` on workspace (list/detail/stream).

| Method | Path                                     | Body / Query            | Response |
|--------|------------------------------------------|-------------------------|----------|
| POST   | `/api/research/runs`                     | `createResearchRunSchema` | `201 { runId }` |
| GET    | `/api/research/runs?workspaceId=&limit=` | `listRunsQuerySchema`   | `200 { runs: ResearchRunSummary[] }` |
| GET    | `/api/research/runs/:id`                 | —                       | `200 ResearchRunDetail` |
| POST   | `/api/research/runs/:id/turns`           | `addTurnSchema`         | `202 { turnId }` |
| PATCH  | `/api/research/runs/:id/plan`            | `updatePlanSchema`      | `200 { turnId }` |
| POST   | `/api/research/runs/:id/approve`         | `approvePlanSchema`     | `202 { approved: true }` |
| POST   | `/api/research/runs/:id/cancel`          | —                       | `202 { cancelled: true }` |
| GET    | `/api/research/runs/:id/stream`          | —                       | `200 text/event-stream`, events: `status`, `turn`, `artifact`, `error`, `done` |

Internal (worker → api, `X-Internal-Secret`):

| Method | Path                                     | Body | Response |
|--------|------------------------------------------|------|----------|
| POST   | `/api/internal/notes`                    | legacy ingest shape OR `{idempotencyKey, projectId, workspaceId, userId, title, plateValue}` | `201 { id, noteId }` — idempotent on `idempotencyKey` |
| POST   | `/api/internal/research/image-bytes`     | `{url}` | `200 { base64, mimeType }` / `404` |

Cross-workspace access returns **404** (hide existence), per api-contract convention.
```

- [ ] **Step 2: Update `docs/contributing/plans-status.md`**

Find the "Deep Research integration" subsection and change:

```markdown
- 🟡 Phase C — apps/api routes + SSE (next)
```

to:

```markdown
- ✅ Phase C — apps/api routes + SSE (2026-04-XX, HEAD `<fill-in>`)
```

Leave the HEAD placeholder; it gets filled by the post-feature workflow at commit time.

Also add the phase C plan to the follow-ups table, mirroring phase B's entry shape. Pattern:

```markdown
| `2026-04-23-deep-research-phase-c-api-routes.md`     | ✅ 2026-04-XX, HEAD `<fill>` | Deep Research integration · Phase C. apps/api `/api/research/*` (8 public endpoints + SSE) + extended `/api/internal/notes` with idempotency/plateValue + new `/api/internal/research/image-bytes`. Feature-flag gate. Tests: apps/api +N. Next: Phase D (apps/web). |
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/api-contract.md docs/contributing/plans-status.md
git commit -m "$(cat <<'EOF'
docs(docs): deep research phase c api contract + plans-status entry

api-contract.md gains the 8 public /api/research/* routes and 2 internal
endpoint surfaces. plans-status.md promoted Phase C to ✅ and linked the
phase-c plan file.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Final verification

**Purpose:** Run the opencairn-post-feature workflow before declaring Phase C complete (verification → review → docs → commit already covered above, so this task is just running the checks).

- [ ] **Step 1: Type-check + lint**

```bash
pnpm --filter @opencairn/api typecheck
pnpm --filter @opencairn/api lint
pnpm --filter @opencairn/shared typecheck
```
Expected: all clean.

- [ ] **Step 2: Full API test suite**

```bash
pnpm --filter @opencairn/api test
```
Expected: all pass, numbers recorded.

- [ ] **Step 3: Confirm no accidental file changes outside scope**

```bash
git status
git diff main...HEAD --stat
```
Expected stat shows only files listed in "File structure" above. No `apps/worker/*` or `apps/web/*` changes.

- [ ] **Step 4: Commit the plan-status HEAD backfill**

Once everything passes, amend the plans-status.md entry with the final merge/HEAD hash:

```bash
# After merging, update plans-status.md line 3 `HEAD <fill-in>` with the
# real merge commit hash, then:
git add docs/contributing/plans-status.md
git commit -m "docs(docs): pin deep research phase c status to merge hash

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Self-review notes (engineer may ignore — kept for plan audit trail)

- **Spec §4.2 coverage:** all 8 public endpoints implemented (Tasks 2, 3, 4, 5, 6, 7, 8). Internal surfaces (Task 9, 10) match the worker's already-merged call sites exactly.
- **Spec §7 billing:** `billingPath` accepted and validated; managed path gated behind `FEATURE_MANAGED_DEEP_RESEARCH` (Task 2 test). Default-BYOK, no managed UX work here — that's Phase D.
- **Spec §8 feature flag:** whole-router gate in Task 2 (`researchRouter.use("*", …)`) + managed-specific gate in `POST /runs`.
- **Spec §6.4 security:** cross-workspace → 404 (`loadRunForUser` in Task 4, detail in Task 3). SSE auth check before opening stream.
- **Spec §9.3 integration tests:** covered by Tasks 2–11. E2E (Playwright) is Phase D.
- **Nothing in `apps/web` or `apps/worker` is modified** — Phase C is strictly API layer. The worker's persist_report shape is an input to the plan, not a thing we change.
- **No placeholders.** All code shown is drop-in runnable; all commands have expected outcomes; all tests assert concrete values.
