# Deep Research Phase B — DB + Temporal Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the DB schema, Temporal workflow, and activities that drive a Deep Research run end-to-end (create plan → iterate plan → execute research → persist note) — all backend-only, no API routes, no web.

**Architecture:** Four Temporal activities (`create_plan` / `iterate_plan` / `execute_research` / `persist_report`) orchestrated by `DeepResearchWorkflow`, which signal-waits on user approve/feedback/cancel and tolerates 60 min long-running execution. Google keys are decrypted inside each activity (never in workflow state) — BYOK from `user_preferences.byokApiKey` via AES-256-GCM, Managed from `GEMINI_MANAGED_API_KEY` env. Images land in MinIO; the final note is created via the worker → `apps/api` internal callback (endpoint itself is Phase C, so Phase B mocks it at activity unit level).

**Tech Stack:** Drizzle (pg), Temporal Python SDK (temporalio 1.x), Google GenAI SDK (google-genai 1.73.1, used via `packages/llm` Phase A wrapper), MinIO client, pytest + `temporalio.testing.WorkflowEnvironment`.

---

## Scope & Spec Drift Notes

Read this before starting. These clarify the spec (`docs/superpowers/specs/2026-04-22-deep-research-integration-design.md`) where it disagrees with current repo state:

1. **User FK type.** Spec §4.1 writes `userId: uuid(...).references(() => users.id)`, but Better Auth users are `text` IDs. **Use `text("user_id").references(() => user.id)`** (singular `user`, per `packages/db/src/schema/users.ts` export). This matches `user_preferences`, `user_integrations`, `import_jobs`.
2. **BYOK key storage.** Spec §Dependencies claims "`user_preferences.byokApiKey` (AES-256, Plan 13)", but that column does not exist. **Phase B adds it** as `bytea("byok_api_key_encrypted")` (nullable, same AES-256-GCM scheme as `user_integrations.access_token_encrypted`). The UI to set the key is Phase D; Phase B + tests populate it directly via SQL fixture.
3. **`/api/internal/notes` endpoint.** Spec §4.2 assigns this to Phase C. **Phase B treats it as a mocked POST target** — `persist_report` activity calls `worker.lib.api_client.post_internal("/internal/notes", body)`, and the activity unit test stubs `post_internal` to assert the body shape. No real endpoint is added in Phase B.
4. **Activity file layout.** Spec §4.2 lists `activities/deep_research/{create_plan,iterate_plan,execute_research,persist_report}.py`. We follow that — new subpackage. Import paths in tests must use `worker.activities.deep_research.<module>`.
5. **Workflow name.** Existing `research_workflow.py` is the Plan 4 Research agent. The new file is `deep_research_workflow.py` (distinct). The workflow class is `DeepResearchWorkflow`.
6. **zod / shared types.** Phase C (`apps/api`) is the primary consumer of zod types. **Phase B does not create `packages/shared` entries** — that moves to Phase C. Drizzle's `$inferSelect/$inferInsert` TS types are exported from `packages/db` and that's enough for Phase B.
7. **Feature flag.** `FEATURE_DEEP_RESEARCH` is a server env. Phase B reads it in `temporal_main.py` (to gate workflow/activity registration) and in the workflow itself only as a defensive no-op: if somehow a run starts with the flag off, the workflow fails fast with `status=failed, error.code=feature_disabled`. The actual UI gate is Phase D.
8. **Managed path is inert in Phase B.** `billingPath` column + enum are added, the activity code branches on it, but with `FEATURE_MANAGED_DEEP_RESEARCH=false` the worker refuses `managed` runs (returns `status=failed, error.code=managed_disabled`). No credit-reservation logic.
9. **Image-upload timing.** This plan keeps image upload **inside `persist_report`** via a `fetch_image_bytes(google_uri) -> (bytes, mime_type)` callback (mocked in tests). The production wiring calls a Phase-C `/internal/research/image-bytes` endpoint that reads back the base64 from `research_run_artifacts.payload`. **If the actual `google-genai` SDK event delivers base64 inline in the image event payload** (spec §6.3 assumes this), switch to upload-during-stream in `execute_research` instead — the conversion is small: add `workspace_id` + a `put_object` callback to `ExecuteResearchInput`/helper, emit `ImageRef(google_uri, minio_url, mime_type)`, and let `persist_report` treat `images` as authoritative (`fetch_image_bytes` becomes a no-op). Either path satisfies the tests in this plan; pick based on what the SDK actually ships. Record the choice in a commit body.

## File Structure

**New files (Phase B):**

```
packages/db/src/schema/research.ts                  # research_runs, research_run_turns, research_run_artifacts tables
packages/db/drizzle/0013_<slug>.sql                 # migration bundling research.ts + byok column
apps/worker/src/worker/activities/deep_research/
  __init__.py                                       # re-exports 4 activity defns
  cost.py                                           # estimate_cost pure helper
  keys.py                                           # resolve_api_key helper (byok decrypt | managed env)
  markdown_plate.py                                 # markdown + citations + images → Plate value
  create_plan.py                                    # create_plan activity
  iterate_plan.py                                   # iterate_plan activity
  execute_research.py                               # execute_research activity (stream)
  persist_report.py                                 # persist_report activity (MinIO + internal note POST)
apps/worker/src/worker/workflows/deep_research_workflow.py
apps/worker/tests/deep_research/
  __init__.py
  test_cost.py
  test_keys.py
  test_markdown_plate.py
  test_create_plan.py
  test_iterate_plan.py
  test_execute_research.py
  test_persist_report.py
  test_workflow.py
```

**Modified files:**

```
packages/db/src/schema/user-preferences.ts          # + byokApiKeyEncrypted: bytea, nullable
packages/db/src/schema/enums.ts                     # + 5 research enums
packages/db/src/index.ts                            # + export * from "./schema/research"
apps/worker/src/worker/temporal_main.py             # register DeepResearchWorkflow + 4 new activities
.env.example                                        # + FEATURE_DEEP_RESEARCH, FEATURE_MANAGED_DEEP_RESEARCH, GEMINI_MANAGED_API_KEY, MANAGED_MARGIN
docs/contributing/plans-status.md                   # mark Phase B ✅ at end (post-feature workflow step)
```

Each file has one clear responsibility. Cost / keys / markdown_plate are pure helpers with no Temporal / Google imports — pytest runs them without any mocks. Each activity file is ≤150 lines.

---

## Task 1: Scaffold feature flag env entries

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Locate the LLM env block in `.env.example`**

Run: `grep -n "FEATURE_\|GEMINI_API_KEY" .env.example`

- [ ] **Step 2: Append the Deep Research env block**

Add at the end of the file (or next to existing FEATURE\_\* flags):

```bash
# --- Deep Research (Spec 2026-04-22-deep-research-integration-design) ---
# Master toggle. Off → /api/research, /app/research, and the Temporal workflow registration all no-op.
FEATURE_DEEP_RESEARCH=false
# Managed PAYG path. Off → only billingPath=byok is accepted. Flip after Plan 9b lands.
FEATURE_MANAGED_DEEP_RESEARCH=false
# Server account key used when billingPath=managed. Loaded even when the flag is off so we fail closed instead of silently.
GEMINI_MANAGED_API_KEY=
# Managed path margin (cost estimate * MANAGED_MARGIN = user charge). Default 1.3 per spec §7.4.
MANAGED_MARGIN=1.3
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore(env): deep research feature flags + managed key"
```

---

## Task 2: Extend `user_preferences` with BYOK key column

**Files:**

- Modify: `packages/db/src/schema/user-preferences.ts`
- Test: `packages/db/tests/schema.test.ts` (new — see Step 1 for scaffold detection)

> **Pre-check:** `ls packages/db/tests/ 2>/dev/null`. If the directory does not exist, skip writing a schema test (db package has no test harness today); rely on the migration apply test in Task 5 instead. Record in the commit message: `db: no schema test harness — verified by migration apply`.

- [ ] **Step 1: Modify the schema file**

Replace the `userPreferences` table definition in `packages/db/src/schema/user-preferences.ts` with:

```typescript
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./users";
import { bytea } from "./custom-types";
import { llmProviderEnum } from "./enums";

// Per-user LLM provider configuration. Gemini by default; switch to Ollama
// for fully-local BYOK stacks. `openai` is intentionally not supported
// (2026-04-15 decision — see docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md).
export const userPreferences = pgTable("user_preferences", {
  // Better Auth user.id is text, not uuid — FK type must match.
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  llmProvider: llmProviderEnum("llm_provider").notNull().default("gemini"),
  llmModel: text("llm_model").notNull().default("gemini-3-flash-preview"),
  embedModel: text("embed_model").notNull().default("gemini-embedding-001"),
  ttsModel: text("tts_model"),
  ollamaBaseUrl: text("ollama_base_url"),
  // Deep Research (Spec 2026-04-22) BYOK key. AES-256-GCM encrypted, wire
  // layout iv(12)||tag(16)||ct — same scheme as user_integrations. Nullable
  // until the user registers a key via Settings (Phase D).
  byokApiKeyEncrypted: bytea("byok_api_key_encrypted"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type UserPreferencesInsert = typeof userPreferences.$inferInsert;
```

- [ ] **Step 2: Verify the TS compiles**

Run: `pnpm --filter @opencairn/db typecheck 2>&1 | tail -20`
Expected: no errors. If `typecheck` script is missing, run `pnpm --filter @opencairn/db exec tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/user-preferences.ts
git commit -m "feat(db): add byok_api_key_encrypted to user_preferences for deep research"
```

---

## Task 3: Create `research.ts` schema + enums

**Files:**

- Create: `packages/db/src/schema/research.ts`
- Modify: `packages/db/src/schema/enums.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Append enums to `packages/db/src/schema/enums.ts`**

```typescript
// Deep Research (Spec 2026-04-22) — run lifecycle.
// Every value maps 1:1 to a Google Interactions API state except:
// - awaiting_approval: our local UX state (plan received, user hasn't approved)
// - cancelled: either user-cancelled or 24h-abandon timeout
export const researchStatusEnum = pgEnum("research_status", [
  "planning",
  "awaiting_approval",
  "researching",
  "completed",
  "failed",
  "cancelled",
]);

// 2 models exposed to users (spec §2). If Google releases more, add here and
// gate in UI by date.
export const researchModelEnum = pgEnum("research_model", [
  "deep-research-preview-04-2026",
  "deep-research-max-preview-04-2026",
]);

// Turn record role. `system` reserved for future audit entries.
export const researchTurnRoleEnum = pgEnum("research_turn_role", [
  "system",
  "user",
  "agent",
]);

// Turn record kind. `plan_proposal` from agent, the other 3 from user.
export const researchTurnKindEnum = pgEnum("research_turn_kind", [
  "plan_proposal",
  "user_feedback",
  "user_edit",
  "approval",
]);

// Artifact kind, one row per Google event we want to preserve.
export const researchArtifactKindEnum = pgEnum("research_artifact_kind", [
  "thought_summary",
  "text_delta",
  "image",
  "citation",
]);

// Billing path (spec §7). Populated at run creation, immutable thereafter.
export const researchBillingPathEnum = pgEnum("research_billing_path", [
  "byok",
  "managed",
]);
```

- [ ] **Step 2: Create `packages/db/src/schema/research.ts`**

```typescript
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";
import { projects } from "./projects";
import { notes } from "./notes";
import {
  researchStatusEnum,
  researchModelEnum,
  researchTurnRoleEnum,
  researchTurnKindEnum,
  researchArtifactKindEnum,
  researchBillingPathEnum,
} from "./enums";

