# Session 3 — Iteration 8 Findings (Final)

**Date**: 2026-04-28
**Scope**: Rate limiting, quota enforcement, Temporal retention, userId-from-body, console.log PII, Temporal gRPC port, HTTP vs HTTPS internal API
**Finding ID prefix**: S3-107 through S3-114

---

## Summary

| Severity | Count | New Unique | Finding IDs |
|----------|-------|-----------|-------------|
| Critical | 0 | 0 | — |
| High | 2 | 0 new unique | S3-112 (= S3-052 gRPC detail), S3-113 (= S3-089) |
| Medium | 2 | 2 new | S3-107, S3-108 |
| Low | 3 | 3 new | S3-109, S3-110, S3-111 |
| Info | 1 | 1 | S3-114 (accepted risk) |

> **STOP CONDITION MET**: 0 new unique Critical/High findings. Consecutive zero-High iterations: **2/2**. Audit loop terminates.

---

## Findings

### S3-107 — No Rate Limit on `POST /api/ingest/upload` or `POST /api/ingest/url`
**Severity**: Medium
**File**: `apps/api/src/routes/ingest.ts` (entire route)
**Issue**: `checkRateLimit` is not called anywhere in `ingest.ts`. Only a per-request body-size cap (`bodyLimit`) exists. A single authenticated user can POST hundreds of ingest jobs per minute — each triggering a Temporal workflow start, a MinIO PUT, and a DB insert. No per-user or per-workspace throttle.
**Impact**: A compromised account or frontend bug can flood Temporal with workflows, exhaust MinIO storage, and burn LLM quota for all workspace members. Combined with S3-108 (no quota), there is no envelope protecting the operator's resources.
**Fix**: Apply `checkRateLimit` with a per-user key on both `/upload` and `/url`. Starting budget: 20 uploads per 60 s per user. (Consistent with how `literature.ts` uses a 60 req/60 s workspace-scoped limit.)

---

### S3-108 — No Per-User or Per-Workspace Quota on Ingest Volume
**Severity**: Medium
**File**: `apps/api/src/routes/ingest.ts`, `packages/db/src` (no quota table found)
**Issue**: No quota enforcement anywhere in the ingest path — no check on number of active/historical ingest jobs, no cumulative MinIO storage cap. `MAX_UPLOAD_BYTES` limits individual file size but not aggregate volume.
**Impact**: An authenticated user can ingest unlimited files until they exhaust disk, MinIO storage, Postgres row capacity, or Temporal workflow history limits. For multi-tenant deployment (intended per CLAUDE.md), a single workspace can starve all others.
**Fix**: Add env-var ceiling at API layer (`MAX_INGEST_JOBS_PER_WORKSPACE=1000` type config), or introduce a `workspace_quotas` table. At minimum, reject with 429 once active job count exceeds a configurable threshold.

---

### S3-109 — Temporal Default Namespace Retention Not Configurable (72-hour Hardcoded)
**Severity**: Low
**File**: `docker-compose.yml` (temporal service, lines 209-232)
**Issue**: `temporalio/auto-setup:1.24` creates the `default` namespace with 72-hour workflow execution retention. No `TEMPORAL_WORKFLOW_EXECUTION_RETENTION_PERIOD` env var is wired. IngestWorkflow inputs contain `userId`, `projectId`, `fileName`, `objectKey` — PII retained in Temporal's Postgres for 72 hours after workflow close. No mechanism for on-demand purge (GDPR right to erasure).
**Fix**: Expose `TEMPORAL_WORKFLOW_EXECUTION_RETENTION_PERIOD` (ISO 8601 duration, e.g. `24h`) in `docker-compose.yml` temporal service block and document in self-hosting runbook.

---

### S3-110 — `userId` Accepted from Request Body on Internal Ingest-Failure Route
**Severity**: Low
**File**: `apps/api/src/routes/internal.ts:212-228`
**Issue**: `failureSchema` body includes `userId: z.string()` taken from worker-supplied JSON. Route is gated by `INTERNAL_API_SECRET`. Currently used only for logging. If extended to update a jobs table or admin dashboard, the untrusted `userId` field becomes a privilege escalation vector.
**Fix**: Add code comment explicitly noting that `userId` field must never be used as authorization identity if endpoint is extended. When adding a jobs table, derive `userId` from `ingest_jobs` row (by `workflowId`) rather than trusting the body field.

---

### S3-111 — `console.warn` Logs Raw `objectKey`/`quarantineKey` (PII-Containing S3 Paths)
**Severity**: Low
**File**: `apps/api/src/routes/internal.ts:226`
**Issue**: `console.warn("[ingest-failure]", JSON.stringify(body))` logs the full body including `objectKey` (encodes `uploads/${userId}/${uuid}.ext`) and `quarantineKey`. Any log aggregator captures `userId` in plain text.
**Fix**: Log only `{ workflowId, reason, projectId }` — omit `userId`, `objectKey`, `quarantineKey` from the structured log payload.

---

### S3-112 — Temporal gRPC Port 7233 Published to Host Without Auth (Extends S3-052)
**Severity**: High — Extends S3-052 (S3-052 covered UI port 8080; this covers gRPC port 7233)
**File**: `docker-compose.yml:221`
**Issue**: `"${TEMPORAL_HOST_PORT:-7233}:7233"` published on all interfaces. Temporal gRPC has no built-in auth or TLS by default. An unauthenticated attacker reaching port 7233 has full programmatic access — enumerate workflow history, terminate workflows, delete namespaces. More severe than the UI port (8080) because it provides full control without a UI.
**Fix**: Remove host port mapping for 7233 in production (internal Docker services reach Temporal via `temporal:7233` without host-level publishing). For local dev, use `127.0.0.1:7233:7233`. Long-term: configure Temporal mTLS.

---

### S3-113 — `INTERNAL_API_SECRET` Defaults to Known String (Confirms S3-089)
**Severity**: High — Confirms S3-089
**File**: `apps/worker/src/worker/lib/api_client.py:21`
**Issue**: `INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET", "change-me-in-production")`. Docker Compose guard mitigates for Compose deployments, but bare-Python runs default to the known string.
**Fix**: Replace with `os.environ["INTERNAL_API_SECRET"]` — no fallback. Add startup assertion in `temporal_main.py`.

---

### S3-114 — HTTP for Internal API Calls (Accepted Risk)
**Severity**: Info / Accepted Risk
**File**: `apps/worker/src/worker/lib/api_client.py:20`
**Issue**: `API_BASE = os.environ.get("INTERNAL_API_URL", "http://api:4000")`. `INTERNAL_API_SECRET` transmitted in plaintext header over HTTP.
**Assessment**: Acceptable for single-host Docker deployments (traffic stays in host kernel's virtual network). Not acceptable for multi-host deployments. The compose comment notes the header must never leave the internal Docker network. Document assumption explicitly in self-hosting runbook.
**Fix**: No code change needed for current single-host deployment model. Document topology assumption.
