# Session 3 — Iteration 3 Findings

**Date**: 2026-04-28
**Scope**: Area 5 (Content-aware enrichment) + Area 6 (Live Ingest Visualization)
**Finding ID prefix**: S3-043 through S3-059

---

## Summary

| Severity | Count | Finding IDs |
|----------|-------|-------------|
| Critical | 0 | — |
| High | 3 | S3-043 (dup S3-001), S3-052, S3-056 |
| Medium | 4 | S3-044, S3-045, S3-046, S3-051 |
| Low | 9 | S3-047, S3-048, S3-049, S3-050, S3-053, S3-054, S3-055, S3-057, S3-058, S3-059 |

> **Note**: S3-043 is a duplicate confirmation of S3-001 (workspace_id never passed from API routes into IngestInput). Same root cause, verified from enrichment angle.

---

## Findings

### S3-043 — `workspace_id` Never Passed to IngestWorkflow from API (Enrichment Perspective)
**Severity**: High — Duplicate of S3-001
**File**: `apps/api/src/routes/ingest.ts:182–195` (POST /ingest/upload) and `:232–246` (POST /ingest/url)
**Issue**: Same as S3-001 — both `/ingest/upload` and `/ingest/url` resolve `workspaceId` but do NOT include it in workflow args. From the enrichment angle: `store_enrichment_artifact` calls internal API with `workspaceId: ""` (empty string fallback), which fails UUID validation with a 400 error. The failure is caught and silently discarded, so zero enrichment rows ever appear in `note_enrichments` even when `FEATURE_CONTENT_ENRICHMENT=true`.
**Impact**: LLM tokens are consumed for enrichment computation but artifacts are never persisted. All enrichment is silently lost in production.
**Fix**: Same as S3-001 — add `workspaceId` to both `args[0]` objects in workflow dispatch.

---

### S3-052 — Redis Deployed Without Password or ACL in docker-compose
**Severity**: High
**File**: `docker-compose.yml:22–27`
**Issue**: Redis service uses `image: redis:7-alpine` with no `command:` override, no password (`requirepass`), and no ACL rules. Port 6379 is published to all host interfaces (`"6379:6379"` with no host IP binding). In production self-hosted scenarios where the host is internet-reachable, this exposes an unauthenticated Redis instance.
**Impact**: Full read/write access to Redis for any network peer. An attacker can: read ingest replay lists (data leakage), inject forged `completed` events to trigger redirects to arbitrary note IDs, or use Redis to exhaust memory.
**Fix**:
```yaml
redis:
  image: redis:7-alpine
  command: redis-server --requirepass "${REDIS_PASSWORD:?set REDIS_PASSWORD}"
  ports:
    - "127.0.0.1:6379:6379"  # bind to loopback only
```
Add `REDIS_PASSWORD` to `.env.example`. Add `REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379` to API and worker env blocks.

---

### S3-056 — `startRun` Has No UI Call Site; Live Ingest Store Never Populated in Production
**Severity**: High
**File**: `apps/web/src/stores/ingest-store.ts:71` (absence of call sites)
**Issue**: Searching `apps/web/src/` shows `startRun` is only called from test files (`ingest-store.test.ts`, `ingest-spotlight.test.tsx`, etc.). No production UI component calls `useIngestStore.getState().startRun(...)` after dispatching `POST /api/ingest/upload`. The SSE stream depends on `wfid` from the store, and the spotlight depends on `spotlightWfid` being set by `startRun`.
**Impact**: A user who uploads a file via any UI path gets a `workflowId` back from the API but the ingest store is never populated, so `spotlightWfid` is null, the spotlight never appears, the dock never shows a running card, and the 5s redirect never fires. The entire Live Ingest Visualization feature is dead in the UI — all well-tested machinery has no entry point.
**Fix**: Create `apps/web/src/lib/api-client-ingest.ts` with `uploadFile(file, projectId, noteId?)` that calls `POST /api/ingest/upload`, receives `{ workflowId }`, calls `useIngestStore.getState().startRun(workflowId, ...)`, then returns the `workflowId`. Wire into the upload UI component.

