# Session 3 — Iteration 1 Findings

**Date**: 2026-04-28
**Scope**: Area 1 (IngestWorkflow + activities) + Area 2 (Plan 3b batch embeddings)
**Finding ID prefix**: S3-001 through S3-018

---

## Summary

| Severity | Count | Finding IDs |
|----------|-------|-------------|
| Critical | 0 | — |
| High | 4 | S3-001, S3-002, S3-003, S3-004 |
| Medium | 6 | S3-005, S3-006, S3-007, S3-008, S3-009, S3-010 |
| Low | 7 | S3-012, S3-013, S3-014, S3-015, S3-016, S3-017, S3-018 |
| Info | 1 | S3-011 (verified clean) |

---

## Findings

### S3-001 — `workspace_id` never passed from API routes into IngestInput
**Severity**: High
**File**: `apps/api/src/routes/ingest.ts:182-195` (upload route), `apps/api/src/routes/ingest.ts:232-245` (url route)
**Issue**: Both `/ingest/upload` and `/ingest/url` dispatch `IngestWorkflow` without including `workspace_id` in the `args` object. The `workspaceId` is resolved from `findProjectWorkspace()` and stored in `ingest_jobs` correctly, but is **never forwarded** to the workflow's `IngestInput`. As a result, `IngestInput.workspace_id` is always `None` at runtime.
**Impact**: The `FEATURE_CONTENT_ENRICHMENT` enrichment path uses `inp.workspace_id or ""` (ingest_workflow.py:314) — an empty-string workspace_id is passed to `store_enrichment_artifact`, which will cause a FK violation (or 400 error) on the `note_enrichments.workspace_id NOT NULL` column. Enrichment artifacts are silently lost for every production ingest.
**Fix**: Add `workspaceId` to both `client.workflow.start` args objects in `ingest.ts`, mapped to the camelCase/snake_case boundary matching `IngestInput.workspace_id`.

---

### S3-002 — `ImportWorkflow._run_binary` omits `workspace_id` in child `IngestInput`
**Severity**: High
**File**: `apps/worker/src/worker/workflows/import_workflow.py:235-246`
**Issue**: When `ImportWorkflow` fans out binary nodes (Drive/Notion files) to child `IngestWorkflow`s, it constructs `IngestInput(...)` without setting `workspace_id`. The `ImportInput` has `workspace_id` available (`inp.workspace_id`).
**Impact**: Every file imported through the Drive/Notion import path will have `workspace_id=None`, causing enrichment artifact storage failures on the `note_enrichments.workspace_id NOT NULL` constraint.
**Fix**: Add `workspace_id=inp.workspace_id` to the `IngestInput(...)` constructor at line 236.

---

### S3-003 — `LitImportWorkflow._handle_paper` also omits `workspace_id` in child `IngestInput`
**Severity**: High
**File**: `apps/worker/src/worker/workflows/lit_import_workflow.py:150-157`
**Issue**: Literature import OA-PDF ingest child workflows are constructed without `workspace_id`. `LitImportInput.workspace_id` is available.
**Impact**: Same chain as S3-001/S3-002 — enrichment artifacts never stored for literature imports.
**Fix**: Add `workspace_id=inp.workspace_id` to the `IngestInput(...)` constructor.

---

### S3-004 — `text/plain` and `text/markdown` MIME types fall through to `raise ValueError` in IngestWorkflow
**Severity**: High
**File**: `apps/worker/src/worker/workflows/ingest_workflow.py:225-226`
**Issue**: The API allowlist in `ingest.ts` accepts `text/plain` and `text/markdown` (lines 55-56). However, `IngestWorkflow._run_pipeline` has no branch for these MIME types — they fall through all `if/elif` branches and hit `raise ValueError(f"Unsupported mime_type: {mime}")`. This immediately triggers the quarantine path after 3 retries.
**Impact**: Any user who uploads a `.txt` or `.md` file via the UI will get a workflow failure and quarantine, even though the API accepted the upload. The file is consumed from MinIO upload slot, billed to quota, and quarantined silently. Drive import (which explicitly lists `text/markdown` and `text/plain` in `_SUPPORTED_MIMES`) is also broken.
**Fix**: Add a `text/plain` / `text/markdown` branch before the final `else` clause — read the object from MinIO and use it directly as text content. Set `needs_enhance=False`.

