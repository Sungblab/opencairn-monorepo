# Plan 3b: Batch Embeddings Integration

> **Status:** 🟡 Planned (2026-04-21). Depends on Plan 3 (ingest, ✅ `c859a29`) + Plan 4 Phase B (Compiler/Research/Librarian, ✅ `7947f9c`) + ADR-007 (embedding model switch, `872cc7c`).
>
> **For agentic workers:** This plan follows the OpenCairn Plan 1/3/4 format — Goals, Non-goals, Architecture decisions, Task breakdown (A/B 단위), Test strategy, Rollout, Open questions. Tasks reference the existing Plan 3 ingest pipeline and Plan 4 Compiler/Librarian agents; do not reintroduce removed patterns (see `docs/contributing/llm-antipatterns.md` §2).

**Goal:** Route document-time embedding traffic through Gemini `asyncBatchEmbedContent` to unlock the 50% batch-tier discount (ADR-007 Tradeoffs table) while keeping the existing `provider.embed()` surface unchanged for real-time consumers (Research / query-time lookups).

**Architecture:** Extend `packages/llm` `LLMProvider` with a **batch** surface (`embed_batch_submit`, `embed_batch_poll`, `embed_batch_fetch`). In `apps/worker` add a child `BatchEmbedWorkflow` invoked by Compiler/Librarian instead of the inline `provider.embed([...])` hot path. Job state persists in a new Drizzle table `embedding_batches`; oversized result payloads land in MinIO/R2 to stay below Temporal's default 2 MiB payload limit. A feature flag `BATCH_EMBED_ENABLED` selects between the new batch path and the legacy single-item `provider.embed` path (fallback for Ollama, dev, and emergency rollback).

