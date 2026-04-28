# Session 3 — Iteration 4 Findings

**Date**: 2026-04-28
**Scope**: Area 7 (Scan PDF OCR follow-up) + Cross-cutting regression checks
**Finding ID prefix**: S3-060 through S3-072

---

## Summary

| Severity | Count | Finding IDs |
|----------|-------|-------------|
| Critical | 0 | — |
| High | 1 | S3-062 (dup S3-006) |
| Medium | 4 | S3-061, S3-063 (dup S3-001), S3-066, S3-070 |
| Low | 4 | S3-064, S3-069, S3-071, S3-072 |
| Info | 4 | S3-060, S3-065, S3-067, S3-068 |

> **Duplicate confirmations**: S3-062 = S3-006 (no heartbeat_timeout in IngestWorkflow — confirmed from PDF/STT/web angle), S3-063 = S3-001 (workspaceId not in workflow args — confirmed from enrichment regression angle).

---

## Branch / Audit §1.5 Status

### S3-060 — Scan PDF OCR branch is fully merged into main (Info/Positive)
**Severity**: Info
**File**: `apps/worker/src/worker/activities/pdf_activity.py`
**Issue**: Branch `feat/plan-3-scan-pdf-ocr` was fully merged into main. `provider.ocr()`, `supports_ocr()`, `_ocr_scan_pdf()`, and the `is_scan` branch in `parse_pdf` are all present in the current codebase.
**Impact**: None — positive finding.
**Assessment**: Audit §1.5 ("silent empty note for scan PDFs") is CLOSED.

---

## Findings

### S3-061 — Scan PDF OCR retry is non-idempotent: partial OCR costs on retry
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/pdf_activity.py:165-192`
**Issue**: `_ocr_scan_pdf` processes pages in a sequential loop with no checkpoint. If the activity is interrupted mid-loop (transient Gemini 500) and Temporal retries under `_RETRY = RetryPolicy(maximum_attempts=3)`, the entire loop restarts from page 0 — re-calling `provider.ocr()` for all previously processed pages. A transient failure at page 49 of a 50-page doc wastes 49 OCR calls per retry, up to 3 retries = ~147 redundant OCR calls.
**Impact**: Silent cost amplification for BYOK users on large scan PDFs. No data corruption.
**Fix**: After each page OCR call, heartbeat the result (`activity.heartbeat(page_idx, page_text[:100])`). On retry, read `activity.info().heartbeat_details` to skip already-completed pages. Or lower `maximum_attempts=1` for the scan path with clear user-facing error.

---

### S3-062 — Activities call `heartbeat()` but IngestWorkflow sets no `heartbeat_timeout` (duplicate S3-006)
**Severity**: High — Duplicate of S3-006
**File**: `apps/worker/src/worker/workflows/ingest_workflow.py:160-165`, `pdf_activity.py:84`, `stt_activity.py:116-137`, `web_activity.py:209`, `youtube_activity.py:166-187`
**Issue**: `parse_pdf`, `transcribe_audio`, `scrape_web_url`, `ingest_youtube`, `parse_office`, `parse_hwp`, and `enhance_with_gemini` all call `activity.heartbeat()` during execution. `IngestWorkflow._run_pipeline` dispatches all of these with only `schedule_to_close_timeout` — **no `heartbeat_timeout` is set**. Without `heartbeat_timeout`, Temporal ignores heartbeat calls entirely. Compare with `code_workflow.py:89` and Plan 8 workflows which correctly set `heartbeat_timeout` alongside heartbeating activities.
**Impact**: Silent worker crash on large PDF parse holds user's ingest in "running" state for 30 minutes. All heartbeats are no-ops from scheduling perspective.
**Fix**: Add `heartbeat_timeout=timedelta(minutes=2)` to all `execute_activity` calls in `IngestWorkflow._run_pipeline` for heartbeating activities.

---

### S3-063 — `workspaceId` not forwarded to `IngestWorkflow` args (regression confirmation of S3-001)
**Severity**: Medium — Duplicate of S3-001
**File**: `apps/api/src/routes/ingest.ts:182-246`
**Issue**: Regression sweep confirms S3-001 — both `/ingest/upload` and `/ingest/url` resolve `workspaceId` but neither passes it to `IngestWorkflow` args. All enrichment artifacts stored with `workspace_id=""`.
**Assessment**: Same root cause as S3-001, confirmed from regression sweep.

---

### S3-065 — All ingest-path routes correctly apply `requireAuth` (Info/Positive)
**Severity**: Info
**File**: `apps/api/src/routes/ingest.ts:97`, `import.ts:40-434`, `literature.ts:55`, `stream.ts:19`
**Issue**: Verified all ingest-path routes apply `requireAuth`. No ingest-path route bypasses auth middleware.
**Impact**: None — positive finding.

---

### S3-066 — Hardcoded `embed_model="gemini-embedding-001"` in `create_plan.py`
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/deep_research/create_plan.py:127`
**Issue**: `_production_provider_factory` hardcodes `embed_model="gemini-embedding-001"` instead of reading `os.environ.get("EMBED_MODEL", "gemini-embedding-001")`. All other activities (`enhance_activity.py:62`, `image_activity.py:45`, `stt_activity.py:47`, `youtube_activity.py:85`) consistently read `EMBED_MODEL` from env.
**Impact**: In Ollama self-hosted deployments, deep research plan creation uses the wrong model name, causing embedding errors. Breaks `EMBED_MODEL` operator override.
**Fix**: Change to `embed_model=os.environ.get("EMBED_MODEL", "gemini-embedding-001")`.