// One row per Deep Research run. workflowId mirrors id so Temporal lookups
// stay idempotent. noteId populated only on status=completed.
export const researchRuns = pgTable(
  "research_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Better Auth uses text IDs — FK type must match.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    model: researchModelEnum("model").notNull(),
    billingPath: researchBillingPathEnum("billing_path").notNull(),
    status: researchStatusEnum("status").notNull().default("planning"),
    // Google Interactions resource id for the current (or last) interaction.
    // Chained via previous_interaction_id on each new turn.
    currentInteractionId: text("current_interaction_id"),
    approvedPlanText: text("approved_plan_text"),
    // Always equals id — present so Temporal signal helpers don't need to
    // know the mapping. Stored explicitly to survive replay with old ids.
    workflowId: text("workflow_id").notNull(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    error: jsonb("error").$type<{
      code: string;
      message: string;
      retryable: boolean;
    }>(),
    totalCostUsdCents: integer("total_cost_usd_cents"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("research_runs_workspace_status_idx").on(t.workspaceId, t.status),
    index("research_runs_user_created_idx").on(t.userId, t.createdAt),
  ],
);

// Turn = one user or agent message. seq monotonically increases per run.
export const researchRunTurns = pgTable(
  "research_run_turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: researchTurnRoleEnum("role").notNull(),
    kind: researchTurnKindEnum("kind").notNull(),
    // Google interaction id this turn produced (plan_proposal) or was sent to
    // (user_feedback). Null for user_edit (never hits Google) and approval.
    interactionId: text("interaction_id"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("research_run_turns_run_seq_idx").on(t.runId, t.seq),
  ],
);

// Artifact = one streamed event during executing. seq monotonic per run.
// Kept for debug + cost reconstruction; persist_report reads them back.
export const researchRunArtifacts = pgTable(
  "research_run_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: researchArtifactKindEnum("kind").notNull(),
    // { text } | { imageUrl, mimeType, seqOfOrigin } | { sourceUrl, title, seqOfOrigin }
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("research_run_artifacts_run_seq_idx").on(t.runId, t.seq),
  ],
);

