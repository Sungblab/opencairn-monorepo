# Session 3 — Iteration 5 Findings

**Date**: 2026-04-28
**Scope**: Infra configuration, Temporal worker registration, resource limits, final sweep
**Finding ID prefix**: S3-073 through S3-084

---

## Summary

| Severity | Count | Finding IDs |
|----------|-------|-------------|
| Critical | 0 | — |
| High | 3 new + 1 dup | S3-073 (new), S3-074 (new), S3-075 (new), S3-076 (dup S3-052) |
| Medium | 3 | S3-077, S3-078, S3-079 |
| Low | 5 | S3-080, S3-081, S3-082, S3-083, S3-084 |

---

## Key Questions Answered

**1. Does `/api/ingest/stream/:workflowId` verify ownership?**
**YES** — fully protected. `ingest.ts:291-300` queries `ingest_jobs` by `workflowId`, returns 404 if no row, 403 if `row.userId !== user.id`. All ingest routes are under `.use("*", requireAuth)`. Auth model is sound.

**2. Does MinIO have `minioadmin` defaults?**
**YES in application code** — `docker-compose.yml` itself uses `${S3_SECRET_KEY}` with fail-fast `:?` guard. But both `apps/api/src/lib/s3.ts:37-38` and `apps/worker/src/worker/lib/s3_client.py:30-31` fall back to the string `"minioadmin"` if env vars are absent. See S3-073.

**3. Unregistered activities?**
**NO** — `temporal_main.py` correctly registers all 18 workflows' activities including feature-flag-gated ones. Positive finding.

**4. Worker resource limits?**
**NO** — no `deploy.resources.limits` in worker service. See S3-077.

---

## Findings

### S3-073 — MinIO/Worker S3 Client Hardcoded `minioadmin` Fallback Credentials
**Severity**: High
**File**: `apps/api/src/lib/s3.ts:37-38`, `apps/worker/src/worker/lib/s3_client.py:30-31`
**Issue**: Both API and worker S3 clients fall back to `"minioadmin"` for both `S3_ACCESS_KEY` and `S3_SECRET_KEY` when env vars are absent. If `S3_SECRET_KEY` is accidentally unset (e.g., botched `.env` copy), the application silently authenticates to MinIO with the most widely-known MinIO default credentials.
**Impact**: Attacker with access to port 9000 can use `minioadmin:minioadmin` to read or overwrite all uploaded files if the env var falls through.
**Fix**: Remove `"minioadmin"` fallback in both files. Throw a startup error if env vars are absent.

---

### S3-074 — MinIO Console Port 9001 Exposed on All Interfaces with No Auth Profile Guard
**Severity**: High
**File**: `docker-compose.yml:183`
**Issue**: `minio` service binds `9001:9001` (MinIO web console) on all host interfaces (`0.0.0.0`) with no `profiles:` guard. The MinIO web console allows full admin access — bucket creation, object browsing, policy management, credential changes — protected only by the MinIO root credentials. In a VPS deployment where port 9001 is internet-reachable, an attacker who guesses the root credentials has full storage admin access.
**Impact**: Full data exfiltration (all user-uploaded files) and potential SSRF via MinIO event notifications.
**Fix**: Bind to `127.0.0.1:9001:9001`. Add a comment that the console must be reverse-proxied behind auth if exposed to the network. Consider `profiles: ["infra-admin"]` guard.

---

### S3-075 — Temporal UI (Port 8080) Has No Authentication and No Profile Guard
**Severity**: High
**File**: `docker-compose.yml:235-242`
**Issue**: `temporal-ui` service publishes `8080:8080` on all interfaces with no `profiles:` guard and no authentication. Temporal UI has no built-in auth — it allows browsing all workflow histories, terminating/cancelling workflows, and sending arbitrary signals. Since there is no `profiles:` key, it starts automatically with `docker compose up -d`.
**Impact**: Any user reaching port 8080 can browse all workflow histories (containing full ingest payloads including `user_id`, `object_key`, filenames), terminate workflows, and see all user activity. Full workflow audit trail leak.
**Fix**: Add `profiles: ["infra-admin"]`. Bind to `127.0.0.1:8080:8080`. Add comment that operators must reverse-proxy behind authentication before exposing to any network.

---

### S3-076 — Redis Unauthenticated Full Scope Confirmed (duplicate S3-052)
**Severity**: High — Full scope confirmation of S3-052
**File**: `docker-compose.yml:21-27`
**Issue**: Full scope: Redis is used for ingest event pub/sub (workflow IDs as channel names), notification fan-out (`notifications:<userId>` channels), and ingest replay LIST (serialized workflow event payloads). An unauthenticated attacker reaching port 6379 can subscribe to all channels and read all replay lists. User notification channels (`notifications:<userId>`) were not documented in S3-052 — this confirms a broader cross-user data leak scope.
**Fix**: Same as S3-052.

---