---

### S3-044 — `os.environ` Access Inside Temporal Workflow Sandbox (Enrichment Feature Flag)
**Severity**: Medium
**File**: `apps/worker/src/worker/workflows/ingest_workflow.py:233–236`
**Issue**: Same as S3-005 from iteration 1, confirmed from enrichment angle. The `FEATURE_CONTENT_ENRICHMENT` flag is read with `import os as _os` inside the workflow method body. If the flag changes between initial execution and a workflow replay (e.g., during a worker restart), Temporal raises a non-determinism exception and the workflow gets stuck.
**Impact**: Flag flip mid-workflow causes Temporal non-determinism error requiring manual workflow termination.
**Fix**: Move flag check to a module-level constant: `_FEATURE_ENRICHMENT = os.environ.get("FEATURE_CONTENT_ENRICHMENT") == "true"`.

---

### S3-045 — `enrich_document` Activity Has No Idempotency Check; Re-enrichment Overwrites Silently
**Severity**: Medium
**File**: `apps/api/src/routes/internal.ts:2448–2471`
**Issue**: `POST /internal/notes/:noteId/enrichment` uses `ON CONFLICT (note_id) DO UPDATE` (blind upsert). No status check: if a note is re-ingested or if a concurrent retry runs, an existing `status="done"` artifact is unconditionally replaced with a new partial or `status="processing"` artifact. No `WHERE status != 'done'` guard, no version/generation counter.
**Impact**: Concurrent or duplicate ingest runs can silently erase completed enrichment artifacts. No audit trail of the previous artifact.
**Fix**: Add a `generation` integer column to `note_enrichments` and include it in `ON CONFLICT DO UPDATE` logic. Or gate updates with `WHERE note_enrichments.status != 'done'`.

---