export type ResearchRun = typeof researchRuns.$inferSelect;
export type ResearchRunInsert = typeof researchRuns.$inferInsert;
export type ResearchRunTurn = typeof researchRunTurns.$inferSelect;
export type ResearchRunTurnInsert = typeof researchRunTurns.$inferInsert;
export type ResearchRunArtifact = typeof researchRunArtifacts.$inferSelect;
export type ResearchRunArtifactInsert = typeof researchRunArtifacts.$inferInsert;
```

- [ ] **Step 3: Re-export from `packages/db/src/index.ts`**

Add after the existing `./schema/user-integrations` export:

```typescript
export * from "./schema/research";
```

(Place it alphabetically near the other `./schema/*` exports; matching the file's existing ordering is fine.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @opencairn/db exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/enums.ts packages/db/src/schema/research.ts packages/db/src/index.ts
git commit -m "feat(db): research_runs + turns + artifacts schema (deep research phase b)"
```

---

## Task 4: Generate drizzle migration 0013

**Files:**

- Create: `packages/db/drizzle/0013_<drizzle-generated-slug>.sql`
- Create: `packages/db/drizzle/meta/0013_snapshot.json` (auto)
- Modify: `packages/db/drizzle/meta/_journal.json` (auto)

- [ ] **Step 1: Verify `.env` points at a disposable dev DB**

Run: `grep '^DATABASE_URL' .env | head -1`
Expected: output like `DATABASE_URL=postgres://...@localhost:5432/opencairn` (local). Abort if it points at a production hostname.

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @opencairn/db db:generate`
Expected: drizzle prints the new file name (e.g. `drizzle/0013_heavy_lightning.sql`) and snapshot. A new SQL file appears in `packages/db/drizzle/`.

- [ ] **Step 3: Inspect the generated SQL**

Run: `ls packages/db/drizzle/ | grep '^0013' && cat packages/db/drizzle/0013_*.sql`
Verify (read manually):

- Creates the 6 new enums: `research_status`, `research_model`, `research_turn_role`, `research_turn_kind`, `research_artifact_kind`, `research_billing_path`.
- Creates tables `research_runs`, `research_run_turns`, `research_run_artifacts` with the 3 unique/regular indexes.
- Alters `user_preferences` adding `byok_api_key_encrypted bytea`.
- Does **not** drop any existing column. If drizzle suggests a destructive diff, stop and investigate — probably a branch-vs-main mismatch.

- [ ] **Step 4: Commit**

```bash
git add packages/db/drizzle/0013_*.sql packages/db/drizzle/meta/
git commit -m "feat(db): migration 0013 for deep research tables + user_preferences byok"
```

---

## Task 5: Apply migration against a live dev DB (smoke)

**Files:** none (verification only)

- [ ] **Step 1: Ensure Postgres is running**

Run: `docker-compose ps postgres | grep Up || docker-compose up -d postgres`
Expected: service is up.

- [ ] **Step 2: Apply migrations**

Run: `pnpm --filter @opencairn/db db:migrate 2>&1 | tail -20`
Expected: final line mentions success or "No pending migrations" if already applied on a prior attempt.

- [ ] **Step 3: Inspect a few tables**

Run: `docker-compose exec postgres psql -U opencairn -d opencairn -c '\d research_runs' | head -30`
Expected: lists `id`, `workspace_id` (uuid), `user_id` (text), `status`, `billing_path`, `workflow_id`, indices present.

Run: `docker-compose exec postgres psql -U opencairn -d opencairn -c '\d user_preferences' | grep byok`
Expected: `byok_api_key_encrypted | bytea | ... |`.

- [ ] **Step 4: No commit**

Verification-only task; proceed when the above three checks pass.

---

## Task 6: Activity subpackage skeleton

**Files:**

- Create: `apps/worker/src/worker/activities/deep_research/__init__.py`
- Create: `apps/worker/tests/deep_research/__init__.py`

- [ ] **Step 1: Write the package file**

`apps/worker/src/worker/activities/deep_research/__init__.py`:

```python
"""Deep Research (Spec 2026-04-22) Temporal activities.

Exports the 4 activity defns so ``temporal_main`` can register them via
``from worker.activities.deep_research import *``. Helpers (cost, keys,
markdown_plate) are **not** re-exported — they are pure and imported
directly where needed.
"""
from .create_plan import create_deep_research_plan
from .iterate_plan import iterate_deep_research_plan
from .execute_research import execute_deep_research
from .persist_report import persist_deep_research_report

__all__ = [
    "create_deep_research_plan",
    "iterate_deep_research_plan",
    "execute_deep_research",
    "persist_deep_research_report",
]
```

(At this point the imports will fail — that's fine. The subsequent tasks add the modules.)

- [ ] **Step 2: Empty test package init**

`apps/worker/tests/deep_research/__init__.py`:

```python
# Deep Research Phase B test package.
```

- [ ] **Step 3: Do not commit yet**

This scaffold only works once Tasks 7–12 land the modules it imports. Leave uncommitted for now; commit together with Task 12 (the last activity).

---

## Task 7: Cost estimation helper

**Files:**

- Create: `apps/worker/src/worker/activities/deep_research/cost.py`
- Test: `apps/worker/tests/deep_research/test_cost.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/deep_research/test_cost.py`:

```python
"""Cost estimation per spec §7.4:

    estimated_cost_usd = base[model] * clamp(duration_minutes / 20, 0.5, 1.5)
    base[deep-research-preview-04-2026]     = 2.0
    base[deep-research-max-preview-04-2026] = 5.0

Managed path further multiplies by MANAGED_MARGIN env (default 1.3).
"""
from __future__ import annotations

import pytest

from worker.activities.deep_research.cost import (
    estimate_cost_usd_cents,
)


@pytest.mark.parametrize(
    "model,duration_minutes,expected_cents",
    [
        # Default model, mid duration → base * 1.0
        ("deep-research-preview-04-2026", 20.0, 200),
        # Default model, short duration → clamp at 0.5
        ("deep-research-preview-04-2026", 5.0, 100),
        # Max model, long duration → clamp at 1.5
        ("deep-research-max-preview-04-2026", 60.0, 750),
        # Max model, exact 20 min → 5.00 USD
        ("deep-research-max-preview-04-2026", 20.0, 500),
    ],
)
def test_estimate_cost_base_and_clamps(model, duration_minutes, expected_cents):
    assert estimate_cost_usd_cents(model=model, duration_minutes=duration_minutes, billing_path="byok") == expected_cents


def test_managed_path_applies_margin(monkeypatch):
    # Default margin 1.3
    monkeypatch.delenv("MANAGED_MARGIN", raising=False)
    # 5.00 * 1.3 = 6.50 USD = 650 cents
    assert estimate_cost_usd_cents(
        model="deep-research-max-preview-04-2026",
        duration_minutes=20.0,
        billing_path="managed",
    ) == 650


def test_managed_path_reads_margin_env(monkeypatch):
    monkeypatch.setenv("MANAGED_MARGIN", "1.5")
    # 2.00 * 1.0 * 1.5 = 3.00 USD = 300 cents
    assert estimate_cost_usd_cents(
        model="deep-research-preview-04-2026",
        duration_minutes=20.0,
        billing_path="managed",
    ) == 300


def test_rejects_unknown_model():
    with pytest.raises(ValueError, match="unknown model"):
        estimate_cost_usd_cents(
            model="gemini-pro", duration_minutes=10.0, billing_path="byok"
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_cost.py -v 2>&1 | tail -20`
Expected: `ModuleNotFoundError: No module named 'worker.activities.deep_research.cost'`.

- [ ] **Step 3: Implement the helper**

`apps/worker/src/worker/activities/deep_research/cost.py`:

```python
"""Deep Research cost estimator — pure function, spec §7.4.

Google does not return actual billing, so we compute a deterministic
estimate from the model and measured duration. Managed path multiplies
by ``MANAGED_MARGIN`` (env, default 1.3). The result is stored as
integer cents in ``research_runs.total_cost_usd_cents`` and surfaced to
the user as an "approx" badge.
"""
from __future__ import annotations

import os
from typing import Literal

BillingPath = Literal["byok", "managed"]

_BASE_USD: dict[str, float] = {
    "deep-research-preview-04-2026": 2.0,
    "deep-research-max-preview-04-2026": 5.0,
}

_TIME_FACTOR_MIN = 0.5
_TIME_FACTOR_MAX = 1.5
_REFERENCE_DURATION_MIN = 20.0


def estimate_cost_usd_cents(
    *,
    model: str,
    duration_minutes: float,
    billing_path: BillingPath,
) -> int:
    """Return the estimated cost in integer USD cents."""
    base = _BASE_USD.get(model)
    if base is None:
        raise ValueError(f"unknown model: {model}")

    time_factor = duration_minutes / _REFERENCE_DURATION_MIN
    time_factor = max(_TIME_FACTOR_MIN, min(_TIME_FACTOR_MAX, time_factor))

    usd = base * time_factor
    if billing_path == "managed":
        margin = float(os.environ.get("MANAGED_MARGIN", "1.3"))
        usd *= margin

    return int(round(usd * 100))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_cost.py -v 2>&1 | tail -10`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/deep_research/cost.py apps/worker/tests/deep_research/
git commit -m "feat(worker): deep research cost estimator (spec §7.4)"
```

---

## Task 8: Key resolver helper

**Files:**

- Create: `apps/worker/src/worker/activities/deep_research/keys.py`
- Test: `apps/worker/tests/deep_research/test_keys.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/deep_research/test_keys.py`:

```python
"""Key resolver — translates (user_id, billing_path) into a plaintext
Gemini API key. BYOK: decrypt user_preferences.byok_api_key_encrypted.
Managed: read GEMINI_MANAGED_API_KEY env.

The real implementation reads from DB via psycopg. Tests inject a fake
fetcher so we don't need a live DB.
"""
from __future__ import annotations

import base64
import os

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from worker.activities.deep_research.keys import (
    KeyResolutionError,
    resolve_api_key,
)
from worker.lib.integration_crypto import encrypt_token


@pytest.fixture
def _encryption_key(monkeypatch):
    raw = AESGCM.generate_key(bit_length=256)
    monkeypatch.setenv("INTEGRATION_TOKEN_ENCRYPTION_KEY", base64.b64encode(raw).decode())


def test_byok_decrypts_user_preferences_key(_encryption_key):
    ciphertext = encrypt_token("gemini-secret-123")

    async def _fetch_byok(user_id: str) -> bytes | None:
        assert user_id == "user-abc"
        return ciphertext

    import asyncio
    result = asyncio.run(
        resolve_api_key(
            user_id="user-abc",
            billing_path="byok",
            fetch_byok_ciphertext=_fetch_byok,
        )
    )
    assert result == "gemini-secret-123"


def test_byok_missing_raises(_encryption_key):
    async def _fetch_byok(_: str) -> bytes | None:
        return None

    import asyncio
    with pytest.raises(KeyResolutionError, match="no byok key"):
        asyncio.run(
            resolve_api_key(
                user_id="user-abc",
                billing_path="byok",
                fetch_byok_ciphertext=_fetch_byok,
            )
        )


def test_managed_reads_env(monkeypatch):
    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "server-secret-xyz")

    async def _fetch_byok(_: str) -> bytes | None:
        raise AssertionError("must not call byok fetcher on managed path")

    import asyncio
    result = asyncio.run(
        resolve_api_key(
            user_id="user-abc",
            billing_path="managed",
            fetch_byok_ciphertext=_fetch_byok,
        )
    )
    assert result == "server-secret-xyz"


def test_managed_missing_env_raises(monkeypatch):
    monkeypatch.delenv("GEMINI_MANAGED_API_KEY", raising=False)

    async def _fetch_byok(_: str) -> bytes | None:
        return None

    import asyncio
    with pytest.raises(KeyResolutionError, match="GEMINI_MANAGED_API_KEY"):
        asyncio.run(
            resolve_api_key(
                user_id="user-abc",
                billing_path="managed",
                fetch_byok_ciphertext=_fetch_byok,
            )
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_keys.py -v 2>&1 | tail -20`
Expected: `ModuleNotFoundError: No module named 'worker.activities.deep_research.keys'`.

- [ ] **Step 3: Check `encrypt_token` / `decrypt_token` helpers exist**

Run: `grep -n "def encrypt_token\|def decrypt_token" apps/worker/src/worker/lib/integration_crypto.py`
Expected: both functions listed. If only `decrypt_token` exists, the test's `encrypt_token` import won't work — in that case, write the test fixture using raw AESGCM primitives instead and keep the production `resolve_api_key` on `decrypt_token`.

- [ ] **Step 4: Implement the resolver**

`apps/worker/src/worker/activities/deep_research/keys.py`:

```python
"""Gemini API key resolver for Deep Research activities.

The resolver is called **inside** each activity — never from the workflow
— so plaintext keys never enter Temporal event history. The fetcher
callback exists purely so tests can inject fake DB behaviour; production
callers use the default ``fetch_byok_ciphertext_from_db``.
"""
from __future__ import annotations

import os
from typing import Awaitable, Callable, Literal

from worker.lib.integration_crypto import decrypt_token

BillingPath = Literal["byok", "managed"]
ByokFetcher = Callable[[str], Awaitable[bytes | None]]


class KeyResolutionError(RuntimeError):
    """Non-retryable key acquisition failure. Worker should fail-fast."""


async def resolve_api_key(
    *,
    user_id: str,
    billing_path: BillingPath,
    fetch_byok_ciphertext: ByokFetcher,
) -> str:
    if billing_path == "managed":
        key = os.environ.get("GEMINI_MANAGED_API_KEY", "").strip()
        if not key:
            raise KeyResolutionError(
                "billing_path=managed but GEMINI_MANAGED_API_KEY is not set"
            )
        return key

    if billing_path == "byok":
        ciphertext = await fetch_byok_ciphertext(user_id)
        if ciphertext is None:
            raise KeyResolutionError(
                f"no byok key registered for user {user_id}"
            )
        return decrypt_token(ciphertext)

    raise KeyResolutionError(f"unknown billing_path: {billing_path}")
```

- [ ] **Step 5: If `encrypt_token` is missing, add it**

If Step 3 showed only `decrypt_token`, append this to `apps/worker/src/worker/lib/integration_crypto.py`:

```python
def encrypt_token(plaintext: str) -> bytes:
    """Encrypt ``plaintext`` with the configured AES-256-GCM key.

    Wire layout: iv(12) || tag(16) || ciphertext — matches
    ``apps/api/src/lib/integration-tokens.ts`` so API-written and
    worker-written ciphertexts round-trip.
    """
    iv = os.urandom(_IV_LEN)
    aes = AESGCM(_get_key())
    ct_with_tag = aes.encrypt(iv, plaintext.encode("utf-8"), None)
    tag = ct_with_tag[-_TAG_LEN:]
    ct = ct_with_tag[:-_TAG_LEN]
    return iv + tag + ct
```

(`_IV_LEN`, `_TAG_LEN`, `_get_key`, and `AESGCM` are already imported at the top of the file.)

- [ ] **Step 6: Run tests**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_keys.py -v 2>&1 | tail -10`
Expected: `4 passed`.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/worker/activities/deep_research/keys.py apps/worker/tests/deep_research/test_keys.py apps/worker/src/worker/lib/integration_crypto.py
git commit -m "feat(worker): deep research key resolver (byok decrypt + managed env)"
```

---

## Task 9: Markdown → Plate conversion helper

**Files:**

- Create: `apps/worker/src/worker/activities/deep_research/markdown_plate.py`
- Test: `apps/worker/tests/deep_research/test_markdown_plate.py`
- Create (fixture): `apps/worker/tests/fixtures/deep_research/report_sample.md` — short markdown with heading + paragraph + image placeholder + code block + citation link
- Create (fixture): `apps/worker/tests/fixtures/deep_research/report_sample_plate.json` — expected Plate value (copy the runtime output during Step 5 and commit it)

- [ ] **Step 1: Create the input fixture**

`apps/worker/tests/fixtures/deep_research/report_sample.md`:

```markdown
# Headline

A short intro paragraph with a [citation](https://example.com/a) and another [source](https://example.com/b).

## Section

- bullet 1
- bullet 2

![chart1](gs://opencairn-deep-research/chart1.png)

```python
def hello():
    print("hi")
```

Done.
```

- [ ] **Step 2: Write the failing test**

`apps/worker/tests/deep_research/test_markdown_plate.py`:

```python
"""Markdown → Plate conversion for Deep Research reports.

Scope is deliberately narrow — the converter must handle:
- headings (h1, h2)
- paragraphs with inline links
- bulleted lists
- fenced code blocks with language hint
- inline image refs (replaced by image element pointing at MinIO URL)

Edge cases (tables, nested lists, block quotes, math) are caught by the
fallback paragraph path — the caller accepts a degraded but non-empty
Plate value over a crash.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from worker.activities.deep_research.markdown_plate import (
    ConversionError,
    markdown_to_plate,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "deep_research"


def test_converts_sample_report():
    md = (FIXTURES / "report_sample.md").read_text()
    image_urls = {"gs://opencairn-deep-research/chart1.png": "https://minio.local/r/chart1.png"}
    citations = [
        {"title": "First source", "url": "https://example.com/a"},
        {"title": "Second source", "url": "https://example.com/b"},
    ]

    result = markdown_to_plate(markdown=md, image_urls=image_urls, citations=citations)

    # Top-level node types are what we care about. Exact attrs are pinned
    # in the JSON snapshot below once we commit the golden file.
    assert result[0]["type"] == "h1"
    assert any(node["type"] == "img" for node in result)
    assert any(node["type"] == "code_block" for node in result)


def test_image_without_minio_mapping_falls_back_to_paragraph():
    md = "![orphan](gs://missing.png)"
    result = markdown_to_plate(markdown=md, image_urls={}, citations=[])
    # Orphan images become paragraphs with italic "[missing image: ...]" so
    # the user is told something was lost rather than silently dropping.
    assert result[0]["type"] == "p"
    assert "missing image" in json.dumps(result[0]).lower()


def test_completely_broken_markdown_returns_fallback_paragraph():
    result = markdown_to_plate(markdown="\x00\x01\x02", image_urls={}, citations=[])
    assert len(result) == 1
    assert result[0]["type"] == "p"


def test_citations_appear_as_links():
    md = "See [spec](https://example.com/spec)."
    result = markdown_to_plate(
        markdown=md, image_urls={}, citations=[{"title": "Spec", "url": "https://example.com/spec"}]
    )
    # Link must be an inline element on the paragraph's children, not a
    # sibling node.
    para = result[0]
    assert para["type"] == "p"
    assert any(c.get("type") == "a" for c in para["children"])


def test_empty_markdown_raises():
    with pytest.raises(ConversionError):
        markdown_to_plate(markdown="", image_urls={}, citations=[])
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_markdown_plate.py -v 2>&1 | tail -10`
Expected: `ModuleNotFoundError`.

- [ ] **Step 4: Check which markdown parser is already in worker deps**

Run: `grep -E 'markdown|mistune|marko' apps/worker/pyproject.toml`
Expected: either `mistune` or `marko` is already pinned (ingest uses one). If neither, stop and add `marko = ">=2.0"` to `[project.dependencies]` in `apps/worker/pyproject.toml` and run `uv sync`.

- [ ] **Step 5: Implement the converter**

`apps/worker/src/worker/activities/deep_research/markdown_plate.py`:

```python
"""Markdown → Plate v49 value converter for Deep Research reports.

Strategy: walk the marko AST and emit the Plate node types the frontend
already knows (see docs/contributing/llm-antipatterns.md §8 for Plate
pitfalls). Unknown / broken input falls back to a single paragraph so
the persist_report activity never crashes on bad input — we'd rather
save a degraded note than lose the run.
"""
from __future__ import annotations

from typing import Any

import marko
import marko.block
import marko.inline


class ConversionError(ValueError):
    """Raised when the caller passes obviously unusable input (empty markdown)."""


def markdown_to_plate(
    *,
    markdown: str,
    image_urls: dict[str, str],
    citations: list[dict[str, str]],
) -> list[dict[str, Any]]:
    """Return a list of Plate nodes representing ``markdown``.

    Args:
        markdown: Google-returned report body.
        image_urls: Mapping from Google-native image URI (e.g.
            ``gs://...``) → MinIO signed URL. Missing entries degrade to
            a fallback paragraph.
        citations: Ordered citation list from Google outputs. Currently
            informational — links already appear inline in the markdown.
    """
    if not markdown.strip():
        raise ConversionError("markdown is empty")

    try:
        doc = marko.Markdown().parse(markdown)
    except Exception:
        return [_paragraph(markdown)]

    nodes: list[dict[str, Any]] = []
    for child in doc.children:
        try:
            converted = _convert_block(child, image_urls=image_urls)
        except Exception:
            # Any block we can't render becomes an inert paragraph so
            # the whole document still loads.
            converted = [_paragraph(_inline_text(child) or "")]
        nodes.extend(converted)

    if not nodes:
        return [_paragraph(markdown)]
    return nodes


def _convert_block(node: Any, *, image_urls: dict[str, str]) -> list[dict[str, Any]]:
    if isinstance(node, marko.block.Heading):
        level = min(max(node.level, 1), 6)
        return [{"type": f"h{level}", "children": _convert_inline(node.children, image_urls=image_urls)}]
    if isinstance(node, marko.block.Paragraph):
        kids = _convert_inline(node.children, image_urls=image_urls)
        # Standalone image → promote to img block.
        if len(kids) == 1 and kids[0].get("type") == "img":
            return [kids[0]]
        return [{"type": "p", "children": kids or [{"text": ""}]}]
    if isinstance(node, marko.block.List):
        items = []
        for li in node.children:
            items.append({"type": "li", "children": [{"type": "lic", "children": _convert_inline(_first_para_children(li), image_urls=image_urls)}]})
        tag = "ol" if getattr(node, "ordered", False) else "ul"
        return [{"type": tag, "children": items}]
    if isinstance(node, marko.block.FencedCode):
        lang = getattr(node, "lang", "") or ""
        text = "".join(getattr(c, "children", "") for c in node.children) if node.children else ""
        return [{
            "type": "code_block",
            "lang": lang,
            "children": [{"type": "code_line", "children": [{"text": line}]} for line in (text.rstrip().split("\n") or [""])],
        }]
    if isinstance(node, marko.block.BlankLine):
        return []
    # Unknown block types → collapse to a paragraph.
    return [_paragraph(_inline_text(node) or "")]


def _convert_inline(children: list[Any], *, image_urls: dict[str, str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for c in children or []:
        if isinstance(c, marko.inline.RawText):
            out.append({"text": c.children})
        elif isinstance(c, marko.inline.Link):
            out.append({"type": "a", "url": c.dest, "children": [{"text": _inline_text(c) or c.dest}]})
        elif isinstance(c, marko.inline.Image):
            resolved = image_urls.get(c.dest)
            if resolved:
                out.append({"type": "img", "url": resolved, "alt": c.title or "", "children": [{"text": ""}]})
            else:
                out.append({"text": f"[missing image: {c.dest}]", "italic": True})
        elif isinstance(c, marko.inline.CodeSpan):
            out.append({"text": c.children, "code": True})
        elif isinstance(c, marko.inline.Emphasis):
            out.append({"text": _inline_text(c), "italic": True})
        elif isinstance(c, marko.inline.StrongEmphasis):
            out.append({"text": _inline_text(c), "bold": True})
        else:
            text = _inline_text(c)
            if text:
                out.append({"text": text})
    return out


def _first_para_children(li: Any) -> list[Any]:
    for child in li.children:
        if isinstance(child, marko.block.Paragraph):
            return child.children
    return []


def _inline_text(node: Any) -> str:
    if isinstance(node, str):
        return node
    if hasattr(node, "children"):
        if isinstance(node.children, str):
            return node.children
        return "".join(_inline_text(c) for c in node.children)
    return ""


def _paragraph(text: str) -> dict[str, Any]:
    return {"type": "p", "children": [{"text": text}]}
```

- [ ] **Step 6: Run tests**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_markdown_plate.py -v 2>&1 | tail -15`
Expected: `5 passed`.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/worker/activities/deep_research/markdown_plate.py apps/worker/tests/deep_research/test_markdown_plate.py apps/worker/tests/fixtures/deep_research/report_sample.md apps/worker/pyproject.toml apps/worker/uv.lock
git commit -m "feat(worker): markdown→plate converter for deep research reports"
```

(If pyproject.toml/uv.lock are unchanged because marko was already pinned, drop them from `git add`.)

---

## Task 10: `create_plan` activity

**Files:**

- Create: `apps/worker/src/worker/activities/deep_research/create_plan.py`
- Test: `apps/worker/tests/deep_research/test_create_plan.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/deep_research/test_create_plan.py`:

```python
"""``create_deep_research_plan`` activity — first turn of a run.

The activity:
  1. Resolves the API key (byok or managed).
  2. Calls ``GeminiProvider.start_interaction(collaborative_planning=True)``.
  3. Polls ``get_interaction`` every 5 s (mocked to 0 s in tests) until
     ``status == "completed"``.
  4. Returns the plan text + interaction id; the workflow persists them.

Tests use a fake provider so we don't hit Google.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import pytest

from worker.activities.deep_research.create_plan import (
    CreatePlanInput,
    CreatePlanOutput,
    _run_create_plan,  # private helper so tests can pass a fake provider factory
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
    def __init__(self, states: list[_FakeState]):
        self._handle = _FakeHandle(id="int-1", agent="deep-research-preview-04-2026")
        self._states = list(states)
        self.start_calls: list[dict[str, Any]] = []

    async def start_interaction(self, **kwargs):
        self.start_calls.append(kwargs)
        return self._handle

    async def get_interaction(self, interaction_id):
        assert interaction_id == "int-1"
        return self._states.pop(0)


async def _fake_fetch(user_id):
    return None  # managed path in these tests, so byok fetcher is unused


def test_happy_path_returns_plan(monkeypatch):
    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake-managed")

    provider = _FakeProvider(states=[
        _FakeState(id="int-1", status="running", outputs=[]),
        _FakeState(
            id="int-1",
            status="completed",
            outputs=[{"type": "text", "text": "Plan: do A, then B."}],
        ),
    ])

    result = asyncio.run(
        _run_create_plan(
            CreatePlanInput(
                run_id="run-1",
                user_id="user-1",
                topic="What is X?",
                model="deep-research-preview-04-2026",
                billing_path="managed",
            ),
            provider_factory=lambda api_key: provider,
            fetch_byok_ciphertext=_fake_fetch,
            poll_interval_seconds=0,
        )
    )

    assert isinstance(result, CreatePlanOutput)
    assert result.interaction_id == "int-1"
    assert "do A" in result.plan_text
    # collaborative_planning + background must be True for planning step (spec §5.1)
    assert provider.start_calls[0]["collaborative_planning"] is True
    assert provider.start_calls[0]["background"] is True


def test_fails_fast_on_failed_status(monkeypatch):
    from temporalio.exceptions import ApplicationError

    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake-managed")
    provider = _FakeProvider(states=[
        _FakeState(
            id="int-1",
            status="failed",
            outputs=[],
            error={"code": "quota_exceeded", "message": "over quota"},
        ),
    ])

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
                provider_factory=lambda api_key: provider,
                fetch_byok_ciphertext=_fake_fetch,
                poll_interval_seconds=0,
            )
        )
    # non_retryable so Temporal doesn't eat our budget retrying a hard failure
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
                provider_factory=lambda api_key: provider,
                fetch_byok_ciphertext=_fake_fetch,
                poll_interval_seconds=0,
            )
        )
    assert excinfo.value.non_retryable is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_create_plan.py -v 2>&1 | tail -15`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the activity**

`apps/worker/src/worker/activities/deep_research/create_plan.py`:

```python
"""``create_deep_research_plan`` Temporal activity.

First turn of a Deep Research run. Calls
``GeminiProvider.start_interaction(collaborative_planning=True,
background=True)`` and polls until the plan proposal is ready.

Side effects (DB writes, SSE events) are deliberately **outside** the
activity — the workflow does them after receiving this activity's
return value. That keeps the activity deterministic-ish (only Google
I/O) and unit-testable without a DB.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol

from temporalio import activity
from temporalio.exceptions import ApplicationError

from llm.factory import get_provider  # existing packages/llm helper
from worker.activities.deep_research.keys import (
    KeyResolutionError,
    resolve_api_key,
)


@dataclass
class CreatePlanInput:
    run_id: str
    user_id: str
    topic: str
    model: str  # research_model enum value
    billing_path: str  # "byok" | "managed"


@dataclass
class CreatePlanOutput:
    interaction_id: str
    plan_text: str


class _ProviderLike(Protocol):
    async def start_interaction(self, **kwargs): ...
    async def get_interaction(self, interaction_id: str): ...


ProviderFactory = Callable[[str], _ProviderLike]
ByokFetcher = Callable[[str], Awaitable[bytes | None]]


async def _run_create_plan(
    inp: CreatePlanInput,
    *,
    provider_factory: ProviderFactory,
    fetch_byok_ciphertext: ByokFetcher,
    poll_interval_seconds: float = 5.0,
) -> CreatePlanOutput:
    try:
        api_key = await resolve_api_key(
            user_id=inp.user_id,
            billing_path=inp.billing_path,  # type: ignore[arg-type]
            fetch_byok_ciphertext=fetch_byok_ciphertext,
        )
    except KeyResolutionError as exc:
        raise ApplicationError(
            str(exc), "key_resolution", non_retryable=True
        )

    provider = provider_factory(api_key)
    handle = await provider.start_interaction(
        input=inp.topic,
        agent=inp.model,
        collaborative_planning=True,
        background=True,
        stream=False,
    )
    while True:
        state = await provider.get_interaction(handle.id)
        if state.status == "completed":
            break
        if state.status in ("failed", "cancelled"):
            err = state.error or {}
            raise ApplicationError(
                f"interaction {state.status}: {err.get('code', 'unknown')}: {err.get('message', '')}",
                err.get("code", state.status),
                non_retryable=True,
            )
        await asyncio.sleep(poll_interval_seconds)

    plan_text = _extract_text(state.outputs)
    if not plan_text:
        raise ApplicationError(
            "interaction completed without text output",
            "empty_plan",
            non_retryable=True,
        )
    return CreatePlanOutput(interaction_id=handle.id, plan_text=plan_text)


def _extract_text(outputs: list[dict]) -> str:
    return "".join(o.get("text", "") for o in outputs if o.get("type") == "text")


async def _default_fetch_byok(user_id: str) -> bytes | None:
    # Real DB fetch — implemented as a thin SQL call. Lazy import so the
    # unit tests never need psycopg.
    from worker.lib.db_readonly import fetch_byok_ciphertext as _fetch
    return await _fetch(user_id)


@activity.defn(name="create_deep_research_plan")
async def create_deep_research_plan(inp: CreatePlanInput) -> dict[str, str]:
    """Return plain dict so the workflow doesn't need the dataclass type
    registered for serialization (matches repo convention — see
    ``batch_embed_activities.submit_batch_embed``)."""

    def _factory(api_key: str):
        return get_provider(provider="gemini", api_key=api_key)

    out = await _run_create_plan(
        inp,
        provider_factory=_factory,
        fetch_byok_ciphertext=_default_fetch_byok,
    )
    return {"interaction_id": out.interaction_id, "plan_text": out.plan_text}
```

- [ ] **Step 4: Stub `worker.lib.db_readonly.fetch_byok_ciphertext`**

The activity imports it; production impl reads from pg. Phase B adds the stub so the worker boots:

Create `apps/worker/src/worker/lib/db_readonly.py`:

```python
"""Read-only DB helpers for Temporal activities.

Kept minimal — activities prefer HTTP to ``/api/internal`` for writes
but need a couple of direct reads (BYOK ciphertext, run projection)
where a round-trip to the API would be wasteful.
"""
from __future__ import annotations

import os

import psycopg


async def fetch_byok_ciphertext(user_id: str) -> bytes | None:
    url = os.environ["DATABASE_URL"]
    async with await psycopg.AsyncConnection.connect(url) as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT byok_api_key_encrypted FROM user_preferences WHERE user_id = %s",
                (user_id,),
            )
            row = await cur.fetchone()
    if row is None or row[0] is None:
        return None
    return bytes(row[0])
```

(If `psycopg` is not yet a dependency, add `psycopg[binary] = ">=3.2"` to `apps/worker/pyproject.toml`.)

- [ ] **Step 5: Run tests**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_create_plan.py -v 2>&1 | tail -15`
Expected: `3 passed`.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/activities/deep_research/create_plan.py apps/worker/tests/deep_research/test_create_plan.py apps/worker/src/worker/lib/db_readonly.py apps/worker/pyproject.toml apps/worker/uv.lock
git commit -m "feat(worker): create_deep_research_plan activity + readonly db helper"
```

---

## Task 11: `iterate_plan` activity

**Files:**

- Create: `apps/worker/src/worker/activities/deep_research/iterate_plan.py`
- Test: `apps/worker/tests/deep_research/test_iterate_plan.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/deep_research/test_iterate_plan.py`:

```python
"""``iterate_deep_research_plan`` — user feedback turn.

Differs from ``create_plan`` only in that ``previous_interaction_id`` is
set, so Google chains against the prior plan. Input / output shape
matches ``create_plan`` for convenience.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import pytest

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
    def __init__(self, states):
        self._handle = _FakeHandle(id="int-2", agent="deep-research-preview-04-2026")
        self._states = list(states)
        self.start_calls: list[dict[str, Any]] = []

    async def start_interaction(self, **kwargs):
        self.start_calls.append(kwargs)
        return self._handle

    async def get_interaction(self, _id):
        return self._states.pop(0)


async def _fake_fetch(_):
    return None


def test_iterate_passes_previous_interaction_id(monkeypatch):
    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake")
    provider = _FakeProvider(states=[
        _FakeState(id="int-2", status="completed", outputs=[{"type": "text", "text": "Plan v2"}]),
    ])

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
            provider_factory=lambda _: provider,
            fetch_byok_ciphertext=_fake_fetch,
            poll_interval_seconds=0,
        )
    )
    assert result.plan_text == "Plan v2"
    assert provider.start_calls[0]["previous_interaction_id"] == "int-1"
    assert provider.start_calls[0]["collaborative_planning"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_iterate_plan.py -v 2>&1 | tail -10`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the activity**

`apps/worker/src/worker/activities/deep_research/iterate_plan.py`:

```python
"""``iterate_deep_research_plan`` Temporal activity.

Same loop as ``create_plan`` but with a chained ``previous_interaction_id``.
Factored as a separate activity (rather than a flag on create_plan) so
workflow history is easier to read and each activity has one retry
policy to reason about.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol

from temporalio import activity
from temporalio.exceptions import ApplicationError

from llm.factory import get_provider
from worker.activities.deep_research.keys import (
    KeyResolutionError,
    resolve_api_key,
)
from worker.activities.deep_research.create_plan import _default_fetch_byok, _extract_text


@dataclass
class IteratePlanInput:
    run_id: str
    user_id: str
    feedback: str
    model: str
    billing_path: str
    previous_interaction_id: str


@dataclass
class IteratePlanOutput:
    interaction_id: str
    plan_text: str


class _ProviderLike(Protocol):
    async def start_interaction(self, **kwargs): ...
    async def get_interaction(self, interaction_id: str): ...


async def _run_iterate_plan(
    inp: IteratePlanInput,
    *,
    provider_factory: Callable[[str], _ProviderLike],
    fetch_byok_ciphertext: Callable[[str], Awaitable[bytes | None]],
    poll_interval_seconds: float = 5.0,
) -> IteratePlanOutput:
    try:
        api_key = await resolve_api_key(
            user_id=inp.user_id,
            billing_path=inp.billing_path,  # type: ignore[arg-type]
            fetch_byok_ciphertext=fetch_byok_ciphertext,
        )
    except KeyResolutionError as exc:
        raise ApplicationError(str(exc), "key_resolution", non_retryable=True)

    provider = provider_factory(api_key)
    handle = await provider.start_interaction(
        input=inp.feedback,
        agent=inp.model,
        collaborative_planning=True,
        background=True,
        stream=False,
        previous_interaction_id=inp.previous_interaction_id,
    )
    while True:
        state = await provider.get_interaction(handle.id)
        if state.status == "completed":
            break
        if state.status in ("failed", "cancelled"):
            err = state.error or {}
            raise ApplicationError(
                f"interaction {state.status}: {err.get('code', 'unknown')}",
                err.get("code", state.status),
                non_retryable=True,
            )
        await asyncio.sleep(poll_interval_seconds)

    text = _extract_text(state.outputs)
    if not text:
        raise ApplicationError("empty iterated plan", "empty_plan", non_retryable=True)
    return IteratePlanOutput(interaction_id=handle.id, plan_text=text)


@activity.defn(name="iterate_deep_research_plan")
async def iterate_deep_research_plan(inp: IteratePlanInput) -> dict[str, str]:
    def _factory(api_key: str):
        return get_provider(provider="gemini", api_key=api_key)

    out = await _run_iterate_plan(
        inp,
        provider_factory=_factory,
        fetch_byok_ciphertext=_default_fetch_byok,
    )
    return {"interaction_id": out.interaction_id, "plan_text": out.plan_text}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_iterate_plan.py -v 2>&1 | tail -10`
Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/deep_research/iterate_plan.py apps/worker/tests/deep_research/test_iterate_plan.py
git commit -m "feat(worker): iterate_deep_research_plan activity (feedback chaining)"
```

---

## Task 12: `execute_research` activity (streaming)

**Files:**

- Create: `apps/worker/src/worker/activities/deep_research/execute_research.py`
- Test: `apps/worker/tests/deep_research/test_execute_research.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/deep_research/test_execute_research.py`:

```python
"""``execute_deep_research`` — the 20-60 min executing phase.

The activity:
  1. Starts a non-collaborative interaction with
     ``stream=True`` and ``previous_interaction_id=<approved_plan_interaction>``.
  2. Consumes ``stream_interaction`` events; each event is forwarded via
     an ``on_event`` callback (the workflow persists it to
     research_run_artifacts + sends SSE).
  3. Returns the final report text + ordered image refs + citations.

The activity owns Temporal ``heartbeat`` calls — tested by a sentinel
side-effect on the provider mock.
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
    def __init__(self, events, final_state):
        self._handle = _FakeHandle(id="int-exec", agent="deep-research-preview-04-2026")
        self._events = list(events)
        self._final = final_state
        self.start_calls: list[dict[str, Any]] = []

    async def start_interaction(self, **kwargs):
        self.start_calls.append(kwargs)
        return self._handle

    async def stream_interaction(self, interaction_id, *, last_event_id=None):
        async def _gen() -> AsyncGenerator[_FakeEvent, None]:
            for ev in self._events:
                yield ev
        return _gen()

    async def get_interaction(self, interaction_id):
        return self._final


async def _fake_fetch(_):
    return None


def test_happy_path_streams_and_collects(monkeypatch):
    monkeypatch.setenv("GEMINI_MANAGED_API_KEY", "fake")

    events = [
        _FakeEvent("1", "thought_summary", {"text": "considering X"}),
        _FakeEvent("2", "text", {"text": "Report body... "}),
        _FakeEvent("3", "image", {"url": "gs://img/a.png", "mime_type": "image/png"}),
        _FakeEvent("4", "text", {"text": "more body."}),
        _FakeEvent("5", "citation", {"url": "https://example.com/s1", "title": "Source 1"}),
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
            provider_factory=lambda _: provider,
            fetch_byok_ciphertext=_fake_fetch,
            on_event=on_event,
            on_heartbeat=on_heartbeat,
        )
    )

    assert isinstance(result, ExecuteResearchOutput)
    assert result.interaction_id == "int-exec"
    assert result.report_text == "Report body... more body."
    assert [i.url for i in result.images] == ["gs://img/a.png"]
    assert [c.url for c in result.citations] == ["https://example.com/s1"]
    # start_interaction called with collaborative_planning=False, stream=True, visualization=True
    call = provider.start_calls[0]
    assert call["collaborative_planning"] is False
    assert call["stream"] is True
    assert call["visualization"] is True
    assert call["thinking_summaries"] == "auto"
    # on_event called once per forwarded event (status not forwarded)
    assert len(forwarded) == 5
    # heartbeat invoked at least once
    assert heartbeats


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
                provider_factory=lambda _: provider,
                fetch_byok_ciphertext=_fake_fetch,
                on_event=_noop,
                on_heartbeat=lambda: None,
            )
        )
    # Google-timeout is retryable (different from quota)
    assert "timeout" in str(excinfo.value)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_execute_research.py -v 2>&1 | tail -10`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the activity**

`apps/worker/src/worker/activities/deep_research/execute_research.py`:

```python
"""``execute_deep_research`` Temporal activity — streaming execution.

This is the 20-60 min phase. The activity:
  - Starts a stream=True interaction chained from the approved plan id.
  - Consumes events and forwards them to ``on_event`` (the production
    callback writes to research_run_artifacts + SSE).
  - Heartbeats every 30 s so Temporal doesn't consider us stalled.
  - Returns the consolidated report + image / citation references.

Production retry policy (configured in the workflow): infinite retries
with 5 min backoff for transient network errors, but non-retryable for
``ApplicationError(non_retryable=True)`` we raise on quota / auth / etc.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

from temporalio import activity
from temporalio.exceptions import ApplicationError

from llm.factory import get_provider
from worker.activities.deep_research.keys import (
    KeyResolutionError,
    resolve_api_key,
)
from worker.activities.deep_research.create_plan import _default_fetch_byok

_HEARTBEAT_EVERY = 30.0
_NON_RETRYABLE_CODES = {"quota_exceeded", "invalid_byok_key", "403", "401"}


@dataclass
class ImageRef:
    url: str
    mime_type: str


@dataclass
class Citation:
    url: str
    title: str


@dataclass
class ExecuteResearchInput:
    run_id: str
    user_id: str
    approved_plan: str
    model: str
    billing_path: str
    previous_interaction_id: str


@dataclass
class ExecuteResearchOutput:
    interaction_id: str
    report_text: str
    images: list[ImageRef] = field(default_factory=list)
    citations: list[Citation] = field(default_factory=list)


class _ProviderLike(Protocol):
    async def start_interaction(self, **kwargs): ...
    async def stream_interaction(self, interaction_id: str, *, last_event_id: str | None = None): ...
    async def get_interaction(self, interaction_id: str): ...


OnEvent = Callable[[str, dict[str, Any]], Awaitable[None]]
OnHeartbeat = Callable[[], None]


async def _run_execute_research(
    inp: ExecuteResearchInput,
    *,
    provider_factory: Callable[[str], _ProviderLike],
    fetch_byok_ciphertext: Callable[[str], Awaitable[bytes | None]],
    on_event: OnEvent,
    on_heartbeat: OnHeartbeat,
) -> ExecuteResearchOutput:
    try:
        api_key = await resolve_api_key(
            user_id=inp.user_id,
            billing_path=inp.billing_path,  # type: ignore[arg-type]
            fetch_byok_ciphertext=fetch_byok_ciphertext,
        )
    except KeyResolutionError as exc:
        raise ApplicationError(str(exc), "key_resolution", non_retryable=True)

    provider = provider_factory(api_key)
    handle = await provider.start_interaction(
        input=inp.approved_plan,
        agent=inp.model,
        collaborative_planning=False,
        background=True,
        stream=True,
        previous_interaction_id=inp.previous_interaction_id,
        thinking_summaries="auto",
        visualization=True,
    )

    images: list[ImageRef] = []
    citations: list[Citation] = []
    on_heartbeat()  # initial heartbeat

    stream = await provider.stream_interaction(handle.id)
    async for ev in stream:
        if ev.kind == "status":
            # Status events aren't persisted as artifacts — workflow
            # uses them only as a hint; the authoritative final status
            # comes from ``get_interaction`` below.
            continue
        await on_event(ev.kind, ev.payload)
        if ev.kind == "image":
            images.append(ImageRef(url=ev.payload["url"], mime_type=ev.payload.get("mime_type", "image/png")))
        elif ev.kind == "citation":
            citations.append(Citation(url=ev.payload["url"], title=ev.payload.get("title", "")))
        on_heartbeat()

    final = await provider.get_interaction(handle.id)
    if final.status != "completed":
        err = final.error or {}
        code = err.get("code", final.status)
        msg = err.get("message", "")
        raise ApplicationError(
            f"execute_research {final.status}: {code}: {msg}",
            code,
            non_retryable=code in _NON_RETRYABLE_CODES,
        )
    report_text = "".join(o.get("text", "") for o in final.outputs if o.get("type") == "text")
    return ExecuteResearchOutput(
        interaction_id=handle.id,
        report_text=report_text,
        images=images,
        citations=citations,
    )


@activity.defn(name="execute_deep_research")
async def execute_deep_research(inp: ExecuteResearchInput) -> dict[str, Any]:
    def _factory(api_key: str):
        return get_provider(provider="gemini", api_key=api_key)

    async def _persist_event(kind: str, payload: dict[str, Any]) -> None:
        # Production persistence — writes an artifact row + posts SSE via
        # the internal API. Phase B lands the call; the endpoint itself
        # is Phase C and will 404 until then, so we swallow 404 here to
        # keep the stream running in pre-Phase-C smoke tests.
        from worker.lib.api_client import post_internal
        try:
            await post_internal(
                f"/internal/research/{_current_run_id_from_context()}/artifacts",
                {"kind": kind, "payload": payload},
            )
        except Exception:
            if activity.in_activity():
                activity.logger.warning("artifact persist failed — endpoint likely missing (Phase C)")

    def _heartbeat() -> None:
        activity.heartbeat()

    out = await _run_execute_research(
        inp,
        provider_factory=_factory,
        fetch_byok_ciphertext=_default_fetch_byok,
        on_event=_persist_event,
        on_heartbeat=_heartbeat,
    )
    return {
        "interaction_id": out.interaction_id,
        "report_text": out.report_text,
        "images": [{"url": i.url, "mime_type": i.mime_type} for i in out.images],
        "citations": [{"url": c.url, "title": c.title} for c in out.citations],
    }


def _current_run_id_from_context() -> str:
    # Populated by the workflow via activity.info().workflow_id.
    return activity.info().workflow_id
```

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_execute_research.py -v 2>&1 | tail -15`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/deep_research/execute_research.py apps/worker/tests/deep_research/test_execute_research.py
git commit -m "feat(worker): execute_deep_research streaming activity"
```

---

## Task 13: `persist_report` activity

**Files:**

- Create: `apps/worker/src/worker/activities/deep_research/persist_report.py`
- Test: `apps/worker/tests/deep_research/test_persist_report.py`

- [ ] **Step 1: Write the failing test**

`apps/worker/tests/deep_research/test_persist_report.py`:

```python
"""``persist_deep_research_report`` — last activity of a run.

Steps:
  1. For each image ref, fetch base64 bytes from Google (stubbed here)
     and upload to MinIO at
     ``research/<workspace_id>/<run_id>/<seq>.<ext>``.
  2. Convert the report markdown → Plate value using the Task 9 helper.
  3. POST /api/internal/notes with the Plate value.
  4. Return the new note id + estimated cost cents.

The test stubs:
  - fetch_image_bytes (async) → fixed bytes
  - MinIO.put_object → records calls
  - post_internal → returns a fake noteId
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

import pytest

from worker.activities.deep_research.persist_report import (
    PersistReportInput,
    PersistReportOutput,
    _run_persist_report,
)


def test_happy_path_uploads_images_and_creates_note():
    uploaded: list[tuple[str, bytes]] = []
    posted: list[dict] = []

    async def _fetch_image(url: str) -> tuple[bytes, str]:
        return b"\x89PNGfake" + url.encode(), "image/png"

    async def _put_object(bucket: str, key: str, data: bytes, content_type: str) -> str:
        assert bucket
        uploaded.append((key, data))
        return f"https://minio.local/{bucket}/{key}"

    async def _post_internal(path: str, body: dict) -> dict:
        posted.append({"path": path, "body": body})
        return {"noteId": "note-xyz"}

    result = asyncio.run(
        _run_persist_report(
            PersistReportInput(
                run_id="run-1",
                workspace_id="ws-1",
                project_id="proj-1",
                user_id="user-1",
                topic="Topic",
                model="deep-research-preview-04-2026",
                billing_path="byok",
                approved_plan="Plan text",
                report_text="# H\n\nBody with ![c1](gs://a.png)",
                images=[{"url": "gs://a.png", "mime_type": "image/png"}],
                citations=[{"url": "https://example.com/s", "title": "S"}],
                duration_minutes=15.0,
            ),
            fetch_image_bytes=_fetch_image,
            put_object=_put_object,
            post_internal=_post_internal,
        )
    )

    assert isinstance(result, PersistReportOutput)
    assert result.note_id == "note-xyz"
    # Cost formula is exercised in Task 7 with exact values; here we only
    # check plumbing — the persist activity correctly passes through a
    # positive integer computed by estimate_cost_usd_cents.
    assert isinstance(result.total_cost_usd_cents, int)
    assert result.total_cost_usd_cents > 0
    # 1 image uploaded
    assert len(uploaded) == 1
    # Internal note post shape
    assert posted[0]["path"] == "/internal/notes"
    body = posted[0]["body"]
    assert body["title"] == "Topic"
    assert body["projectId"] == "proj-1"
    assert body["userId"] == "user-1"
    # Plate value must start with research-meta block
    plate = body["plateValue"]
    assert plate[0]["type"] == "research-meta"
    assert plate[0]["runId"] == "run-1"
    assert plate[0]["model"] == "deep-research-preview-04-2026"
    assert plate[0]["plan"] == "Plan text"
    # Sources populated from citations
    assert plate[0]["sources"][0]["url"] == "https://example.com/s"


def test_image_fetch_failure_does_not_abort(monkeypatch):
    async def _fetch_image(url: str):
        raise RuntimeError("Google transient")

    async def _put_object(*args, **kwargs):
        raise AssertionError("should not be called when fetch failed")

    async def _post_internal(path: str, body: dict) -> dict:
        return {"noteId": "note-xyz"}

    result = asyncio.run(
        _run_persist_report(
            PersistReportInput(
                run_id="run-1",
                workspace_id="ws-1",
                project_id="proj-1",
                user_id="user-1",
                topic="Topic",
                model="deep-research-preview-04-2026",
                billing_path="byok",
                approved_plan="Plan",
                report_text="Body with ![x](gs://a.png)",
                images=[{"url": "gs://a.png", "mime_type": "image/png"}],
                citations=[],
                duration_minutes=10.0,
            ),
            fetch_image_bytes=_fetch_image,
            put_object=_put_object,
            post_internal=_post_internal,
        )
    )
    # Note still created — the image falls back to [missing image: ...] inline.
    assert result.note_id == "note-xyz"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_persist_report.py -v 2>&1 | tail -10`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the activity**

`apps/worker/src/worker/activities/deep_research/persist_report.py`:

```python
"""``persist_deep_research_report`` Temporal activity.

Final activity of a run. Idempotent via the workflow's ``workflowId=runId``
guarantee: if this activity is replayed, ``POST /internal/notes`` uses
the run id as idempotency key so the API can dedupe.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from temporalio import activity

from worker.activities.deep_research.cost import estimate_cost_usd_cents
from worker.activities.deep_research.markdown_plate import markdown_to_plate

_BUCKET = os.environ.get("S3_BUCKET_RESEARCH", "opencairn-research")


@dataclass
class PersistReportInput:
    run_id: str
    workspace_id: str
    project_id: str
    user_id: str
    topic: str
    model: str
    billing_path: str
    approved_plan: str
    report_text: str
    # Plain dicts — the workflow passes these straight through from
    # execute_deep_research's dict output so we avoid nested dataclass
    # round-tripping through the Temporal data converter.
    # image: {"url": str, "mime_type": str}
    # citation: {"url": str, "title": str}
    images: list[dict[str, str]] = field(default_factory=list)
    citations: list[dict[str, str]] = field(default_factory=list)
    duration_minutes: float = 20.0


@dataclass
class PersistReportOutput:
    note_id: str
    total_cost_usd_cents: int


FetchImage = Callable[[str], Awaitable[tuple[bytes, str]]]
PutObject = Callable[[str, str, bytes, str], Awaitable[str]]
PostInternal = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


async def _run_persist_report(
    inp: PersistReportInput,
    *,
    fetch_image_bytes: FetchImage,
    put_object: PutObject,
    post_internal: PostInternal,
) -> PersistReportOutput:
    # 1. Upload images to MinIO. Failures are tolerated — we degrade the
    #    image to a missing-image paragraph rather than aborting.
    image_urls: dict[str, str] = {}
    for seq, img in enumerate(inp.images):
        try:
            data, mime = await fetch_image_bytes(img["url"])
            ext = "png" if mime == "image/png" else ("svg" if mime == "image/svg+xml" else "bin")
            key = f"research/{inp.workspace_id}/{inp.run_id}/{seq}.{ext}"
            url = await put_object(_BUCKET, key, data, mime)
            image_urls[img["url"]] = url
        except Exception:
            # Leave out of image_urls → converter emits "[missing image: ...]"
            pass

    # 2. Markdown → Plate.
    plate_body = markdown_to_plate(
        markdown=inp.report_text,
        image_urls=image_urls,
        citations=[{"title": c.get("title", ""), "url": c["url"]} for c in inp.citations],
    )

    # 3. Prepend research-meta block so it always renders at the top.
    cost_cents = estimate_cost_usd_cents(
        model=inp.model,
        duration_minutes=inp.duration_minutes,
        billing_path=inp.billing_path,  # type: ignore[arg-type]
    )
    meta_block: dict[str, Any] = {
        "type": "research-meta",
        "runId": inp.run_id,
        "model": inp.model,
        "plan": inp.approved_plan,
        "sources": [
            {"title": c.get("title", ""), "url": c["url"], "seq": seq}
            for seq, c in enumerate(inp.citations)
        ],
        "costUsdCents": cost_cents,
        "children": [{"text": ""}],
    }
    plate_value = [meta_block, *plate_body]

    # 4. Create the note via internal API. ``idempotencyKey`` = run_id so a
    #    retried activity doesn't double-write.
    response = await post_internal(
        "/internal/notes",
        {
            "idempotencyKey": inp.run_id,
            "projectId": inp.project_id,
            "workspaceId": inp.workspace_id,
            "userId": inp.user_id,
            "title": inp.topic,
            "plateValue": plate_value,
        },
    )
    return PersistReportOutput(
        note_id=response["noteId"],
        total_cost_usd_cents=cost_cents,
    )


# --- Production wiring below. The unit tests never hit these. ---


async def _production_fetch_image(url: str) -> tuple[bytes, str]:
    # Google Deep Research returns image bytes inline in outputs; the
    # workflow passes us already-base64-decoded bytes via on_event. The
    # activity-to-image mapping is indirect: the workflow records the
    # image payload keyed by URL in research_run_artifacts, and this
    # function reads it back via a thin internal API call.
    from worker.lib.api_client import post_internal
    body = await post_internal("/internal/research/image-bytes", {"url": url})
    import base64
    return base64.b64decode(body["base64"]), body["mimeType"]


async def _production_put_object(
    bucket: str, key: str, data: bytes, content_type: str
) -> str:
    from io import BytesIO
    from worker.lib.s3_client import get_s3_client

    client = get_s3_client()
    client.put_object(
        bucket, key, BytesIO(data), length=len(data), content_type=content_type
    )
    # Assume a signed-url helper exists; fallback to path form.
    return f"/{bucket}/{key}"


async def _production_post_internal(path: str, body: dict[str, Any]) -> dict[str, Any]:
    from worker.lib.api_client import post_internal
    return await post_internal(path, body)


@activity.defn(name="persist_deep_research_report")
async def persist_deep_research_report(inp: PersistReportInput) -> dict[str, Any]:
    out = await _run_persist_report(
        inp,
        fetch_image_bytes=_production_fetch_image,
        put_object=_production_put_object,
        post_internal=_production_post_internal,
    )
    return {"note_id": out.note_id, "total_cost_usd_cents": out.total_cost_usd_cents}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_persist_report.py -v 2>&1 | tail -15`
Expected: `2 passed`. (The cost assertion in the first test asserts only `> 0` — the precise value is covered by Task 7.)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/activities/deep_research/persist_report.py apps/worker/tests/deep_research/test_persist_report.py apps/worker/src/worker/activities/deep_research/__init__.py
git commit -m "feat(worker): persist_deep_research_report activity + subpackage init"
```

---

## Task 14: `DeepResearchWorkflow` happy path

**Files:**

- Create: `apps/worker/src/worker/workflows/deep_research_workflow.py`
- Test: `apps/worker/tests/deep_research/test_workflow.py`

- [ ] **Step 1: Write the failing test (happy path only — subsequent tasks add iteration / cancel / abandon)**

`apps/worker/tests/deep_research/test_workflow.py`:

```python
"""End-to-end DeepResearchWorkflow tests.

Activities are replaced with in-test stubs using ``@activity.defn``; we're
validating orchestration (signals, state transitions, timeouts) not the
activities themselves.
"""
from __future__ import annotations

import uuid

import pytest
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from worker.workflows.deep_research_workflow import (
    DeepResearchInput,
    DeepResearchOutput,
    DeepResearchWorkflow,
)


# Stubs — names must match the real @activity.defn registrations.

@activity.defn(name="create_deep_research_plan")
async def _stub_create_plan(inp) -> dict:
    return {"interaction_id": "int-plan", "plan_text": "Initial plan."}


@activity.defn(name="iterate_deep_research_plan")
async def _stub_iterate_plan(inp) -> dict:
    return {"interaction_id": "int-plan-v2", "plan_text": "Iterated plan."}


@activity.defn(name="execute_deep_research")
async def _stub_execute(inp) -> dict:
    return {
        "interaction_id": "int-exec",
        "report_text": "Done.",
        "images": [],
        "citations": [],
    }


@activity.defn(name="persist_deep_research_report")
async def _stub_persist(inp) -> dict:
    return {"note_id": "note-final", "total_cost_usd_cents": 200}


@pytest.mark.asyncio
async def test_happy_path_approve_immediately():
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[_stub_create_plan, _stub_iterate_plan, _stub_execute, _stub_persist],
        ):
            run_id = str(uuid.uuid4())
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=run_id,
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="byok",
                ),
                id=run_id,
                task_queue=task_queue,
            )
            # Simulate user approve with no edits.
            await handle.signal(DeepResearchWorkflow.approve_plan, "Initial plan.")
            result = await handle.result()

            assert isinstance(result, DeepResearchOutput)
            assert result.note_id == "note-final"
            assert result.status == "completed"
            assert result.total_cost_usd_cents == 200


@pytest.mark.asyncio
async def test_feature_flag_off_fails_fast(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "false")
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[_stub_create_plan, _stub_iterate_plan, _stub_execute, _stub_persist],
        ):
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=str(uuid.uuid4()),
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="byok",
                ),
                id=str(uuid.uuid4()),
                task_queue=task_queue,
            )
            result = await handle.result()
            assert result.status == "failed"
            assert result.error["code"] == "feature_disabled"


@pytest.mark.asyncio
async def test_managed_disabled_flag_rejects_managed(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")
    monkeypatch.setenv("FEATURE_MANAGED_DEEP_RESEARCH", "false")
    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[_stub_create_plan, _stub_iterate_plan, _stub_execute, _stub_persist],
        ):
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=str(uuid.uuid4()),
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="managed",
                ),
                id=str(uuid.uuid4()),
                task_queue=task_queue,
            )
            result = await handle.result()
            assert result.status == "failed"
            assert result.error["code"] == "managed_disabled"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_workflow.py -v 2>&1 | tail -15`
Expected: `ModuleNotFoundError: worker.workflows.deep_research_workflow`.

- [ ] **Step 3: Implement the workflow**

`apps/worker/src/worker/workflows/deep_research_workflow.py`:

```python
"""``DeepResearchWorkflow`` — orchestrates a full Deep Research run.

State machine:
    planning → awaiting_approval → researching → completed
    any → failed (non-retryable activity error)
    any (before researching completes) → cancelled (user signal or 24h abandon)

The workflow is the single source of truth; the DB is a projection. On
replay, signal history is replayed deterministically so iteration
order is preserved.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from worker.activities.deep_research.create_plan import (
        CreatePlanInput,
        CreatePlanOutput,
    )
    from worker.activities.deep_research.iterate_plan import (
        IteratePlanInput,
        IteratePlanOutput,
    )
    from worker.activities.deep_research.execute_research import (
        ExecuteResearchInput,
        ExecuteResearchOutput,
    )
    from worker.activities.deep_research.persist_report import (
        PersistReportInput,
        PersistReportOutput,
    )


_PLAN_TIMEOUT = timedelta(minutes=15)
_EXEC_TIMEOUT = timedelta(minutes=70)
_PERSIST_TIMEOUT = timedelta(minutes=10)
_ABANDON_TIMEOUT = timedelta(hours=24)


@dataclass
class DeepResearchInput:
    run_id: str
    workspace_id: str
    project_id: str
    user_id: str
    topic: str
    model: str
    billing_path: str  # "byok" | "managed"


@dataclass
class DeepResearchOutput:
    status: str  # "completed" | "failed" | "cancelled"
    note_id: str | None = None
    total_cost_usd_cents: int | None = None
    error: dict[str, Any] | None = None


@workflow.defn(name="DeepResearchWorkflow")
class DeepResearchWorkflow:
    def __init__(self) -> None:
        self._approved_plan: str | None = None
        self._feedback_queue: list[tuple[str, str]] = []  # [(feedback_text, turn_id)]
        self._cancelled: bool = False
        self._last_interaction_id: str | None = None

    @workflow.signal
    async def user_feedback(self, text: str, turn_id: str = "") -> None:
        """User asked for plan changes. Queue for the next iterate_plan."""
        self._feedback_queue.append((text, turn_id))

    @workflow.signal
    async def approve_plan(self, final_plan_text: str) -> None:
        """User approved the plan. Research can begin."""
        self._approved_plan = final_plan_text

    @workflow.signal
    async def cancel(self) -> None:
        self._cancelled = True

    @workflow.query
    def status_snapshot(self) -> dict[str, Any]:
        return {
            "approved": self._approved_plan is not None,
            "pending_feedback": len(self._feedback_queue),
            "cancelled": self._cancelled,
            "interaction_id": self._last_interaction_id,
        }

    @workflow.run
    async def run(self, inp: DeepResearchInput) -> DeepResearchOutput:
        if os.environ.get("FEATURE_DEEP_RESEARCH", "false").lower() != "true":
            return DeepResearchOutput(
                status="failed",
                error={"code": "feature_disabled", "message": "FEATURE_DEEP_RESEARCH=false", "retryable": False},
            )
        if inp.billing_path == "managed" and os.environ.get(
            "FEATURE_MANAGED_DEEP_RESEARCH", "false"
        ).lower() != "true":
            return DeepResearchOutput(
                status="failed",
                error={"code": "managed_disabled", "message": "Managed path disabled — use BYOK.", "retryable": False},
            )

        try:
            # 1. Initial plan.
            plan_out: dict[str, str] = await workflow.execute_activity(
                "create_deep_research_plan",
                CreatePlanInput(
                    run_id=inp.run_id,
                    user_id=inp.user_id,
                    topic=inp.topic,
                    model=inp.model,
                    billing_path=inp.billing_path,
                ),
                start_to_close_timeout=_PLAN_TIMEOUT,
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
            self._last_interaction_id = plan_out["interaction_id"]
            current_plan_text = plan_out["plan_text"]

            # 2. Loop on feedback until user approves or abandons.
            while self._approved_plan is None and not self._cancelled:
                reached = await workflow.wait_condition(
                    lambda: self._approved_plan is not None
                    or self._cancelled
                    or bool(self._feedback_queue),
                    timeout=_ABANDON_TIMEOUT,
                )
                if not reached:
                    # 24h abandon.
                    return DeepResearchOutput(
                        status="cancelled",
                        error={"code": "abandoned", "message": "No user action for 24h", "retryable": False},
                    )
                if self._cancelled:
                    break
                if self._approved_plan is not None:
                    break
                # Drain one feedback at a time so the activity call serialises.
                feedback_text, _turn_id = self._feedback_queue.pop(0)
                iter_out: dict[str, str] = await workflow.execute_activity(
                    "iterate_deep_research_plan",
                    IteratePlanInput(
                        run_id=inp.run_id,
                        user_id=inp.user_id,
                        feedback=feedback_text,
                        model=inp.model,
                        billing_path=inp.billing_path,
                        previous_interaction_id=self._last_interaction_id or "",
                    ),
                    start_to_close_timeout=_PLAN_TIMEOUT,
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                self._last_interaction_id = iter_out["interaction_id"]
                current_plan_text = iter_out["plan_text"]

            if self._cancelled:
                return DeepResearchOutput(
                    status="cancelled",
                    error={"code": "user_cancelled", "message": "User cancelled run", "retryable": False},
                )

            approved = self._approved_plan or current_plan_text

            # 3. Execute research (streaming).
            exec_out: dict[str, Any] = await workflow.execute_activity(
                "execute_deep_research",
                ExecuteResearchInput(
                    run_id=inp.run_id,
                    user_id=inp.user_id,
                    approved_plan=approved,
                    model=inp.model,
                    billing_path=inp.billing_path,
                    previous_interaction_id=self._last_interaction_id or "",
                ),
                start_to_close_timeout=_EXEC_TIMEOUT,
                heartbeat_timeout=timedelta(seconds=60),
                retry_policy=RetryPolicy(maximum_attempts=2, non_retryable_error_types=["quota_exceeded", "invalid_byok_key"]),
            )

            # 4. Persist the report.
            persist_out: dict[str, Any] = await workflow.execute_activity(
                "persist_deep_research_report",
                PersistReportInput(
                    run_id=inp.run_id,
                    workspace_id=inp.workspace_id,
                    project_id=inp.project_id,
                    user_id=inp.user_id,
                    topic=inp.topic,
                    model=inp.model,
                    billing_path=inp.billing_path,
                    approved_plan=approved,
                    report_text=exec_out["report_text"],
                    images=exec_out["images"],
                    citations=exec_out["citations"],
                ),
                start_to_close_timeout=_PERSIST_TIMEOUT,
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            return DeepResearchOutput(
                status="completed",
                note_id=persist_out["note_id"],
                total_cost_usd_cents=persist_out["total_cost_usd_cents"],
            )

        except ActivityError as err:
            cause = err.cause
            code = "unknown"
            msg = str(cause)
            if isinstance(cause, ApplicationError):
                code = cause.type or code
                msg = cause.message
            return DeepResearchOutput(
                status="failed",
                error={"code": code, "message": msg, "retryable": False},
            )
```

- [ ] **Step 4: Run tests**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_workflow.py -v 2>&1 | tail -20`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/workflows/deep_research_workflow.py apps/worker/tests/deep_research/test_workflow.py
git commit -m "feat(worker): deepresearchworkflow happy path + feature flag gating"
```

---

## Task 15: Workflow — iteration signal path

**Files:**

- Modify: `apps/worker/tests/deep_research/test_workflow.py` — append the iteration test

- [ ] **Step 1: Append the test**

Add at the end of the existing file:

```python
@pytest.mark.asyncio
async def test_iteration_signal_triggers_iterate_plan(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")
    iterate_calls: list[dict] = []

    @activity.defn(name="iterate_deep_research_plan")
    async def _iter(inp) -> dict:
        iterate_calls.append({"feedback": inp.feedback, "prev": inp.previous_interaction_id})
        return {"interaction_id": f"int-plan-{len(iterate_calls)}", "plan_text": f"v{len(iterate_calls)}"}

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[_stub_create_plan, _iter, _stub_execute, _stub_persist],
        ):
            run_id = str(uuid.uuid4())
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=run_id,
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="byok",
                ),
                id=run_id,
                task_queue=task_queue,
            )
            # 2 rounds of feedback, then approve.
            await handle.signal(DeepResearchWorkflow.user_feedback, "first change", "turn-1")
            await handle.signal(DeepResearchWorkflow.user_feedback, "second change", "turn-2")
            await handle.signal(DeepResearchWorkflow.approve_plan, "Approved text")
            result = await handle.result()
            assert result.status == "completed"
            # iterate_plan called twice, second call chained off first's id
            assert len(iterate_calls) == 2
            assert iterate_calls[0]["prev"] == "int-plan"
            assert iterate_calls[1]["prev"] == "int-plan-1"
```

- [ ] **Step 2: Run test**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_workflow.py::test_iteration_signal_triggers_iterate_plan -v 2>&1 | tail -15`
Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/tests/deep_research/test_workflow.py
git commit -m "test(worker): deep research workflow iteration signal path"
```

---

## Task 16: Workflow — cancel signal path

**Files:**

- Modify: `apps/worker/tests/deep_research/test_workflow.py` — append cancel test

- [ ] **Step 1: Append the test**

```python
@pytest.mark.asyncio
async def test_cancel_signal_before_approve_returns_cancelled(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[_stub_create_plan, _stub_iterate_plan, _stub_execute, _stub_persist],
        ):
            run_id = str(uuid.uuid4())
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=run_id,
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="byok",
                ),
                id=run_id,
                task_queue=task_queue,
            )
            await handle.signal(DeepResearchWorkflow.cancel)
            result = await handle.result()
            assert result.status == "cancelled"
            assert result.error["code"] == "user_cancelled"
```

- [ ] **Step 2: Run test**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_workflow.py::test_cancel_signal_before_approve_returns_cancelled -v 2>&1 | tail -10`
Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/tests/deep_research/test_workflow.py
git commit -m "test(worker): deep research workflow cancel signal path"
```

---

## Task 17: Workflow — 24h abandonment timeout

**Files:**

- Modify: `apps/worker/tests/deep_research/test_workflow.py`

- [ ] **Step 1: Append the test (time-skipping env advances the 24h clock for free)**

```python
@pytest.mark.asyncio
async def test_abandonment_timeout_returns_cancelled(monkeypatch):
    monkeypatch.setenv("FEATURE_DEEP_RESEARCH", "true")

    async with await WorkflowEnvironment.start_time_skipping() as env:
        task_queue = f"dr-{uuid.uuid4().hex[:8]}"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=[DeepResearchWorkflow],
            activities=[_stub_create_plan, _stub_iterate_plan, _stub_execute, _stub_persist],
        ):
            run_id = str(uuid.uuid4())
            handle = await env.client.start_workflow(
                DeepResearchWorkflow.run,
                DeepResearchInput(
                    run_id=run_id,
                    workspace_id="ws-1",
                    project_id="proj-1",
                    user_id="user-1",
                    topic="Topic",
                    model="deep-research-preview-04-2026",
                    billing_path="byok",
                ),
                id=run_id,
                task_queue=task_queue,
            )
            # No signal — time-skipping advances past 24h while we await the result.
            result = await handle.result()
            assert result.status == "cancelled"
            assert result.error["code"] == "abandoned"
```

- [ ] **Step 2: Run test**

Run: `cd apps/worker && uv run pytest tests/deep_research/test_workflow.py::test_abandonment_timeout_returns_cancelled -v 2>&1 | tail -10`
Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/tests/deep_research/test_workflow.py
git commit -m "test(worker): deep research workflow 24h abandonment timeout"
```

---

## Task 18: Register workflow + activities in `temporal_main.py`

**Files:**

- Modify: `apps/worker/src/worker/temporal_main.py`

- [ ] **Step 1: Add imports near the other workflow imports**

Top of file (match the existing pattern of one-import-per-line):

```python
from worker.workflows.deep_research_workflow import DeepResearchWorkflow
from worker.activities.deep_research import (
    create_deep_research_plan,
    iterate_deep_research_plan,
    execute_deep_research,
    persist_deep_research_report,
)
```

- [ ] **Step 2: Extend the `workflows=` list**

Inside `Worker(...)`:

```python
workflows=[
    IngestWorkflow,
    CompilerWorkflow,
    ResearchWorkflow,
    LibrarianWorkflow,
    BatchEmbedWorkflow,
    ImportWorkflow,
    DeepResearchWorkflow,
],
```

- [ ] **Step 3: Extend the `activities=` list**

Append after the last existing entry:

```python
activities=[
    # ... existing ...
    finalize_import_job,
    # Deep Research Phase B.
    create_deep_research_plan,
    iterate_deep_research_plan,
    execute_deep_research,
    persist_deep_research_report,
],
```

- [ ] **Step 4: Guard with feature flag**

Wrap the Deep Research additions so the worker starts cleanly when the flag is off — avoids warnings about activities that never fire:

```python
if os.environ.get("FEATURE_DEEP_RESEARCH", "false").lower() == "true":
    workflows.append(DeepResearchWorkflow)
    activities.extend([
        create_deep_research_plan,
        iterate_deep_research_plan,
        execute_deep_research,
        persist_deep_research_report,
    ])
```

(This requires refactoring the inline list into local `workflows = [...]` / `activities = [...]` before the `Worker(...)` call. Do that refactor as part of this step.)

- [ ] **Step 5: Smoke test the module imports**

Run: `cd apps/worker && uv run python -c "from worker import temporal_main; print('ok')" 2>&1 | tail -5`
Expected: `ok`. Any ImportError here means earlier tasks didn't land their files — fix before proceeding.

- [ ] **Step 6: Run full worker test suite**

Run: `cd apps/worker && uv run pytest -q 2>&1 | tail -15`
Expected: all green. The delta from pre-Phase-B is +`(5 cost + 4 keys + 5 markdown + 3 create + 1 iterate + 2 execute + 2 persist + 5 workflow)` = 27 new passing tests.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/worker/temporal_main.py
git commit -m "feat(worker): register deep research workflow + activities behind feature flag"
```

---

## Task 19: Docs + memory entry

**Files:**

- Modify: `docs/contributing/plans-status.md`
- Modify: `docs/architecture/data-flow.md` (append one subsection)
- Modify: `CLAUDE.md` — add Deep Research to active list

- [ ] **Step 1: Mark Phase B complete in `plans-status.md`**

Find the "### Deep Research integration" block and update:

```markdown
### Deep Research integration (Spec: `2026-04-22-deep-research-integration-design.md`)

- ✅ Phase A — `packages/llm` Interactions wrapper (2026-04-23)
- ✅ Phase B — DB + Temporal workflow (2026-04-23)
- 🟡 Phase C — apps/api routes + SSE (next)
- 🟡 Phase D — apps/web `/research` + Plate research-meta
- 🟡 Phase E — i18n + feature flag + E2E + 출시
```

Also add the Phase B plan as a row in the Phase 1 follow-ups table.

- [ ] **Step 2: Append Deep Research data flow blurb to `docs/architecture/data-flow.md`**

```markdown
## Deep Research

Spec: `docs/superpowers/specs/2026-04-22-deep-research-integration-design.md`.

User types a topic → `DeepResearchWorkflow` starts → Google returns plan →
signal loop on `user_feedback` / `approve_plan` / `cancel` → `execute_deep_research`
streams events into `research_run_artifacts` → `persist_deep_research_report`
uploads images to MinIO and creates a note via `/internal/notes`. Feature
flagged on `FEATURE_DEEP_RESEARCH`; managed PAYG path inert until Plan 9b.
```

- [ ] **Step 3: Update CLAUDE.md**

Change the active / next list to include Deep Research:

```markdown
- 🟡 Active / next: Plan 2C (notifications + share), 2D (chat renderer + block extensions), 2E (tab shell), Plan 5/6/7/8, **Deep Research Phase C (api + sse)**.
```

- [ ] **Step 4: Final smoke — whole worker test suite once more**

Run: `cd apps/worker && uv run pytest -q 2>&1 | tail -5`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add docs/contributing/plans-status.md docs/architecture/data-flow.md CLAUDE.md
git commit -m "docs(docs): deep research phase b complete + data-flow entry"
```

---

## Execution Reminders

- **TDD discipline:** red → green → commit per task. Do NOT refactor until all tasks are green.
- **Activity determinism:** everything non-deterministic lives in activities. Workflow code only orchestrates.
- **Keys never enter workflow state.** If you find yourself passing an API key argument to a workflow method, stop — decrypt inside the activity instead.
- **Idempotency:** `persist_report` must be safe on retry. The `idempotencyKey = run_id` contract is Phase C's to honour in the `/internal/notes` endpoint, but the activity already sends it.
- **Post-feature workflow:** after Task 19 passes, run the `opencairn-post-feature` skill to verify → review → (already) docs → finalise.