### S3-077 — No Container Resource Limits on Worker Service
**Severity**: Medium
**File**: `docker-compose.yml:244-313`
**Issue**: `worker` service has no `deploy.resources.limits` block. With 500 MB audio/video ingest ceiling and in-memory PDF processing, processing a single large file can use 2–4 GB RSS. Multiple concurrent large-file ingests compound this.
**Impact**: A single large-file ingest can exhaust host memory, causing the OOM killer to kill postgres, redis, and temporal containers on a shared host.
**Fix**: Add `deploy.resources.limits: memory: 4g, cpus: "2.0"`. Document memory sizing in ops guide.

---

### S3-078 — `BATCH_EMBED_*` Flags Not Forwarded to Worker in docker-compose
**Severity**: Medium
**File**: `docker-compose.yml:260-300`
**Issue**: The worker service `environment:` block does not include `BATCH_EMBED_COMPILER_ENABLED`, `BATCH_EMBED_LIBRARIAN_ENABLED`, `BATCH_EMBED_MIN_ITEMS`, `BATCH_EMBED_MAX_ITEMS`, `BATCH_EMBED_JSONL_TTL_DAYS`. Operators who enable batch embedding via `.env` will see the flags silently ignored in the containerised worker.
**Fix**: Add all `BATCH_EMBED_*` flags to the worker service environment block with default values.

---

### S3-079 — `apps/worker/.env.example` Severely Under-documented
**Severity**: Medium
**File**: `apps/worker/.env.example`
**Issue**: Worker `.env.example` has only 22 lines. Missing: `FEATURE_DEEP_RESEARCH`, `FEATURE_CONTENT_ENRICHMENT`, `BATCH_EMBED_*` flags, `GEMINI_API_KEY`/`LLM_API_KEY`, `INTERNAL_API_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `REDIS_URL`, and semaphore config. A developer bootstrapping the worker in isolation has an incomplete picture.
**Fix**: Sync worker `.env.example` with worker-relevant sections from root `.env.example`, or add header directing to root file.

---

### S3-080 — `FEATURE_CONTENT_ENRICHMENT` Missing from worker `.env.example`
**Severity**: Low
**File**: `apps/worker/.env.example`
**Issue**: `FEATURE_CONTENT_ENRICHMENT` is in the root `.env.example` and docker-compose worker env block but not in `apps/worker/.env.example`.
**Fix**: Add `FEATURE_CONTENT_ENRICHMENT=false` to `apps/worker/.env.example`.

---

### S3-081 — `MINIO_ROOT_PASSWORD` Fallback to `S3_SECRET_KEY` Has Undocumented Constraints
**Severity**: Low
**File**: `docker-compose.yml:188-189`
**Issue**: `MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-${S3_SECRET_KEY}}` means if `MINIO_ROOT_PASSWORD` is unset, MinIO root password equals `S3_SECRET_KEY`. No minimum length warning documented — MinIO requires ≥ 8 characters for root password; `S3_SECRET_KEY=abc123` causes silent startup failure.
**Fix**: Add comment in `docker-compose.yml` and `.env.example` that `S3_SECRET_KEY` must be ≥ 8 characters (MinIO minimum); ≥ 32 random characters recommended for production.

---

### S3-082 — `web` Service `depends_on: api: service_healthy` But `api` Has No Healthcheck
**Severity**: Low
**File**: `docker-compose.yml:145-147`
**Issue**: `web` declares `depends_on: api: condition: service_healthy` but the `api` service has no `healthcheck:` block. Docker Compose treats a service with no healthcheck as always in "starting" state — never transitioning to "healthy". `docker compose up -d` either hangs waiting or Docker silently downgrades to `service_started`.
**Fix**: Add a healthcheck to the `api` service using `curl -fsS http://localhost:4000/health`.

---

### S3-083 — Presigned PUT URL Does Not Enforce Size at MinIO Level
**Severity**: Low
**File**: `apps/api/src/lib/s3.ts:67-82`, `apps/api/src/routes/import.ts:46-68`
**Issue**: The API size check trusts client-supplied `size` field in the request JSON. A malicious client can send `size: 100` (passing the API check) and then upload an arbitrarily large file directly to the presigned URL, bypassing `IMPORT_NOTION_ZIP_MAX_BYTES`.
**Fix**: Implement a post-upload size check, or document as known limitation and rely on bucket policies/cleanup.

---

### S3-084 — JSONL Purge Cron Has No Automated Setup for Self-Hosted MinIO
**Severity**: Low
**File**: `apps/worker/scripts/purge_embedding_jsonl.py`, `docker-compose.yml`
**Issue**: The purge script must be run by an external cron job. No cron container, no Kubernetes CronJob manifest, and no `docker-compose.yml` entry for scheduling this. With `BATCH_EMBED_COMPILER_ENABLED=true`, JSONL sidecars accumulate indefinitely.
**Fix**: Add a cron container entry to `docker-compose.yml` running the purge script nightly, with `profiles: ["batch-embed"]` guard.