### S3-046 — Enrichment Always Uses Global `LLM_API_KEY` (Admin Key), Never BYOK
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/enrich_document_activity.py:102–109`, `detect_content_type_activity.py:78–86`
**Issue**: Both activities construct `ProviderConfig` from `os.environ.get("LLM_API_KEY")`. The BYOK routing module (`worker.lib.llm_routing`) is never called. The `workspace_id` and `user_id` available in `inp` are ignored for key selection.
**Impact**: In BYOK/multi-tenant deployments, all enrichment LLM costs hit the admin key. Users with BYOK get no cost transparency or isolation for enrichment calls. Bypasses `docs/architecture/billing-routing.md`.
**Fix**: Route through `llm_routing.py` passing `workspace_id`, `user_id`, and `purpose="enrichment"`. Add `TODO(Plan 9b)` comment matching the routing spec's pattern.

---

### S3-051 — Redis Pub/Sub Channels Not Workspace-Scoped; No Auth on Channel Name
**Severity**: Medium
**File**: `apps/worker/src/worker/lib/ingest_events.py:64`, `apps/api/src/routes/ingest.ts:355`
**Issue**: Redis channels follow the pattern `ingest:events:{workflow_id}`. Workflow IDs are random UUIDs (practical obscurity), but Redis has no authentication and no per-channel ACL. The API layer enforces ownership auth before handing the SSE stream to the browser, but any process with network access to Redis can subscribe to `ingest:events:*` and receive all ingest events across all users and workspaces.
**Impact**: In a self-hosted deployment with 6379 inadvertently exposed, any machine on the network can observe filenames, content outlines, extracted figures, and `noteId` values for every user's ingest job.
**Fix**: (a) Add Redis auth — see S3-052. (b) Prefix channels with workspace_id: `ingest:events:{workspace_id}:{workflow_id}` for defense-in-depth. (c) Remove `"6379:6379"` host port binding in production profiles.

---

### S3-047 — `ENRICHMENT_MAX_PDF_BYTES` Not Documented in `.env.example`
**Severity**: Low
**File**: `apps/worker/src/worker/activities/enrich_document_activity.py:194`
**Issue**: The `ENRICHMENT_MAX_PDF_BYTES` env var (default 25 MiB) controls whether enrichment sends PDF to Gemini multimodal vs. falls back to text-only. Other enrichment flags are in `.env.example` but this one is absent.
**Fix**: Add to `.env.example` with comment explaining the tuning purpose.

---

### S3-048 — No API-Level Tests for Enrichment Endpoint (Upsert/Conflict/Workspace Mismatch)
**Severity**: Low
**File**: `apps/api/tests/` (absence)
**Issue**: `POST /internal/notes/:noteId/enrichment` and `GET /internal/notes/:noteId/enrichment` have no dedicated test file. Key behaviors (upsert idempotency, workspace_mismatch rejection, note_not_found rejection) are exercised only via worker integration tests.
**Fix**: Add `apps/api/tests/internal-enrichment.test.ts` covering insert, upsert-on-conflict, workspace_mismatch 400, note_not_found 404, and GET with workspaceId query param.

---

### S3-049 — `SymbolItem.kind` Pydantic Literal Includes `"variable"` Not Produced by AST Walk
**Severity**: Low
**File**: `apps/worker/src/worker/lib/enrichment_artifact.py:62–68`
**Issue**: `SymbolItem.kind` is typed as `Literal["function", "class", "variable"]` but the AST extractor only emits `"function"` and `"class"`. The `"variable"` Literal value is aspirational rather than enforced by tests.
**Fix**: Restrict the Literal to `Literal["function", "class"]` until variable extraction is implemented, or add a test asserting the current AST extractor never produces `kind="variable"`.

---

### S3-050 — `enrich_document` Catches All `Exception` on Pydantic Validation Failure and Stores Raw Data
**Severity**: Low
**File**: `apps/worker/src/worker/activities/enrich_document_activity.py:386–397`
**Issue**: When `EnrichmentArtifact.model_validate(raw_data)` fails, the bare `except Exception` clause stores unvalidated `raw_data` with a `_validation_error` key. Downstream consumers (synthesis export, graph view) trusting the artifact shape may encounter unexpected keys or missing required fields.
**Fix**: Store `_validation_error` tagged artifacts in a separate `raw_artifact` JSONB column. Keep `artifact` null or containing only validated partial schema. Surface the `_validation_error` tag at the API read layer so consumers can skip unvalidated rows.

---

### S3-053 — SSE Keepalive Write Error Does Not Trigger `cleanup()`
**Severity**: Low
**File**: `apps/api/src/routes/ingest.ts:311–316`
**Issue**: Keepalive uses `void stream.writeSSE(...).catch(() => {})`. A failed keepalive write (e.g., when stream is closed but `cleanup()` hasn't yet fired) is completely silent and does not trigger `cleanup()`. If the `abort` signal doesn't fire on some proxy disconnect scenarios, the Redis subscriber connection leaks.
**Fix**: `void stream.writeSSE({ event: "keepalive", data: "" }).catch(() => { void cleanup(); })`

---

### S3-054 — `NEXT_PUBLIC_FEATURE_LIVE_INGEST` Does Not Gate `IngestViewer` Tab Mode
**Severity**: Low
**File**: `apps/web/src/components/tab-shell/tab-mode-router.tsx:24–25`
**Issue**: `IngestOverlays` (spotlight/dock) correctly checks the flag and returns `null` when disabled. But `IngestViewer` (full-tab view via `TabModeRouter` for `tab.mode === "ingest"`) is not guarded. SSE subscription path remains active even when the flag is `false`.
**Fix**: Add a flag check in `TabModeRouter` for the `"ingest"` case, returning `<StubViewer>` when flag is false.

---

### S3-055 — Spotlight Timeout Constant (7s) Mismatches Spec Comment (5s)
**Severity**: Low
**File**: `apps/web/src/components/ingest/ingest-spotlight.tsx:8`
**Issue**: `SPOTLIGHT_TIMEOUT_MS = 7000` but CLAUDE.md and audit docs reference "5s redirect." Minor inconsistency.
**Fix**: Either align to 5000 or add explicit comments explaining the deliberate difference between spotlight timeout and redirect delay.

---

### S3-057 — Redis Replay List May Drop Early Events for Large Documents (> 1000 pages)
**Severity**: Low
**File**: `apps/worker/src/worker/lib/ingest_events.py:65`, `apps/api/src/routes/ingest.ts:358–361`
**Issue**: `_REPLAY_MAX_LEN = 1000` with `ltrim 0, 999` keeps the 1000 most-recently-pushed events. For documents with more than 1000 pages, early page events (including possibly the `started` event) are trimmed from the replay buffer. A client connecting after the workflow is done will miss the start of the timeline.
**Fix**: Raise `INGEST_REPLAY_MAX_LEN` to a higher default (e.g., 2000) and document in `.env.example`. Or implement a sentinel-based truncation that always preserves the `started` event at the tail.

---

### S3-058 — `onerror` Handler in `useIngestStream` May Allow Spurious Reconnect After Terminal Event
**Severity**: Low
**File**: `apps/web/src/hooks/use-ingest-stream.ts:31–34`
**Issue**: If the server closes the connection before the client processes the terminal `completed`/`failed` message (race between `stream.close()` and message delivery), `onerror` fires without `es.close()`, and `EventSource` immediately reconnects, creating a short-lived orphan Redis subscriber.
**Fix**: Track terminal event receipt in a `ref`. In `onerror`, check the ref before allowing auto-reconnect.

---

### S3-059 — No Test for SSE Reconnect with `Last-Event-ID` Dedup Logic
**Severity**: Low
**File**: `apps/api/tests/ingest-stream.test.ts`
**Issue**: `Last-Event-ID` + `lastSent` dedup pattern is correctly implemented but untested. A regression (e.g., `Number(lastEventId)` returning `NaN` for empty header) would cause duplicate state updates on reconnect.
**Fix**: Add test: seed backlog with seq 1–3, connect with `Last-Event-ID: 2`, assert only seq 3 is received.

---

## Anti-Pattern Checklist

| Check | Result | Notes |
|-------|--------|-------|
| Enrichment idempotency (retry safety) | PASS | `ON CONFLICT (note_id) DO UPDATE` handles retries |
| Enrichment conflict (re-enrichment of completed note) | FAIL | No `WHERE status != 'done'` guard — S3-045 |
| `IngestWorkflow` splice idempotency | PARTIAL | Best-effort catch prevents blocking note creation; duplicate writes possible with same note_id |
| Redis channel isolation per workspace | FAIL | Workflow-scoped only, no workspace prefix, no Redis auth — S3-051, S3-052 |
| SSE reconnect dedup behavior | PASS | `Last-Event-ID` + `lastSent` correctly implemented |
| SSE subscribe-before-replay race | PASS | Subscribes first, then lrange, deduped via `lastSent` |
| SSE disconnect/cleanup | PARTIAL | Abort signal path is clean; keepalive write error does not call cleanup — S3-053 |
| 5s redirect logic | PASS | Ref-based cancellation guard is correct; tests pass |
| `NEXT_PUBLIC_FEATURE_LIVE_INGEST` gates overlay | PARTIAL | PASS for spotlight/dock; FAIL for IngestViewer tab — S3-054 |
| `FEATURE_CONTENT_ENRICHMENT` flag documented | PASS | In `.env.example` |
| Enrichment LLM uses workspace vs user key | FAIL | Always uses global admin key — S3-046 |
| `workspace_id` propagated to worker | FAIL | Not passed in workflow args — S3-043 (= S3-001) |
| Live Ingest UI has production entry point | FAIL | `startRun` has no call site outside tests — S3-056 |
| Redis auth in docker-compose | FAIL | No password, port exposed to all interfaces — S3-052 |
