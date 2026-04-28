# Session 3 — Iteration 6 Findings

**Date**: 2026-04-28
**Scope**: Test coverage gaps, Python dependency security, API-level ingest security, remaining compose issues
**Finding ID prefix**: S3-085 through S3-097

---

## Summary

| Severity | Count | New Unique | Finding IDs |
|----------|-------|-----------|-------------|
| High | 2 | 1 new unique | S3-085 (dup S3-004), S3-089 (new) |
| Medium | 5 | 5 new | S3-086, S3-087, S3-088, S3-090, S3-091 |
| Low | 4 | 3 new | S3-092, S3-094, S3-095, S3-096 |
| Info | 2 | 2 | S3-093, S3-097 |

> **Positive findings**: Hocuspocus auth is properly implemented. Notion ZIP path traversal is comprehensively tested. Python deps (Pillow, lxml, requests, Pydantic v2) are current. Internal API auth fails-closed when API-side `INTERNAL_API_SECRET` is unset.

---

## Findings

### S3-085 — `text/plain`/`text/markdown` MIME Types Reach `raise ValueError` in IngestWorkflow (Production Confirmation of S3-004)
**Severity**: High — Duplicate/confirmation of S3-004
**File**: `apps/worker/src/worker/workflows/ingest_workflow.py:226`
**Issue**: Confirms S3-004 is production-broken. The API allowlist accepts these MIME types but `IngestWorkflow._run_pipeline()` has no branch for them — they fall through to `raise ValueError`. Every `.txt` and `.md` upload is quarantined after 3 retries.
**Fix**: Add `text/plain`/`text/markdown` branch before the `else` clause — read from MinIO as UTF-8, set `needs_enhance=False`.

---

### S3-089 — `INTERNAL_API_SECRET` Falls Back to `"change-me-in-production"` in Worker
**Severity**: High — New unique finding
**File**: `apps/worker/src/worker/lib/api_client.py:21`
**Issue**: `INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET", "change-me-in-production")`. If a deployer omits `INTERNAL_API_SECRET` from the worker environment in a non-Compose deployment (bare Docker, Kubernetes, local dev), the worker authenticates to the internal API with the well-known default. `docker-compose.yml` correctly enforces `:?` for both api and worker, but non-Compose deployments are unprotected.
**Impact**: In a misconfigured deployment where both API and worker omit the variable with the same default, the internal API is effectively unauthenticated. Any host-network-level attacker can spoof worker callbacks (mark ingests complete, store enrichment artifacts, create source notes).
**Fix**: Fail loudly at startup if `INTERNAL_API_SECRET` is unset: `INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET") or (_ for _ in ()).throw(RuntimeError("INTERNAL_API_SECRET must be set"))`. Or use a more Pythonic: `if not (s := os.environ.get("INTERNAL_API_SECRET")): raise RuntimeError(...)`.

---

### S3-086 — No Regression Test for `text/plain`/`text/markdown` Ingest
**Severity**: Medium
**File**: `apps/worker/tests/` (absence)
**Issue**: No test exercises `IngestWorkflow._run_pipeline()` with `mime_type="text/plain"` or `"text/markdown"`. Without such a test, fixing S3-004/S3-085 can regress silently.
**Fix**: Add unit tests using `temporalio.testing.WorkflowEnvironment` that mock S3 download and assert `create_source_note` is called correctly.

---

### S3-087 — No Test for `create_source_note` Activity Idempotency (Double-Run)
**Severity**: Medium
**File**: `apps/worker/tests/` (absence)
**Issue**: `create_source_note` calls `POST /api/internal/source-notes`. If Temporal retries the activity, a duplicate note may be created. No test verifies that a second call with the same `workflow_id` does not create a duplicate.
**Fix**: (1) The internal API endpoint should accept a `workflowId` idempotency key with `ON CONFLICT DO NOTHING`. (2) Add a test calling the activity twice with the same `workflow_id` and asserting only one note is created.

---

### S3-088 — `GET /api/import/jobs` Lists All Workspace Members' Jobs (Information Disclosure)
**Severity**: Medium
**File**: `apps/api/src/routes/import.ts:253-286`
**Issue**: `GET /api/import/jobs?workspaceId=<wid>` fetches every `import_jobs` row for the workspace without filtering by `userId`. A workspace member with read access can enumerate all other members' import jobs, including raw `errorSummary` fields that may contain stack traces or file path fragments.
**Impact**: Any member of a shared workspace can see the full import history of all other members.
**Fix**: Add `eq(importJobs.userId, userId)` to the `WHERE` clause, or add role check (only workspace admins see all jobs).