---

### S3-067 — No hardcoded vector dimensions in `packages/db/src` (Info/Positive)
**Severity**: Info
**Issue**: Confirmed no hardcoded `pgvector(768)`, `vector(1536)`, or `vector(3072)` calls. `VECTOR_DIM` env customType correctly used. The type name `vector3072` is a known cosmetic debt (documented in code comment).

---

### S3-068 — `EMBED_MODEL` consistently env-driven in main ingest activities (Info/Positive)
**Severity**: Info
**Issue**: `enhance`, `image`, `stt`, `youtube` activities all correctly read `EMBED_MODEL` from env. Only `create_plan.py` is the outlier (S3-066).

---

### S3-069 — Known unresolved TODOs in worker ingest/embedding paths
**Severity**: Low
**File**: `apps/worker/src/worker/lib/batch_submit.py:162`, `llm_routing.py:20`, `agents/librarian/agent.py:447`
**Issue**: Three open TODOs:
1. `batch_submit.py:162` — `TODO: wire that in Phase 2`: on `CancelledError` during batch poll, the child `BatchEmbedWorkflow` ID is not persisted for idempotent reconnect on retry. A new workflow is submitted instead, potentially orphaning the prior batch and creating duplicate embeddings.
2. `llm_routing.py:20` — `TODO(Plan 9b)`: BYOK/credits routing stub — all paths use env-default provider. Documented as Plan 9b blocked.
3. `librarian/agent.py:447` — `TODO(Plan 3b Phase 2)`: merged-summary embeddings submitted one-at-a-time instead of batched.
**Impact**: #1 is the most risky: concurrent batch embed workflows may produce duplicate embeddings. #2 is blocked on Plan 9b. #3 is performance debt.
**Fix**: #1 — On activity retry, detect existing child workflow by ID and attach to it. #2 — Plan 9b. #3 — Plan 3b Phase 2 backlog.

---

### S3-070 — `ingest_jobs` table has no `status` column; ingest failures not persisted
**Severity**: Medium
**File**: `packages/db/src/schema/ingest-jobs.ts`, `apps/api/src/routes/internal.ts:221-229`
**Issue**: `ingest_jobs` has no `status` column (no `queued`/`running`/`completed`/`failed` states). `report_ingest_failure` only emits Redis events and logs — does not update any DB row. The UI cannot distinguish job states from DB alone. After Temporal history expiry (7-day default), historical failed jobs show no status. Compare with `import_jobs` which has a proper `status` column.
**Impact**: Ops dashboards and user-facing status UI have no persistence of historical ingest failures. The `internal.ts` comment acknowledges this: "Plan 5 will wire this to a jobs table + admin dashboard."
**Fix**: Add `status text` column to `ingest_jobs`. Update `report_ingest_failure` endpoint to `UPDATE ingest_jobs SET status='failed'`. Add `completed` callback from `create_source_note` activity.

---

### S3-064 — `OPENDATALOADER_JAR` and `COMPLEX_PAGE_THRESHOLD` env vars missing from `.env.example`
**Severity**: Low
**File**: `apps/worker/src/worker/activities/pdf_activity.py:42-43`
**Issue**: Two tunable env vars missing from `.env.example`: `OPENDATALOADER_JAR` (default `/app/opendataloader-pdf.jar`) and `COMPLEX_PAGE_THRESHOLD` (default `3`). Self-hosters running without Docker will silently fail if JAR is not at the Docker-default path.
**Fix**: Add to `.env.example` with comments.

---

### S3-071 — `S3_BUCKET_RESEARCH` missing from `.env.example`
**Severity**: Low
**File**: `apps/worker/src/worker/activities/deep_research/persist_report.py:21`
**Issue**: `persist_report.py` reads `S3_BUCKET_RESEARCH` (default `"opencairn-research"`) for storing deep research report artifacts — a separate MinIO bucket from `S3_BUCKET`. Missing from `.env.example`. Self-hosters enabling `FEATURE_DEEP_RESEARCH=true` won't know to create this bucket; documents will silently fail to persist.
**Fix**: Add `S3_BUCKET_RESEARCH=opencairn-research` to `.env.example` with documentation.

---

### S3-072 — `literature.ts` POST `/import` uses manual body parsing instead of `zValidator`
**Severity**: Low
**File**: `apps/api/src/routes/literature.ts:106-135`
**Issue**: `POST /api/literature/import` manually parses JSON body with hand-written checks instead of using `zValidator` with a Zod schema as all other ingest-path routes do. Functionally correct but inconsistent error response shape and harder to maintain.
**Fix**: Migrate to Zod schema + `zValidator("json", ...)` pattern for consistency.