---

### S3-005 — `import os` at workflow-body time breaks Temporal determinism sandbox
**Severity**: Medium
**File**: `apps/worker/src/worker/workflows/ingest_workflow.py:233`
**Issue**: The FEATURE_CONTENT_ENRICHMENT check inside `_run_pipeline` uses `import os as _os` at the point of call, inside the workflow run function (not at module level). Temporal's workflow sandbox applies strict import controls — importing a standard-library module mid-execution inside `workflow.run` is an unsafe pattern that could fail on replay if the sandbox's import isolation changes between SDK versions.
**Impact**: Not currently failing under Temporal Python SDK 1.x but will break under stricter sandbox modes. The value is also read on every replay, making it non-deterministic if the env changes between history replay.
**Fix**: Move the `FEATURE_CONTENT_ENRICHMENT` check to a module-level constant: `_FEATURE_ENRICHMENT = os.environ.get("FEATURE_CONTENT_ENRICHMENT") == "true"` at module top.

---

### S3-006 — No `heartbeat_timeout` on any IngestWorkflow activity
**Severity**: Medium
**File**: `apps/worker/src/worker/workflows/ingest_workflow.py:41, 160-224`
**Issue**: `IngestWorkflow` defines `_RETRY`, `_LONG_TIMEOUT`, `_SHORT_TIMEOUT` but sets **no `heartbeat_timeout`** on any `execute_activity` call. Activities like `parse_pdf` (up to 30 min) call `activity.heartbeat()` at key points but Temporal won't enforce a liveness deadline unless `heartbeat_timeout` is set on the caller side. A hung subprocess will keep the activity slot occupied for the full 30 min.
**Impact**: Worker slots held for up to 30 minutes by stuck activities under load — all worker task queue slots can fill with ghost activities.
**Fix**: Add `heartbeat_timeout=timedelta(minutes=2)` to long-running activities (`parse_pdf`, `transcribe_audio`, `enhance_with_gemini`, `parse_office`, `parse_hwp`) and `heartbeat_timeout=timedelta(minutes=1)` to shorter ones.

---

### S3-007 — OCR scan PDF path has no page-count or byte cap before inlining images
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/pdf_activity.py:138-203`
**Issue**: `_ocr_scan_pdf` renders every page to PNG at 200 DPI and calls `provider.ocr(png_bytes)` for each page inline. There is no hard limit on the number of pages — a 500-page scan PDF will issue 500 sequential Gemini API calls, each inlining a full-resolution PNG.
**Impact**: (1) Memory exhaustion on the worker pod, (2) runaway Gemini API costs, (3) activity timeout if 500 OCR calls can't finish within 30 minutes.
**Fix**: Add an env-configured `MAX_OCR_PAGES` cap (default 100) before the per-page loop, raising `ApplicationError(non_retryable=False)` with a truncation warning.

---

### S3-008 — `enrich_document` and `detect_content_type` call `provider.generate()` directly in Temporal activities
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/enrich_document_activity.py:177-214`; `apps/worker/src/worker/activities/detect_content_type_activity.py:67-108`
**Issue**: Per the anti-pattern checklist, agentic LLM flows must route through `runtime.Agent`. `enrich_document` and `detect_content_type` call `provider.generate()` / `provider.generate_multimodal()` directly. Direct embedding in ingest is OK, but enrichment LLM reasoning may fall under the "agentic flow" classification.
**Impact**: No usage audit trail, no token budget enforcement, no retry/circuit-breaker semantics from the runtime. Cost tracking (Spec B) can't capture enrichment LLM calls.
**Fix**: Needs policy decision — if enrichment is classified as ingest support activity (not agentic), document the exemption explicitly. If classified as agentic, migrate to `runtime.Agent`.

---

