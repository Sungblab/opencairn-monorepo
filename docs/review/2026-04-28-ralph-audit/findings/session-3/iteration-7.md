# Session 3 — Iteration 7 Findings

**Date**: 2026-04-28
**Scope**: Self-hosted compose verification, workflow signal handlers, note-assets, IngestWorkflow dispatch coverage, MIME gap completeness
**Finding ID prefix**: S3-098 through S3-106

---

## Summary

| Severity | Count | New Unique | Finding IDs |
|----------|-------|-----------|-------------|
| High | 1 | 0 new unique | S3-104 (dup/confirmation of S3-004) |
| Medium | 5 | 5 new | S3-098, S3-099, S3-101, S3-102, S3-105 |
| Low | 2 | 2 new | S3-100, S3-106 |
| Info | 1 | 1 | S3-103 |

> **Key result**: 0 new unique Critical/High findings. Consecutive zero-High streak: **1/2**.

---

## Key Findings

### S3-098 — `api` Service Missing Healthcheck Causes `web` Deadlock on `docker compose up` (Showstopper)
**Severity**: Medium (operationally critical for current branch)
**File**: `docker-compose.yml:146-148`
**Issue**: The `web` service declares `depends_on: api: condition: service_healthy`, but the `api` service has no `healthcheck` defined. Docker Compose treats a service with no healthcheck as permanently in state `starting` (never `healthy`). On the `codex/self-hosting-compose-stabilization` branch (whose explicit goal is to stabilize self-hosted compose), `docker compose --profile app up -d` results in the `web` container stuck in `Waiting` state indefinitely. The `api` container starts and listens fine, but `web` never launches.
**Impact**: The self-hosted `app` profile is completely non-functional — a showstopper regression on this specific branch.
**Fix**: Add a healthcheck to the `api` service (a `/health` endpoint already exists at `apps/api/src/routes/health.ts`):
```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://localhost:4000/health || exit 1"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 15s
```

---

### S3-099 — Redis No Auth in Self-Hosted Compose (Additional Instance of S3-052)
**Severity**: Medium — Extends S3-052
**File**: `docker-compose.yml:22-27`
**Issue**: The `redis` service in the single `docker-compose.yml` (which IS the self-hosted compose) has no `requirepass` or ACL. Port 6379 is published to all interfaces. This is the same issue as S3-052 but confirmed from the self-hosted compose angle.
**Fix**: Same as S3-052.

---

### S3-101 — `ImportWorkflow._run_binary` Missing `workspace_id` in IngestInput (5th Dispatch Site)
**Severity**: Medium — New instance of S3-001/S3-002 class
**File**: `apps/worker/src/worker/workflows/import_workflow.py:237-244`
**Issue**: The Drive/Notion import pipeline fans out to child `IngestWorkflow` instances without passing `workspace_id`. `ImportInput.workspace_id` is in scope but unused. This is the 5th total dispatch site for the S3-001 root cause.
**Impact**: Content-enrichment artifacts for Drive/Notion imports stored with `workspace_id=""`.
**Fix**: Pass `workspace_id=inp.workspace_id` to the `IngestInput` constructor at line 237.

---

### S3-102 — `LitImportWorkflow._handle_paper` Missing `workspace_id` in IngestInput (Confirmed)
**Severity**: Medium — Continuation of S3-003
**File**: `apps/worker/src/worker/workflows/lit_import_workflow.py:150-158`
**Issue**: Same as S3-003, additionally confirmed with exact line numbers. `LitImportInput.workspace_id` is available at line 33.
**Fix**: Pass `workspace_id=inp.workspace_id` to `IngestInput` at line 150.

---

### S3-104 — `text/plain`/`text/markdown` Accepted by API But Not Handled in IngestWorkflow (Confirmation of S3-004)
**Severity**: High — Duplicate/confirmation of S3-004
**File**: `apps/api/src/routes/ingest.ts:55-56` vs `apps/worker/src/worker/workflows/ingest_workflow.py:225-226`
**Issue**: Confirmed S3-004 — these are the ONLY MIME types that are in the API allowlist but missing from `IngestWorkflow`. No additional MIME gaps found for the API upload path.
**Fix**: Same as S3-004.

---

### S3-105 — `text/csv`, `text/plain`, `text/markdown` from Drive/Notion Import Also Hit `raise ValueError`
**Severity**: Medium — Broader scope discovery of S3-004 class
**File**: `apps/worker/src/worker/activities/drive_activities.py:40-55`, `apps/worker/src/worker/activities/notion_activities.py:118-119`
**Issue**: Drive import's `_SUPPORTED_MIMES` includes `text/csv`, `text/markdown`, and `text/plain`. Notion import maps `.csv`, `.txt`, `.md` attachments to these MIME types. All route through child `IngestWorkflow` runs, all crash with `ValueError` because `_run_pipeline` has no handler.
**Impact**: Any Drive or Notion import containing CSV spreadsheets, plain-text, or Markdown attachments silently fails those files.
**Fix**: Add `text/plain`, `text/markdown`, and `text/csv` branches in `IngestWorkflow._run_pipeline`. Or filter these MIME types from `_SUPPORTED_MIMES` if plain-text ingestion is not yet intended.

---

### S3-100 — MinIO Console Port 9001 Exposed (Additional Instance of S3-074)
**Severity**: Low — Additional instance of S3-074
**File**: `docker-compose.yml:184-186`
**Fix**: Same as S3-074 — bind to `127.0.0.1:9001:9001`.

---

### S3-103 — S3-001 Root Cause: All 5 Dispatch Sites Confirmed (Info)
**Severity**: Info
**Issue**: Total `IngestWorkflow` dispatch sites missing `workspace_id`:
1. `apps/api/src/routes/ingest.ts:182` (upload) — S3-001
2. `apps/api/src/routes/ingest.ts:232` (url) — S3-001
3. `apps/worker/src/worker/workflows/import_workflow.py:237` — S3-002/S3-101
4. `apps/worker/src/worker/workflows/lit_import_workflow.py:150` — S3-003/S3-102
5. (No additional dispatch sites found)

---

### S3-106 — `note-assets.ts` Reflects MinIO Content-Type Without Sanitization Gate
**Severity**: Low
**File**: `apps/api/src/routes/note-assets.ts:61`
**Issue**: The file-streaming route reflects the `Content-Type` stored in MinIO verbatim with `Content-Disposition: inline`. No immediate XSS risk (current allowlist doesn't include `text/html` or `image/svg+xml`). Risk is conditional on future allowlist expansion.
**Fix**: Force `text/plain` for any MIME not in a curated safe-to-inline set, or change `inline` to `attachment` for `text/*` MIME types.

---

## Workflow Signal/Query Handler Audit (PASS)

- **CodeAgentWorkflow**: `client_feedback(ClientFeedback)` and `cancel()` — both idempotent, payload bounded and Zod-validated, no URL/path injection possible.
- **DeepResearchWorkflow**: `user_feedback(text: str)`, `approve_plan(final_plan_text: str)`, `cancel()`, `status_snapshot()` — all bounded (8000/32000 chars), no URL/path accepted.
- **IngestWorkflow, BatchEmbedWorkflow, LitImportWorkflow**: No signal or query handlers defined.

**Assessment**: No signal/query handler security issues found.