---

### S3-090 — PostgreSQL Port 5432 Published to Host on All Interfaces
**Severity**: Medium
**File**: `docker-compose.yml:4-5`
**Issue**: `postgres` service has `ports: - "5432:5432"` binding to all host interfaces. All services that need Postgres can reach it via Docker internal network without this host-binding. Only needed for local dev convenience.
**Impact**: Self-hosters who deploy on cloud VMs without external firewall expose their production database to brute-force attacks.
**Fix**: Change to `expose: - "5432"` (internal only), or bind to `127.0.0.1:5432:5432`. Add a `docker-compose.override.yml` example for local dev access.

---

### S3-091 — Redis Port 6379 Published to Host Without Auth (Additional detail to S3-052)
**Severity**: Medium — Confirms/extends S3-052
**File**: `docker-compose.yml:24-25`
**Issue**: `redis` service binds `6379:6379` on all interfaces with no auth. This affects: ingest event pub/sub, notification channels (`notifications:<userId>`), and ingest replay LISTs. The notification channel scope (`notifications:<userId>`) was not previously documented.
**Fix**: Same as S3-052 — add `requirepass`, bind to `127.0.0.1:6379:6379`.

---

### S3-092 — arXiv XML Parsing Uses Raw Regex on Untrusted HTTP Response; `defusedxml` Not Used
**Severity**: Low
**File**: `apps/worker/src/worker/activities/lit_import_activities.py:51-69`
**Issue**: `_fetch_arxiv_metadata` uses regex on raw Atom XML. `defusedxml` 0.7.1 and `lxml` 6.1.0 are present in `uv.lock` but neither is used. Entities like `&amp;` in titles are not decoded.
**Fix**: Replace regex parsing with `defusedxml.ElementTree.fromstring(r.text)` and standard XPath lookups.

---

### S3-094 — No Workflow-Level Test for DOI Dedupe Skipping PDF Download
**Severity**: Low
**File**: `apps/worker/tests/test_lit_import_activities.py:134-159`
**Issue**: Unit test for `lit_dedupe_check` correctly marks `10.already/x` as `skipped`. But no workflow-level test verifies that a `skipped` DOI bypasses `fetch_and_upload_oa_pdf` entirely.
**Fix**: Add a `LitImportWorkflow` integration test that feeds a `skipped` DOI and asserts `fetch_and_upload_oa_pdf` is never called.

---

### S3-095 — Hocuspocus Port 1234 Published to Host Without TLS Notice
**Severity**: Low
**File**: `docker-compose.yml:163-164`
**Issue**: `hocuspocus` service (profile-gated) binds WebSocket port 1234 on all interfaces. Auth is correctly implemented in `apps/hocuspocus/src/auth.ts`. But the connection is WS over plain HTTP — collaboration traffic is cleartext without a TLS-terminating reverse proxy.
**Fix**: Add documentation that port 1234 **must** be behind a TLS reverse proxy in production. Consider binding to `127.0.0.1:1234:1234` by default.

---

### S3-096 — MinIO Console Port 9001 Published Without Auth Documentation
**Severity**: Low
**File**: `docker-compose.yml:185-186`
**Issue**: MinIO publishes both S3 API (9000) and management console (9001) to all host interfaces. No warning in compose file about console exposure.
**Fix**: Remove port 9001 from host-published ports for production profiles. Use `expose: - "9001"` instead. Document that 9001 must be firewalled.

---

### S3-093 — `defusedxml` Present in Lockfile But Unused in Application Source
**Severity**: Info
**File**: `apps/worker/uv.lock:471`
**Issue**: `defusedxml` 0.7.1 is a transitive dependency but zero application source files import it directly.
**Fix**: If arXiv XML parsing is hardened per S3-092, add `defusedxml` as a direct dependency in `pyproject.toml`.

---

### S3-097 — `POST /api/import/jobs/:id/retry` Returns 501 Stub (Positive)
**Severity**: Info
**File**: `apps/api/src/routes/import.ts:434-442`
**Issue**: Retry endpoint is a properly authenticated stub returning 501. Safe pattern.
**Fix**: When implementing retry, verify `importJobs.userId === userId` before re-submitting to Temporal.