**Tech Stack:** `google-genai` (`client.aio.batches.*`, see Open Questions #1), Temporal Python SDK (child workflow + 3 activities), Drizzle ORM (new migration `0008_*`), pgvector (unchanged schema — ADR-007 `VECTOR_DIM=768`), MinIO/R2 (JSONL sidecar storage), `opencairn_llm.providers.base.LLMProvider` (extension points).

---

## 1. Goals & Non-goals

### Goals

1. **Document-time embedding** for Compiler (concept dedupe/upsert) and Librarian (maintenance sweep) goes through Batch API when `BATCH_EMBED_ENABLED=true`, delivering the documented **~50% per-token discount** (standard $0.15/1M → batch $0.075/1M per ADR-007).
2. **Temporal-durable** batch lifecycle: submit → poll → finalize survives worker restarts. Batch state is queryable from the DB (ops / billing).
3. **Provider abstraction preserved.** No direct `genai.Client` in agents or activities; all traffic goes through `packages/llm get_provider()`. Ollama gets a no-op adapter that falls through to single-item `embed()`.
4. **Opt-in per workflow.** Compiler/Librarian accept a `use_batch: bool` input; the feature flag sets the default. Research's query embedding path is untouched.
5. **Cost observability.** Per-batch stats (`requestCount`, `successfulRequestCount`, `failedRequestCount`) land in `embedding_batches` so we can compute realised savings.

### Non-goals

- **Query-time embeddings (Research agent, chat RAG)** stay on synchronous `provider.embed()`. Batch latency (Gemini docs: "up to 24h turnaround") is incompatible with the chat UX SLA.
- **Reranker models.** Orthogonal; covered by future Plan 5/6 work.
- **Non-Gemini provider batching.** Ollama, and any other future provider, ship a no-op batch adapter that silently falls back to per-item `embed()`. Cross-provider batch abstraction is explicitly YAGNI until a second provider has a real batch API.
- **Scheduled/cron batch harvesters** for historical re-embedding. Re-embedding is covered by dev-ops one-shot scripts (see ADR-007 migration notes), not this plan.
- **`batchGenerateContent`** (generation, not embedding). Out of scope; different agents, different retry semantics.

---

## 2. Architecture Decisions

### AD-1 · Batch submission unit

**Options:**

1. **Per-note** (one batch per ingest): Simple, but <20 items/batch on typical notes — wastes batch tier; quota pressure from many tiny batches.
2. **Per-project queue flush**: Accumulate in Redis; flush when N items queued. Adds a new queue dependency; hard to reason about back-pressure.
3. **Time-window + max-size (recommended):** Temporal `BatchEmbedWorkflow` accepts N `EmbedInput` items (≤ `BATCH_EMBED_MAX_ITEMS`, default 2000). Compiler/Librarian call it once per "natural batch" (Compiler: all concepts extracted from one note; Librarian: one maintenance sweep). If >2000, split into multiple sequential batches inside the workflow. No cross-request merging for v0.

**Decision:** Option 3. Each caller owns its own batch; no shared queue. `BATCH_EMBED_MAX_ITEMS=2000` env (Gemini's `InlinedRequests` practical ceiling — see Open Questions #1 for exact quota). A `BATCH_EMBED_MIN_ITEMS=8` threshold: batches below it fall through to synchronous `provider.embed()` because the latency penalty outweighs the per-call savings.

### AD-2 · Temporal workflow structure

**Options:**

1. **Single activity + internal polling**: Activity heartbeats while `await asyncio.sleep()`-polling Gemini. Violates Temporal best practice (a sleeping activity still holds a slot and its heartbeat timeout window conflicts with Gemini's 24h SLA).
2. **Child workflow + 3 activities (recommended):** `BatchEmbedWorkflow` orchestrates `submit_batch` → `poll_batch` (with `workflow.sleep()` between polls) → `fetch_batch_results`. Workflow-level sleep is free; no slot is held.

**Decision:** Option 2. Child workflow signature:

```python
@workflow.defn(name="BatchEmbedWorkflow")
class BatchEmbedWorkflow:
    @workflow.run
    async def run(self, inp: BatchEmbedInput) -> BatchEmbedOutput:
        # returns ordered list of vectors aligned with inp.items
```

Callers (`compile_note`, `librarian_sweep`) invoke via `workflow.execute_child_workflow(...)`. This keeps Compiler's Temporal activity surface and idempotency unchanged — the child either returns vectors (success) or raises (fall back to sync path if retries exhausted).

### AD-3 · JSONL result storage

**Options:**

1. **Inline in Temporal payload**: Temporal's default gRPC payload cap is 2 MiB. 2000 vectors × 768d × 4 bytes ≈ 6 MiB raw, more after JSON encoding — exceeds the cap.
2. **MinIO/R2 JSONL sidecar (recommended):** `submit_batch` writes the request JSONL to `s3://opencairn-uploads/embeddings/batch/{batch_id}/input.jsonl`. `fetch_batch_results` reads Gemini's output file (or inlined responses if small) and writes `output.jsonl` to the same prefix. The workflow returns only the S3 key; the caller reads and parses.
3. **Postgres bytea**: Doable, but bloats the DB with transient blobs and complicates backup.

**Decision:** Option 2, reusing the existing `packages/` MinIO client (`apps/worker/src/worker/lib/s3_client.py` — re-export or extend). Retention: `embeddings/batch/` prefix purged 7 days after `embedding_batches.completed_at` by a lifecycle rule (configure in R2 production; dev MinIO uses a manual cron — documented, not scripted).

### AD-4 · Idempotency & persistence

**Options:**

1. **Reuse `jobs` table**: `jobs` already has `status`, `input`, `output`. But its lifecycle is per-user action (ingest, qa, audio) — mixing low-level provider batches pollutes billing queries.
2. **New `embedding_batches` table (recommended):** Dedicated lifecycle; FK-less to users (a batch is a provider-level artefact, not a user-facing job). Columns: `id`, `workspace_id`, `provider`, `provider_batch_name` (Gemini's `batches/{batchId}`), `state` (enum mirroring Gemini `BatchState`), `input_count`, `success_count`, `failure_count`, `pending_count`, `input_s3_key`, `output_s3_key`, `created_at`, `submitted_at`, `completed_at`, `error`.

**Decision:** Option 2. `workspace_id` is nullable (Librarian sweep is cross-workspace at maintenance-agent scope — see Open Questions #3). Drizzle migration `0008_*`; no raw SQL. Indexed on `(state, created_at)` for ops dashboards and on `provider_batch_name` for poll idempotency.

### AD-5 · Failure & partial-success handling

Gemini `BatchState` enum: `PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED | EXPIRED`. Per-request results have an optional `error` field — `failedRequestCount` > 0 is a partial success.

| State | Action |
|-------|--------|
| `SUCCEEDED` + `failedRequestCount == 0` | Return vectors. Update `embedding_batches.state = 'succeeded'`. |
| `SUCCEEDED` + `failedRequestCount > 0` | Log failed indices with `activity.logger.warning`. Return vectors **with `None` placeholders** at failed indices. Caller decides per call-site: **Compiler** drops the affected concept (matches current `except Exception` behavior in `compiler/agent.py:352`); **Librarian** retries individual items via single `provider.embed()` on next sweep. |
| `FAILED` | Workflow raises `ApplicationError(non_retryable=False)`. Temporal retry policy (max 2) re-submits a new batch. |
| `EXPIRED` | Same as `FAILED` but `non_retryable=True` — stale batch isn't useful; caller falls through to sync path. |
| `CANCELLED` | Only emitted by operator action; workflow raises `ApplicationError(non_retryable=True)`. |
| Poll timeout (> `BATCH_EMBED_MAX_WAIT_HOURS=24`) | Workflow cancels the Gemini batch via `client.aio.batches.cancel`, marks row `state='timeout'`, raises. |

### AD-6 · Fallback / feature flag

`BATCH_EMBED_ENABLED` (env, default `false` until staging validates). Decision tree inside Compiler/Librarian (wrapped in a helper `embed_many()` in `packages/llm`):

```
if not BATCH_EMBED_ENABLED: sync path
if len(items) < BATCH_EMBED_MIN_ITEMS: sync path
if provider.supports_batch_embed is False: sync path  # Ollama
try: child-workflow batch path
except BatchEmbedFailure: fallback to sync path + log metric
```

The fallback is **silent** for availability but emits a Prometheus counter `opencairn_batch_embed_fallback_total{reason}` so we can alert on quota exhaustion, provider outages, etc. Research agent never sees this helper — it keeps calling `provider.embed()` directly.

---

## 3. Task Breakdown

Follow Plan 1 A/B convention: **A-tasks** are foundation (library + schema), **B-tasks** are integration (worker + agents + activities). Each task has an **Acceptance Criteria** block in the same spirit as Plan 3 / Plan 4.

### A1 — `packages/llm` batch embedding surface

**Files:**
- Modify: `packages/llm/src/llm/base.py` (extend `LLMProvider`)
- Modify: `packages/llm/src/llm/gemini.py` (implement)
- Modify: `packages/llm/src/llm/ollama.py` (no-op override returning `None` for `supports_batch_embed`)
- Create: `packages/llm/src/llm/batch_types.py` (dataclasses below)
- Test: `packages/llm/tests/test_gemini_batch.py`

**New dataclasses** (`batch_types.py`):

```python
@dataclass
class BatchEmbedHandle:
    provider_batch_name: str   # e.g. "batches/abc123"
    submitted_at: float
    input_count: int

@dataclass
class BatchEmbedPoll:
    state: str                  # mirrors Gemini BatchState enum value
    request_count: int
    successful_request_count: int
    failed_request_count: int
    pending_request_count: int
    done: bool                  # true when state in {SUCCEEDED, FAILED, CANCELLED, EXPIRED}

@dataclass
class BatchEmbedResult:
    vectors: list[list[float] | None]   # aligned with submit inputs; None = failed item
    errors: list[str | None]            # per-item error messages
```

**New `LLMProvider` methods** (`base.py`):

```python
@property
def supports_batch_embed(self) -> bool:
    return False  # Ollama + unknown providers

async def embed_batch_submit(self, inputs: list[EmbedInput]) -> BatchEmbedHandle:
    raise NotImplementedError

async def embed_batch_poll(self, handle: BatchEmbedHandle) -> BatchEmbedPoll:
    raise NotImplementedError

async def embed_batch_fetch(self, handle: BatchEmbedHandle) -> BatchEmbedResult:
    # Must only be called after poll reports done=True and state=SUCCEEDED.
    raise NotImplementedError

async def embed_batch_cancel(self, handle: BatchEmbedHandle) -> None:
    raise NotImplementedError
```

**Gemini implementation notes** (`gemini.py`):
- Uses `self._client.aio.batches.create(...)` for submit, `.get(name=...)` for poll, `.cancel(name=...)` for cancel. Exact method names pending SDK verification (Open Questions #1); if `client.aio.batches` is missing, fall back to direct REST via `httpx` against `https://generativelanguage.googleapis.com/v1beta/models/{model}:asyncBatchEmbedContent`.
- Forwards `VECTOR_DIM` → `outputDimensionality` per request (same as single-call `embed`).
- `taskType = inputs[0].task` per request (same default `retrieval_document` as single-call; Gemini Batch API allows per-item override via `EmbedContentRequest.taskType`).
- Request `displayName`: `opencairn-{workspace_id|global}-{ts}` for Gemini console debuggability.

**Acceptance criteria:**
- `supports_batch_embed` returns `True` on `GeminiProvider`, `False` on `OllamaProvider`.
- Submitting 3 items returns a `BatchEmbedHandle` with a non-empty `provider_batch_name`.
- Poll on a known-complete batch returns `done=True`.
- Fetch returns `len(vectors) == input_count`, with `None` entries where the mock response marks an error.
- Ollama's `embed_batch_submit` raises a typed `BatchNotSupported` error (caught upstream to force sync fallback).
- Existing `embed()` behavior unchanged; `pytest packages/llm/tests/` passes 29+N tests.

### A2 — `packages/db` `embedding_batches` table + migration

**Files:**
- Create: `packages/db/src/schema/embedding-batches.ts`
- Modify: `packages/db/src/schema/enums.ts` (add `embeddingBatchStateEnum`)
- Modify: `packages/db/src/index.ts` (export new table)
- Generate: `packages/db/drizzle/0008_<drizzle-chosen-name>.sql`

**Drizzle schema** (example — Drizzle only; no raw SQL):

```ts
import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { embeddingBatchStateEnum } from "./enums";

export const embeddingBatches = pgTable(
  "embedding_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable: Librarian cross-workspace sweeps set this NULL.
    // See Plan 3b Open Questions #3 for retention policy tradeoffs.
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),                   // "gemini" | future
    providerBatchName: text("provider_batch_name").notNull().unique(),
    state: embeddingBatchStateEnum("state").notNull().default("pending"),
    inputCount: integer("input_count").notNull(),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    pendingCount: integer("pending_count").notNull().default(0),
    inputS3Key: text("input_s3_key").notNull(),
    outputS3Key: text("output_s3_key"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    submittedAt: timestamp("submitted_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("embedding_batches_state_created_idx").on(t.state, t.createdAt),
  ]
);
```

**Enum values** (`enums.ts`): `pending | running | succeeded | failed | cancelled | expired | timeout`.

**Acceptance criteria:**
- `pnpm db:generate` produces `0008_*.sql` cleanly.
- `pnpm db:migrate` applies against a fresh dev DB + against a DB with 0007 applied.
- `pnpm --filter @opencairn/db test` (if present) and `tsc --noEmit` pass.
- No raw SQL strings inside the schema file (Drizzle types enforce this).

### A3 — Provider-facing helper `embed_many()` in `packages/llm`

**Files:**
- Modify: `packages/llm/src/llm/__init__.py` (export `embed_many`)
- Create: `packages/llm/src/llm/embed_helper.py`

Single function agents call instead of `provider.embed()`:

```python
async def embed_many(
    provider: LLMProvider,
    inputs: list[EmbedInput],
    *,
    workspace_id: str | None,
    batch_submit: Callable | None = None,   # injected by worker; None = sync only
) -> list[list[float] | None]:
    """
    - If len(inputs) < BATCH_EMBED_MIN_ITEMS or feature flag off or provider
      doesn't support batch → provider.embed(inputs).
    - Else → batch_submit(inputs, workspace_id=...) which starts a Temporal
      child workflow and returns the aligned result list.
    The provider is never imported by this module at type level to keep
    packages/llm agent-runtime-free.
    """
```

`batch_submit` is a callback because `packages/llm` must not import Temporal (boundary enforced today for LangGraph — see `llm-antipatterns.md` §4; same principle applies). Agents in `apps/worker` inject it; `packages/llm` stays orchestration-free.

**Acceptance criteria:**
- Called with `batch_submit=None` always takes the sync path.
- Called with `len(inputs) < BATCH_EMBED_MIN_ITEMS` always takes the sync path.
- Called with `BATCH_EMBED_ENABLED=false` always takes the sync path (env check inside helper).
- `BatchNotSupported` from provider → sync fallback + logs WARNING.

### B1 — `apps/worker` `BatchEmbedWorkflow` + activities

**Files:**
- Create: `apps/worker/src/worker/workflows/batch_embed_workflow.py`
- Create: `apps/worker/src/worker/activities/batch_embed_activities.py` (3 activities)
- Modify: `apps/worker/src/worker/main.py` (register workflow + activities)

**Workflow skeleton:**

```python
@dataclass
class BatchEmbedInput:
    items: list[dict]          # EmbedInput-shaped dicts (workflow-safe, no bytes)
    workspace_id: str | None
    task_type: str = "retrieval_document"

@dataclass
class BatchEmbedOutput:
    vectors: list[list[float] | None]
    batch_id: str               # embedding_batches.id

@workflow.defn(name="BatchEmbedWorkflow")
class BatchEmbedWorkflow:
    @workflow.run
    async def run(self, inp: BatchEmbedInput) -> BatchEmbedOutput:
        handle = await workflow.execute_activity(
            submit_batch_embed,
            inp,
            schedule_to_close_timeout=timedelta(minutes=10),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )
        # Poll with exponential backoff; initial 60s, cap at 30min, max 24h total.
        wait = 60
        total = 0
        while total < BATCH_EMBED_MAX_WAIT_SECONDS:
            await workflow.sleep(timedelta(seconds=wait))
            total += wait
            poll = await workflow.execute_activity(
                poll_batch_embed, handle,
                schedule_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            if poll["done"]:
                break
            wait = min(wait * 2, 1800)  # 60 → 120 → 240 → ... → 1800s cap
        else:
            # timeout → cancel + raise
            await workflow.execute_activity(cancel_batch_embed, handle, ...)
            raise ApplicationError("batch embed timed out", non_retryable=True)
        return await workflow.execute_activity(fetch_batch_embed_results, handle, ...)
```

**Activities** (each uses `from llm import get_provider`; no direct `genai` import):

1. `submit_batch_embed(inp) -> BatchEmbedHandle`: Writes input JSONL to MinIO, calls `provider.embed_batch_submit`, inserts `embedding_batches` row via internal API (or direct DB via existing `AgentApiClient` — choose same pattern as `compile_note` uses for concept upsert).
2. `poll_batch_embed(handle) -> dict`: Calls `provider.embed_batch_poll`, updates `embedding_batches.state / *_count`.
3. `fetch_batch_embed_results(handle) -> BatchEmbedOutput`: Calls `provider.embed_batch_fetch`, writes output JSONL to MinIO, stamps `completed_at`, returns vectors.

**Acceptance criteria:**
- Worker starts with the new workflow + activities registered (`docker compose --profile worker up`).
- Temporal UI shows `BatchEmbedWorkflow` state transitions.
- A 10-item test batch end-to-end: submit → 1 poll → succeed → fetch completes in <2 min against dev Gemini API.
- Worker restart mid-poll resumes without duplicate submission (Temporal replay guarantees idempotency on the workflow side; `provider_batch_name` uniqueness in DB catches duplicate inserts as a defense-in-depth check).

### B2 — Compiler + Librarian integration

**Files:**
- Modify: `apps/worker/src/worker/agents/compiler/agent.py` (replace `provider.embed([...])` call at line ~350 with `embed_many(...)` helper)
- Modify: `apps/worker/src/worker/agents/librarian/agent.py` (replace `provider.embed(...)` at line ~440)
- Modify: `apps/worker/src/worker/activities/compiler_activity.py` (inject `batch_submit` callback that calls `workflow.execute_child_workflow("BatchEmbedWorkflow", ...)` — **note:** this requires the agent to be called from inside a workflow; if called from an activity, pass a different callback that spawns the child via Temporal Client. See Open Questions #2.)
- Modify: `apps/worker/src/worker/activities/librarian_activity.py` (same pattern)
- **Untouched:** `apps/worker/src/worker/agents/research/agent.py` (Research is query-time — see §1 Non-goals). Verify tests still pass.

The Compiler's current per-concept embed flow changes from N × sync call → 1 × batch submit before the loop. Sketch:

```python
# Before (compiler/agent.py around L348-L354)
for candidate in candidates:
    vecs = await self.provider.embed([EmbedInput(text=embed_text)])
    embedding = vecs[0]
    ...

# After
texts = [c["name"] if not c["description"] else f"{c['name']} — {c['description']}" for c in candidates]
vectors = await embed_many(
    self.provider,
    [EmbedInput(text=t) for t in texts],
    workspace_id=ctx.workspace_id,
    batch_submit=self._batch_submit,    # injected by compile_note activity
)
for candidate, embedding in zip(candidates, vectors):
    if embedding is None:
        continue   # matches existing "embedding failed → drop" behavior
    ...
```

**Acceptance criteria:**
- With `BATCH_EMBED_ENABLED=false` the 95/95 worker pytest (Plan 4 Phase B baseline) still passes.
- With `BATCH_EMBED_ENABLED=true` and the Gemini adapter mocked, Compiler issues **one** batch call per note instead of N.
- Librarian sweep over ≥ `BATCH_EMBED_MIN_ITEMS` concepts uses batch; below that falls through to sync.
- Research agent behaviour is bit-for-bit identical — no regression in its contract tests.

### B3 — Tests

**Files:**
- Create: `packages/llm/tests/test_gemini_batch.py` (unit: submit/poll/fetch with mocked `client.aio.batches`)
- Create: `apps/worker/tests/workflows/test_batch_embed_workflow.py` (Temporal replay test — see Plan 3's replay test pattern in `apps/worker/tests/workflows/test_ingest_workflow.py`)
- Create: `apps/worker/tests/activities/test_batch_embed_activities.py`
- Modify: `apps/worker/tests/agents/test_compiler_agent.py` (parametrize over flag on/off)

**Unit coverage points:**
- JSONL round-trip (submit → fetch): input order preserved in output vectors.
- Partial failure: mock Gemini returns `failedRequestCount=2` → helper returns `None` at those indices and rest succeed.
- BatchState=FAILED → workflow raises retryable `ApplicationError`.
- BatchState=EXPIRED → workflow raises non-retryable.
- `supports_batch_embed=False` (Ollama) → helper takes sync path.
- Batch size below `BATCH_EMBED_MIN_ITEMS` → sync path.

**Replay test** (new `*.wfhistory.json` fixture captured from a dev run): guarantees determinism when we add/remove activities or change polling cadence.

### B4 — Docs, migration, observability

**Files:**
- Modify: `docs/architecture/data-flow.md` (update §1 [5] to describe batch path + feature flag)
- Modify: `docs/architecture/adr/007-embedding-model-switch.md` (crosslink to Plan 3b, strike the "Batch API 전환은 별도 Plan" forward-reference)
- Create: `docs/architecture/adr/008-batch-embedding-workflow.md` (short ADR documenting the child-workflow + MinIO sidecar choice)
- Modify: `docs/contributing/llm-antipatterns.md` (add: "❌ `provider.embed()` in a loop inside an agent → ✅ `embed_many()` with injected `batch_submit` when `len >= BATCH_EMBED_MIN_ITEMS`")
- Modify: `docs/contributing/plans-status.md` (add Plan 3b row — done in this plan's delivery)
- Modify: `.env.example` (add `BATCH_EMBED_ENABLED`, `BATCH_EMBED_MAX_ITEMS`, `BATCH_EMBED_MIN_ITEMS`, `BATCH_EMBED_MAX_WAIT_SECONDS`)

**Observability (metrics exported via existing Prometheus/OTEL wiring, no new backend):**
- `opencairn_batch_embed_submit_total{provider,workspace}`
- `opencairn_batch_embed_duration_seconds` histogram (submit → completed_at)
- `opencairn_batch_embed_fallback_total{reason}` (reason ∈ `flag_off|too_small|provider_unsupported|batch_failed|batch_expired`)
- `opencairn_batch_embed_items_total{state}` (state ∈ `success|failed|pending`)

---

## 4. Test Strategy

1. **Unit** (`pytest packages/llm/tests/` + `pytest apps/worker/tests/`): mock `client.aio.batches.create/get/cancel`. Cover all BatchState branches; verify JSONL ordering and None-on-error placeholders.
2. **Workflow replay** (`pytest apps/worker/tests/workflows/`): capture one successful `BatchEmbedWorkflow` history in dev, commit as JSON fixture, run replay on CI to lock determinism.
3. **Integration — dev Gemini API (manual, not CI):** submit a small real batch (≤ 10 items), assert vectors are 768-d floats, assert cost difference on the API console matches the $0.075/1M expectation (sanity check — no programmatic price assertion).
4. **Regression:** `pnpm -r test` (where applicable) + `pytest apps/worker/tests/` keeps 95/95 Plan 4 Phase B pass count; add new tests on top (goal ≥ 110/110 after Plan 3b).
5. **Failure injection:** Gemini returns 429 during submit → activity retries per `RetryPolicy`; poll returns 5xx → `poll_batch_embed` retries; final EXPIRED → workflow raises → caller falls back to sync and logs `opencairn_batch_embed_fallback_total{reason="batch_expired"}`.

---

## 5. Rollout & Monitoring

**Phase 0 — Ship disabled:** Merge with `BATCH_EMBED_ENABLED=false`. No traffic moves. CI green proves no regressions.

**Phase 1 — Dev ON (1 week):** Flip in dev `.env`. Run a realistic Compiler workload (10+ notes). Collect:
- submit→completed p50 / p95 (target p50 ≤ 10 min on small batches; Gemini's documented SLA is "up to 24h" but typical is minutes).
- `fallback_total` rate should be ~0 except `too_small` (expected for single-concept notes).
- Manual Gemini console check: batched token count matches `requestCount`.

**Phase 2 — Staging 100% (1 week):** Enable on the staging deployment. Confirm billing dashboard shows actual $0.075/1M on the batched subset.

**Phase 3 — Production ramp:** Start at 100% (feature flag is already binary + the fallback is silent). The binary rollout is safe here because the sync path remains fully functional as an automatic fallback; there's no user-visible behaviour change, only cost. Keep the flag for 2 more weeks; delete env + dead code after.

**Kill switch:** `BATCH_EMBED_ENABLED=false` + `docker compose restart worker`. In-flight batches continue to completion (workflow doesn't read the flag mid-run); new calls take sync path immediately. No data migration needed.

**Cost verification:** Compute realised savings from `embedding_batches.input_count * token_cost` (we already log input token counts via existing TokenCounterHook). Expected monthly savings memo lands in a retro doc 30 days post-rollout.

---

## 6. Open Questions

These are not blockers — each has a default behaviour listed. Resolve opportunistically; do not stall plan execution.

1. **SDK surface for async batch embedding.** `references/Gemini_API_docs/06-embeddings/Embeddings.md:245-293` and `08-batch/Batch API.md:53-101` document the **REST** `models.asyncBatchEmbedContent` endpoint and `batches.get/list/cancel/delete` methods, but the local docs don't show the concrete `google-genai` Python SDK method names. The pattern from other async SDK surfaces (`client.aio.models.generate_content`, `client.aio.caches.create`) strongly suggests `client.aio.batches.create / get / cancel / list / delete`, but this must be verified against the installed `google-genai` version (currently unpinned in `packages/llm/pyproject.toml`). **Default behaviour if absent:** fall through to direct `httpx` REST calls against the documented endpoints, using the same API key. Pin a minimum `google-genai` version in `pyproject.toml` once verified.

2. **Child-workflow invocation path for the agent callback.** Compiler is instantiated inside the `compile_note` Temporal activity (`compiler_activity.py`), not inside a workflow. From an activity, you cannot call `workflow.execute_child_workflow` directly. Options: (a) route batch submission through a Temporal **Client** that starts a sibling workflow and awaits its completion via `handle.result()`, (b) restructure so the batch step runs at the workflow layer before the agent activity and results are passed in, (c) have the activity start the batch workflow and poll via the client from within the activity (spends activity time). **Default:** option (a) — simplest; the activity already has API credentials and creating a `temporalio.client.Client` is cheap. Revisit if this interacts badly with heartbeat timeouts.

3. **`embedding_batches.workspace_id` FK retention policy.** Set `ON DELETE SET NULL` so deleting a workspace doesn't cascade-delete historical batch rows (useful for billing audits). But if the workspace's Gemini-associated data is truly gone, should the row remain? **Default:** keep the row, null the FK; document that `embedding_batches` rows may outlive their workspace. If GDPR/export needs something stricter, address in Plan 9b (billing/export).

4. **Partial failure retry granularity.** On `failedRequestCount > 0`, should the caller retry only the failed items in a new batch, or accept the loss (current sync path's `except Exception: drop concept` semantics)? **Default:** match current sync behaviour — drop in Compiler, retry-in-next-sweep in Librarian. Per-item retry adds a new small-batch (often below `BATCH_EMBED_MIN_ITEMS`) which defeats the cost motive. Revisit if the dev-phase error rate is non-trivial.

5. **Batch latency SLA tolerance.** Gemini's batch SLA is "up to 24h"; realistic observed latency is minutes–hours. For ingest UX: "concept index available" being delayed N hours means new notes don't show up in hybrid-search until then. **Default:** document clearly; add a UI hint ("indexing in progress — full search available within ~1h") in a follow-up to Plan 2/5. If the Phase-1 dev observation shows p95 > 2h, we should consider gating batch-only to Librarian (slower path is fine there) and keeping Compiler on sync.

6. **Security (AES-256 BYOK / CORS).** No new impact: BYOK keys stay decrypted in-process for the batch call (same lifetime as current sync `provider.embed`); MinIO keys for the JSONL sidecar reuse existing bucket credentials; CORS unchanged (no new public endpoints — all new workflows are internal). Called out per plan template requirement but no further action needed.

---

## 7. References

- ADR-007 (`docs/architecture/adr/007-embedding-model-switch.md`) — pricing table with batch-tier $0.075/1M source of truth.
- Gemini API local docs — `references/Gemini_API_docs/06-embeddings/Embeddings.md:245-293` (asyncBatchEmbedContent), `08-batch/Batch API.md` (full batch lifecycle: get/list/cancel/delete, BatchState enum, InlinedRequest/Response schemas).
- Plan 3 (`docs/superpowers/plans/2026-04-09-plan-3-ingest-pipeline.md`) — ingest workflow scaffold this plan slots into.
- Plan 4 (`docs/superpowers/plans/2026-04-09-plan-4-agent-core.md`) — Compiler / Librarian agents whose embed paths we swap.
- `docs/contributing/llm-antipatterns.md` §2, §4 — `get_provider()` mandate and runtime boundary rules.
- `docs/architecture/data-flow.md` §1 [5] — current position of the embedding step in the ingest pipeline.
