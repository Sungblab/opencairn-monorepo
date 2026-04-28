# Session 6 — Iteration 5 Findings (Final)

**Coverage**: packages/llm + apps/worker infra + schema sweep (remaining) + compose/CI re-check
**Date**: 2026-04-28
**Auditor**: Ralph (Claude)

---

## Critical

_None._

---

## High

_None._

---

## Medium

_None._

---

## Low

_None._

---

## Observations (No Severity)

### S6-011 retrospective — MinIO root password fix already merged

**File**: `docker-compose.yml:189`

S6-011 (High, iteration 1) flagged `MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}`. Current file reads:

```yaml
MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-${S3_SECRET_KEY}}
```

And `S3_SECRET_KEY` has a `:?` guard (line 58):
```yaml
S3_SECRET_KEY: ${S3_SECRET_KEY:?set S3_SECRET_KEY in .env}
```

Commit `a1f6bc6 fix(infra): wire self-hosted app compose path` (in `9b9b6bb` on main) already closed S6-011. MinIO password now inherits from `S3_SECRET_KEY`, which compose requires unconditionally. ✓

---

### packages/llm — clean, no new issues

- `factory.py`: `LLM_PROVIDER`, `LLM_MODEL`, `EMBED_MODEL` all validated at startup; unknown provider raises `ValueError`. ✓
- `gemini.py`: All async SDK calls; `generate()` correctly extracts `response_mime_type` into `GenerateContentConfig`. ✓
- `embed_helper.py`: Batch path guarded by 4 conditions (batch_submit, flag_env, min_items, supports_batch_embed). Fallback to sync on any exception. ✓
- `errors.py`: Three-tier taxonomy (`ProviderRetryableError` / `ProviderFatalError` / `ToolCallingNotSupported`) aligns with Temporal retry policy. ✓

---

### apps/worker Dockerfile — well-structured, no new issues

- `H2Orestart.oxt` download uses `|| echo "WARN: ..."` soft-fail — image builds if GitHub is unreachable; runtime logs failure. Acceptable for non-critical format support.
- `opendataloader-pdf` download similarly soft-fails with a `touch /app/opendataloader-pdf.jar` placeholder. ✓
- `uv sync --no-dev --frozen` correctly pins the lockfile; `packages/llm` is copied first so `[tool.uv.sources]` relative path resolves. ✓
- `start-worker.sh`: unoserver readiness probe uses Python socket check (avoids `nc`/`bash` dependency); exits on timeout with tail of log. ✓

---

### agentRuns.status text column — same axis as S6-004, documented

**File**: `packages/db/src/schema/agent-runs.ts:36`

```ts
// 'running' | 'completed' | 'failed' | 'awaiting_input'
status: text("status").notNull(),
```

No pgEnum, no CHECK constraint. Same pattern as S6-004 (`doc_editor_calls.status`). Comment documents the intended closed set. Not raising a new finding — same axis, same remediation path.

---

### import-jobs.ts userId FK has no onDelete — same axis as S6-003

**File**: `packages/db/src/schema/import-jobs.ts:28`

```ts
userId: text("user_id").references(() => user.id),  // no onDelete
```

Same undocumented-NO-ACTION pattern as S6-003 (`doc_editor_calls.userId`). Whether this is intentional (import audit trail) or oversight is unspecified. Not raising a new finding — identical axis, remediation is the same comment/policy fix.

---

### agentRuns.pageId and parentRunId soft references — intentional, documented

Both columns deliberately omit FK constraints. Comments in the schema file explain:
- `pageId` — owning table evolves across plans; integrity enforced at application layer.
- `parentRunId` — self-reference; skip FK to avoid cascading orphan behavior.

Pattern is documented in-source. ✓

---

### INTEGRATION_TOKEN_ENCRYPTION_KEY soft default — runtime validation OK

**File**: `docker-compose.yml:87`

```yaml
INTEGRATION_TOKEN_ENCRYPTION_KEY: ${INTEGRATION_TOKEN_ENCRYPTION_KEY:-}
```

Empty default is acceptable because `apps/api/src/lib/integration-tokens.ts:getKey()` throws `"INTEGRATION_TOKEN_ENCRYPTION_KEY is not set"` before any encryption attempt. Runtime validation prevents silent fallback to a weak key. ✓

---

### drizzle.config.ts — no HNSW guard confirmed

`packages/db/drizzle.config.ts` is minimal (schema glob + dialect + dbCredentials). No `exclude` or custom hook to guard against drizzle-kit emitting DROP of HNSW/GiST indexes. S6-008 and S6-013 remain open as Low findings. ✓ (status tracked in SUMMARY)

---

### Remaining schema files — FK audit complete

Spot-checked all non-reviewed schema files:
- `user-integrations.ts`: userId → CASCADE ✓
- `research.ts`: workspaceId/projectId/noteId → all explicit policies ✓
- `code-runs.ts`: noteId/workspaceId/userId → CASCADE; runId → SET NULL (for code outputs) ✓
- `stale-alerts.ts`: noteId → CASCADE ✓
- `suggestions.ts`: `suggestionStatusEnum` pgEnum used — pattern-correct ✓
- `learning.ts`: all FK → CASCADE or SET NULL, consistent ✓
- `chat-threads.ts` / `chat-messages.ts`: CASCADE chain correct ✓
- `embedding-batches.ts`: workspaceId → SET NULL ✓

No new FK policy inconsistencies beyond S6-002 and S6-003 (already filed).

---

### AGENTS.md i18n bullet — S6-022 not yet corrected

The i18n bullet in `AGENTS.md` still reads:
```
ESLint `i18next/no-literal-string` + `pnpm --filter @opencairn/web i18n:parity` CI enforced.
```

S6-022 (High) noted this claim is incorrect since CI was removed in PR #136. Current `AGENTS.md` diff (unstaged) updates only the Windows search tooling section; the `CI enforced` claim remains. S6-022 is still open. ✓ (tracked)

---

## Termination Decision

**Consecutive iterations with Critical=0 AND High=0**: **2 / 2 reached.**

- Iteration 4: 0 Critical, 0 High. Count: 1.
- Iteration 5: 0 Critical, 0 High. Count: **2 → TERMINATE.**

Audit complete.