### S3-009 — Enrichment LLM calls use workspace-level admin key, not BYOK/user key
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/enrich_document_activity.py:102-109`, `apps/worker/src/worker/activities/detect_content_type_activity.py:79-87`
**Issue**: `_make_provider()` uses `os.environ.get("LLM_API_KEY")` — the worker-wide admin API key. For a BYOK deployment, the enrichment LLM cost hits the admin key, not the BYOK user's key.
**Impact**: Cost attribution is wrong in BYOK/PAYG setups.
**Fix**: Confirm intent against `docs/architecture/billing-routing.md`. If admin key is correct for enrichment (as the routing spec suggests), document explicitly and close.

---

### S3-010 — `purge_embedding_jsonl.py` is an unscheduled manual script — JSONL purge prod gate is incomplete
**Severity**: Medium
**File**: `apps/worker/scripts/purge_embedding_jsonl.py`; `apps/worker/src/worker/maintenance_schedules.py`
**Issue**: The JSONL purge gate (Plan 3b prod gate 4) script exists but is never registered as a Temporal schedule or compose entrypoint. `maintenance_schedules.py` registers Librarian/Curator/Staleness schedules but has no `purge_embedding_jsonl` entry. Self-hosted operators who don't read the ops docs will accumulate JSONL sidecars indefinitely.
**Impact**: Unbounded storage growth in self-hosted MinIO deployments. The Plan 3b "completed prod gate" claim is misleading — the gate exists as a script but is not self-executing.
**Fix**: Add a Temporal schedule for `purge_embedding_jsonl` in `maintenance_schedules.py`, or add a compose service command that runs the script on startup.

---

### S3-011 — `_run_one_chunk` alignment in `batch_submit.py` is correct (verified clean)
**Severity**: Info
**File**: `apps/worker/src/worker/lib/batch_submit.py:206-216`
**Issue**: Pre-audit concern about potential misalignment between empty-text filtered items and sidecar index. After inspection, the `non_empty_idx` alignment loop is correct — sidecar index `i` counts only non-empty items passed to `embed_batch_submit`, and the loop correctly maps back to the full chunk.
**Impact**: None — verified correct.
**Fix**: No change needed.

---

### S3-012 — `submit_batch_embed` display name collides for concurrent workspace submissions
**Severity**: Low
**File**: `apps/worker/src/worker/activities/batch_embed_activities.py:95`
**Issue**: `display_name` uses `workspace_id` + `submitted_at` in seconds — two concurrent runs started in the same second for the same workspace produce the same display name. Gemini display names are non-unique functionally, but ops dashboards show confusing duplicates.
**Fix**: Append first 8 chars of the workflow run_id to the display name.

---

### S3-013 — `cancel_batch_embed` swallows provider cancel failure and may overwrite succeeded state with `timeout`
**Severity**: Low
**File**: `apps/worker/src/worker/activities/batch_embed_activities.py:228-249`
**Issue**: When `provider.embed_batch_cancel` raises, the exception is caught and `update_embedding_batch` still runs with `state=_STATE_TIMEOUT`. If the cancel fails because the batch already succeeded, the `embedding_batches` row is overwritten with `"timeout"`.
**Impact**: `embedding_batches` rows may show incorrect terminal state — succeeded batches relabeled as `"timeout"`.
**Fix**: Check last polled state before writing `_STATE_TIMEOUT`. Only write if state is non-terminal.

---

### S3-014 — JSONL sidecars stored in uploads bucket shared with user content
**Severity**: Low
**File**: `apps/worker/src/worker/lib/s3_client.py:84`; `apps/worker/src/worker/activities/batch_embed_activities.py:89-91`
**Issue**: `upload_jsonl` uses `S3_BUCKET` (default `opencairn-uploads`) — the same bucket that holds user-uploaded files. The `embeddings/batch/` prefix separates logically but shares bucket policy, access keys, and lifecycle rules.
**Impact**: Bucket lifecycle misconfiguration risk. A future ops error could auto-expire user-uploaded PDFs.
**Fix**: Consider `S3_EMBEDDINGS_BUCKET` env var defaulting to same bucket to allow separation when needed. Document the intent.

---

### S3-015 — OCR scan PDF timeout not scaled separately from regular PDF parsing
**Severity**: Low
**File**: `apps/worker/src/worker/workflows/ingest_workflow.py:160-166`
**Issue**: Scan PDF OA routes through the same `parse_pdf` activity with `schedule_to_close_timeout=_LONG_TIMEOUT` (30 min). A 200-page scan at ~2 sec/page = ~400 seconds OCR alone, without page rendering. No env-configurable scan timeout distinct from regular PDF parsing.
**Impact**: Large scan PDFs may legitimately exceed 30 minutes, triggering 3 retry attempts each taking 30 minutes.
**Fix**: Add `SCAN_PDF_TIMEOUT_MINUTES` env var (default 60) selected dynamically when scan is detected.

---

### S3-016 — `_detect_scan` is O(N pages) synchronous in asyncio event loop
**Severity**: Low
**File**: `apps/worker/src/worker/activities/pdf_activity.py:46-60`
**Issue**: `_detect_scan` opens the full PDF in memory via `pymupdf.open()` and iterates all pages synchronously (no `to_thread`). For a 500-page PDF in the asyncio event loop, this blocks the worker's event loop for several seconds, delaying heartbeats on co-located activities.
**Fix**: Wrap in `asyncio.to_thread`: `is_scan = await asyncio.to_thread(_detect_scan, pdf_path)`.

---

### S3-017 — `batch_submit.py` creates a new Temporal Client connection per invocation
**Severity**: Low
**File**: `apps/worker/src/worker/lib/batch_submit.py:127-130`, `239`
**Issue**: `make_batch_submit` closure calls `_get_temporal_client()` on every invocation, which calls `Client.connect(...)` — a new gRPC connection per call.
**Impact**: Connection overhead and potential resource exhaustion under high compile throughput. Currently acceptable due to semaphore-gated compiler invocations.
**Fix**: Cache the client connection as a module-level singleton with a lock. A TODO already exists in the code (line 163).

---

### S3-018 — `LitImportWorkflow._handle_paper` OA-PDF download lacks SSRF check
**Severity**: Low
**File**: `apps/worker/src/worker/workflows/lit_import_workflow.py:138-147`
**Issue**: `fetch_and_upload_oa_pdf` downloads from `oa_pdf_url` originating from external API responses (arXiv, Semantic Scholar, Crossref, Unpaywall) without the SSRF check used in `scrape_web_url`. A crafted URL from a compromised academic API response could target internal endpoints.
**Impact**: Limited in practice (academic APIs are trusted), but a defense-in-depth gap.
**Fix**: Apply `_assert_url_is_public()` from `web_activity.py` inside `fetch_and_upload_oa_pdf`. Extract to shared `worker.lib.ssrf` module.

---

## Anti-Pattern Checklist

| Check | Result | Notes |
|-------|--------|-------|
| No `pgvector(3072)` hardcode — uses `VECTOR_DIM` env customType | **PASS** | `custom-types.ts` uses `parseInt(process.env.VECTOR_DIM ?? "768", 10)` correctly |
| No `EMBED_MODEL` hardcode (env) | **PASS** | `factory.py` reads `os.environ["EMBED_MODEL"]`; activities use `os.environ.get("EMBED_MODEL", "")` |
| No `provider.embed([single_input]) × N` pattern in loops | **PASS** | `embed_helper.py` uses `provider.embed(list(items))` bulk call; per-item fallback only as error-isolation fallback |
| No direct LLM calls in Temporal Activities (agentic flows) | **PARTIAL** | `enrich_document_activity.py` and `detect_content_type_activity.py` call `provider.generate()` directly — see S3-008 for policy discussion |

## Key Observations

1. **Strongest design**: `embed_many()` → `BatchEmbedWorkflow` → JSONL sidecar chain is well-architected. Idempotency via `provider_batch_name` unique index is solid.
2. **Most impactful bug**: S3-001/S3-002/S3-003 form a family — `workspace_id` threaded correctly at API layer but never into `IngestInput`. Dormant until `FEATURE_CONTENT_ENRICHMENT=true`, then all enrichment fails silently across 3 dispatch paths.
3. **Silent data loss**: S3-004 — `text/plain` and `text/markdown` are accepted at API but cause workflow quarantine.
4. **Incomplete prod gate**: S3-010 — JSONL purge script exists but is not self-executing. Plan 3b "completed" claim is misleading.
5. **Scan PDF**: Functionally good but needs page-count cap (S3-007) and asyncio fix (S3-016) before handling large documents safely.
