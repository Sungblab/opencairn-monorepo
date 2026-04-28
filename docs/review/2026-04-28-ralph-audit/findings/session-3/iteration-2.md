# Session 3 — Iteration 2 Findings

**Date**: 2026-04-28
**Scope**: Area 3 (Source expansion: Drive/Notion/upload) + Area 4 (Literature search & auto-import)
**Finding ID prefix**: S3-020 through S3-041

---

## Summary

| Severity | Count | Finding IDs |
|----------|-------|-------------|
| Critical | 1 | S3-020 |
| High | 6 | S3-021, S3-022, S3-023, S3-024, S3-025, S3-026 |
| Medium | 10 | S3-027, S3-028, S3-029, S3-030, S3-031, S3-032, S3-033, S3-034, S3-035, S3-036 |
| Low | 5 | S3-037, S3-038, S3-039, S3-040, S3-041 |

---

## Findings

### S3-020 — Drive Access Token Never Injected Into Worker Environment
**Severity**: Critical
**File**: `apps/worker/src/worker/workflows/import_workflow.py` + `apps/worker/src/worker/activities/drive_activities.py:82-98`
**Issue**: `drive_activities._build_service()` reads `_DRIVE_ACCESS_TOKEN_HEX` from `os.environ`. The docstring states the workflow "loads the encrypted token from `user_integrations` and exposes the hex-encoded bytes via `_DRIVE_ACCESS_TOKEN_HEX` before invoking this activity." But `ImportWorkflow.run()` never fetches the token from `user_integrations`, never calls any DB, and never sets any environment variable. There is no code path anywhere in `apps/worker/src/` that sets `_DRIVE_ACCESS_TOKEN_HEX`. The env var will always be `None` and `_build_service()` will raise `RuntimeError` on every Drive import attempt.
**Impact**: Every `google_drive` import workflow crashes at `discover_drive_tree` and `upload_drive_file_to_minio`. Drive import is completely broken in production despite appearing to work in the UI. The test is skipped with a placeholder, so this gap has no test coverage.
**Fix**: Add a token-fetch step to `ImportWorkflow.run()`. Must be an activity (not inline DB access). Pass the decrypted token as a field in the activity payload, not via `os.environ` (see S3-021 for why env-var approach is also broken).

---

### S3-021 — Drive Token Injected Via `os.environ` in a Shared Worker Process
**Severity**: High
**File**: `apps/worker/src/worker/activities/drive_activities.py:82-98`
**Issue**: The intended mechanism uses `os.environ["_DRIVE_ACCESS_TOKEN_HEX"]` set by the workflow. In a Temporal worker, multiple workflow coroutines run concurrently in the same Python process. Setting a global `os.environ` key for one user's Drive token will overwrite any other concurrent Drive import. User A's token could be used to download User B's files.
**Impact**: Cross-user token disclosure possible in any multi-user deployment with concurrent Drive imports.
**Fix**: Pass the (encrypted) access token as a field in the activity payload dictionary (`payload["access_token_encrypted_hex"]`). Remove the `os.environ` read pattern entirely.

---

### S3-022 — Drive OAuth Token Stored Per-User, Not Per-Workspace (Scope Mismatch)
**Severity**: High
**File**: `packages/db/src/schema/user-integrations.ts:9-32`, `apps/api/src/routes/integrations.ts:53-78`
**Issue**: `user_integrations` has a unique constraint on `(userId, provider)` — one row per user, not per workspace. The `/api/integrations/google/connect` endpoint takes `workspaceId` but after OAuth the row is stored against `userId` only. A user member of two workspaces shares the same Drive credential. If a user is removed from workspace A but still belongs to workspace B, their Drive integration persists.
**Impact**: Access-revocation gaps at the workspace boundary. Workspace B admins cannot disconnect a member's Drive access without removing them entirely. Conflicts with the workspace isolation model in CLAUDE.md.
**Fix**: Either (a) add `workspaceId` FK column to `user_integrations` and change unique constraint to `(userId, provider, workspaceId)`, or (b) document explicitly that Drive OAuth is per-user-global and remove the misleading `workspaceId` parameter from `/connect`.

---

### S3-023 — Drive Token Refresh Not Implemented; Expired Token Causes Silent Workflow Failure
**Severity**: High
**File**: `apps/worker/src/worker/activities/drive_activities.py:82-98`, `packages/db/src/schema/user-integrations.ts:19`
**Issue**: `user_integrations` stores `tokenExpiresAt`, `accessTokenEncrypted`, and `refreshTokenEncrypted`. Neither `drive_activities.py` nor `import_workflow.py` checks `tokenExpiresAt` or uses `refreshTokenEncrypted`. Google access tokens expire after 1 hour. A Drive import workflow running > 1 hour will fail mid-way with a 401, retried 3× by the default retry policy, each wasting up to 30 minutes.
**Impact**: Large Drive imports (> ~1000 files) will reliably fail for all users. Token refresh is required for production viability.
**Fix**: Add a dedicated activity that checks `tokenExpiresAt`, calls `https://oauth2.googleapis.com/token` with `grant_type=refresh_token` if needed, updates the row, and returns the fresh token.

---

### S3-024 — Notion ZIP Object Key Not Validated Against Issuing User/Workspace
**Severity**: High
**File**: `apps/api/src/routes/import.ts:170-228`
**Issue**: `POST /api/import/notion` accepts `zipObjectKey` from the request body (validated only as `z.string().min(1)`). The route verifies caller has write access to the `workspaceId` but does not verify that `zipObjectKey` was issued for this specific user/workspace. A user could pass a key from another workspace's upload or an arbitrary MinIO object key.
**Impact**: Cross-workspace data access — worker downloads and attempts to unzip arbitrary MinIO objects on behalf of the caller. Resource abuse, potential information leakage through error messages.
**Fix**: Validate that `zipObjectKey` begins with `imports/notion/${body.workspaceId}/${userId}/` before inserting the job.

---

### S3-025 — Drive Folder Walk Does Not Handle Pagination (`nextPageToken`)
**Severity**: High
**File**: `apps/worker/src/worker/activities/drive_activities.py:157-176`
**Issue**: `walk_folder()` calls `svc.files().list(pageSize=1000).execute()` once and iterates `resp.get("files", [])`. The Drive API returns at most 1000 items per call and includes `nextPageToken` when more exist. Folders with > 1000 items are silently truncated.
**Impact**: Silent data loss for large Drive folders (> 1000 items). Import shows `status=completed` with fewer items than the actual folder.
**Fix**: Implement pagination: after `.execute()`, check `resp.get("nextPageToken")` and loop until exhausted.

---

### S3-026 — `upload_staging_to_minio` Does Not Validate `staging_path` Against Staging Root
**Severity**: High
**File**: `apps/worker/src/worker/activities/notion_activities.py:530-560`
**Issue**: `upload_staging_to_minio` constructs `staged_path = _staging_base() / job_id / payload["staging_path"]` without resolving or checking against the staging root. While `_safe_extract` prevents ZIP-slip during extraction, the `staged_path` field travels through Temporal serialization. A future code path that constructs `staged_path` directly could escape the staging directory.
**Impact**: Medium-risk in current code (path comes from validated extraction). Defense-in-depth gap: any future change allowing user-controlled `staged_path` would silently create a path traversal.
**Fix**: Add `resolve()` check: resolve the constructed path and assert it starts with `str((_staging_base() / job_id).resolve() + os.sep)`. Apply same fix to `convert_notion_md_to_plate`.

---

### S3-027 — SSRF Guard Incomplete: IPv6 Loopback, Reserved Ranges, DNS Rebinding Not Covered
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/lit_import_activities.py:328-343`
**Issue**: `_ssrf_guard` blocks IPv4 RFC-1918, loopback, and link-local by prefix matching. Issues: (1) IPv6 literals (`::1`, `fc00::/7`) — Python `ipaddress` covers loopback but edge cases with bracket-stripped hostnames need explicit test. (2) DNS rebinding: the guard is checked before the request; `follow_redirects=True` checks `r.url` after redirect but DNS resolution is not frozen — a fast-TTL DNS rebind could map a trusted hostname to `127.0.0.1` after the guard. (3) `0.0.0.0` prefix blocks that range. (4) `ipaddress.is_reserved` and `is_multicast` not checked.
**Impact**: DNS rebinding is a viable attack on the OA PDF download path.
**Fix**: (1) Add explicit IPv6 test. (2) Implement pre-connection hostname resolution (`socket.getaddrinfo`) and check resolved IPs, not just the URL hostname. (3) Add `ip.is_reserved` and `ip.is_multicast` to block list.

---

### S3-028 — Literature DOI Dedupe Is Serialized O(N) HTTP Requests
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/lit_import_activities.py:184-219`
**Issue**: `lit_dedupe_check` issues one `GET /api/internal/notes?workspaceId=X&doi=Y` per DOI sequentially. For a 50-paper import this generates 50 serial HTTP round-trips. The API has a bulk query (`inArray(notes.doi, doiIds)`) that is not used here.
**Impact**: Not blocking today but fragile — two dedupe implementations can diverge.
**Fix**: Add bulk-dedupe endpoint `POST /api/internal/notes/doi-exists` and call it once from the activity.

---

### S3-029 — Internal DOI Lookup `exists` Field Not Contract-Tested
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/lit_import_activities.py:210-218`
**Issue**: `lit_dedupe_check` calls `get_internal(f"/api/internal/notes?workspaceId={workspace_id}&doi=...")` and checks `result.get("exists")`. If the endpoint does not return `{"exists": bool}` (no contract test found), the activity receives `None` → falsy → all DOIs treated as fresh, silently bypassing all deduplication.
**Impact**: Duplicate paper notes for every import if `exists` field is missing from internal endpoint.
**Fix**: Verify the endpoint returns `{"exists": bool, "noteId": string | null}` and add a contract test. If the shape is wrong, the activity should raise rather than silently treating all papers as fresh.

---

### S3-030 — `fetch_and_upload_oa_pdf` Buffers Full 50 MiB Into Memory Before Size Check
**Severity**: Medium
**File**: `apps/worker/src/worker/activities/lit_import_activities.py:286-325`
**Issue**: `r.content` buffers the entire HTTP response body before the size check (`if len(content) > MAX_BYTES`). With 3 retries and concurrent paper downloads, a single workflow with 10 papers could allocate ~1.5 GB of heap in the worker process.
**Impact**: OOM risk in the worker pod.
**Fix**: Use `async with client.stream("GET", oa_url) as r:` and accumulate chunks into a `bytearray`, aborting early once the limit is exceeded.

---

### S3-031 — `federatedSearch` Pagination Is Client-Side Slice of Over-Fetched Data
**Severity**: Medium
**File**: `apps/api/src/lib/literature-search.ts:314-346`
**Issue**: The route fetches `limit + offset` results from each upstream API and then slices in memory. For `offset=50, limit=50`, it fetches 100 results from arXiv and SS, burning rate-limit quota for discarded data. No stable sort across the merge, so pages can overlap.
**Impact**: Wasted API quota (arXiv and SS have rate limits). Unreliable pagination for offset > 0.
**Fix**: Document as known limitation. Add comment marking max sane `offset` (< `limit`) for MVP.

---

### S3-032 — arXiv XML Parsing Uses Regex Instead of Proper XML Parser
**Severity**: Medium
**File**: `apps/api/src/lib/literature-search.ts:51-85`, `apps/worker/src/worker/activities/lit_import_activities.py:42-81`
**Issue**: Both the API federation layer and the worker use regex patterns to parse arXiv Atom XML. Issues: (1) titles/abstracts with XML-like characters could truncate matches; (2) `&` and other XML entities are not decoded in the worker version (API has `decodeXml()`).
**Impact**: Malformed paper titles with HTML entities (e.g., `&amp;` appearing literally) in note content.
**Fix**: Use `xml.etree.ElementTree` with `defusedxml` wrapper in the worker. Add entity unescaping to `_fetch_arxiv_metadata`.

---

### S3-033 — `LitImportWorkflow` Omits `workspace_id` in Child `IngestInput`
**Severity**: Medium
**File**: `apps/worker/src/worker/workflows/lit_import_workflow.py:148-159`
**Issue**: Same family as S3-002/S3-003. `LitImportWorkflow._handle_paper()` constructs `IngestInput(...)` without `workspace_id`. When `FEATURE_CONTENT_ENRICHMENT=true`, enrichment activities receive `None` workspace_id and fail or produce malformed artifact keys.
**Note**: This was also identified as S3-003 from iteration 1. Confirmed as same issue with additional context.
**Fix**: Pass `workspace_id=inp.workspace_id` to `IngestInput` constructor.

---

### S3-034 — Presigned PUT URL Does Not Enforce Content-Type `application/zip`
**Severity**: Medium
**File**: `apps/api/src/lib/s3.ts:67-82`, `apps/api/src/routes/import.ts:63-67`
**Issue**: `getPresignedPutUrl` accepts `contentType: "application/zip"` but MinIO's `presignedPutObject` does not enforce Content-Type in the signature. A browser client can PUT any file type to the issued URL.
**Impact**: Non-ZIP objects waste worker compute. If a future code path uses the stored object without ZIP validation, arbitrary file types could be processed.
**Fix**: Document the MinIO limitation. Add server-side content validation: after presigned PUT, verify object magic bytes (PK\x03\x04) via a small MinIO read before queuing the workflow.

---

### S3-035 — `LitImportInput.ids` Not Validated for DOI/arXiv Format
**Severity**: Medium
**File**: `apps/api/src/routes/literature.ts:106-132`
**Issue**: The `POST /api/literature/import` body accepts `ids: string[]` with only non-empty string validation. No DOI or arXiv format validation applied. Arbitrary strings are persisted to `importJobs.sourceMetadata.selectedIds` and printed in `errorSummary`.
**Impact**: User-controlled content in error logs. Edge cases in downstream URL construction.
**Fix**: Add Zod validation pattern to only accept recognized DOI or arXiv ID formats.

---

### S3-036 — No Rate Limiting on `POST /api/literature/import`
**Severity**: Medium
**File**: `apps/api/src/routes/literature.ts:106-235`
**Issue**: `GET /api/literature/search` has a `checkRateLimit` guard. `POST /api/literature/import` has only a concurrency cap of 3 in-flight imports per workspace, no rate limit. An attacker could queue 3 simultaneous 50-paper imports which each call arXiv/SS/Unpaywall federation.
**Impact**: External API rate-limit exhaustion; potential ban from Semantic Scholar free tier (1 req/s).
**Fix**: Add per-workspace rate limit (e.g., 10 import requests per minute per workspace).

---

### S3-037 — `_walk_drive` Uses Synchronous `googleapiclient` in an `async` Activity
**Severity**: Low
**File**: `apps/worker/src/worker/activities/drive_activities.py:101-221`
**Issue**: `discover_drive_tree` is `async def` but uses synchronous `googleapiclient` blocking HTTP calls inside. Blocking I/O in an async activity stalls the event loop.
**Fix**: Wrap `googleapiclient` calls in `asyncio.to_thread()`, or use `httpx.AsyncClient` directly.

---

### S3-038 — Notion Staging Directory Not Cleaned Up After Import
**Severity**: Low
**File**: `apps/worker/src/worker/activities/notion_activities.py:233-248`
**Issue**: `unzip_notion_export` extracts to `_staging_base() / job_id`. No cleanup activity in `ImportWorkflow` to delete staging directory after completion or failure. Multiple large Notion exports could fill worker disk (5 GB cap each).
**Fix**: Add a `cleanup_notion_staging` activity at the end of `ImportWorkflow` using Temporal's finalize step calling `shutil.rmtree(staging_dir, ignore_errors=True)`.

---

### S3-039 — arXiv-Only Papers Not Deduped (Documented Gap Without Tracking Issue)
**Severity**: Low
**File**: `apps/worker/src/worker/activities/lit_import_activities.py:184-219`
**Issue**: arXiv-only IDs (no DOI) are always treated as fresh (documented in code comment). `notes_workspace_doi_idx` partial index skips `doi IS NULL` rows. No tracking issue filed.
**Impact**: Duplicate paper notes for arXiv-only papers.
**Fix**: Create tracking issue. Add `arxiv_id` column to `notes` with partial unique index `WHERE arxiv_id IS NOT NULL`.

---

### S3-040 — Crossref Abstract Not HTML-Stripped in Worker Metadata Path
**Severity**: Low
**File**: `apps/api/src/lib/literature-search.ts:187-191` vs `apps/worker/src/worker/activities/lit_import_activities.py`
**Issue**: API federation layer calls `stripHtml(item.abstract)` for Crossref. Worker `fetch_paper_metadata` only uses SS/arXiv — if SS returns HTML fragments in abstracts, raw HTML appears in note content.
**Fix**: Apply `strip_html(abstract)` pass in `fetch_paper_metadata` before storing the abstract.

---

### S3-041 — Import Job SSE Stream Continues Polling After Client Disconnect
**Severity**: Low
**File**: `apps/api/src/routes/import.ts:321-389`
**Issue**: The SSE handler uses a `while (tick < MAX_TICKS)` polling loop with 2-second intervals. When the client disconnects, the `ReadableStream`'s `cancel()` is called but the loop is blocked in `await new Promise(r => setTimeout(r, POLL_MS))`. The loop continues running for up to 15 minutes (450 ticks), querying the DB every 2 seconds.
**Impact**: Zombie DB polling connections per disconnected client.
**Fix**: Use `AbortController` with a `cancel` callback on the `ReadableStream` to signal the poll loop to exit early.

---

## Anti-Pattern Checklist

| Check | Result | Notes |
|-------|--------|-------|
| No `pgvector(3072)` hardcode | **PASS** | `custom-types.ts` uses `VECTOR_DIM` env correctly |
| No direct LLM calls in Temporal Activities (ingest support) | **PASS** | `lit_import_activities.py`, `drive_activities.py`, `notion_activities.py` contain zero LLM calls |
| Notion ZIP path traversal protection | **PASS** | `_safe_extract()` in `notion_activities.py` resolves and checks paths against staging root. S3-026 is a defense-in-depth recommendation for downstream uses |
| Drive OAuth: token stored per-workspace | **FAIL** | `user_integrations` unique constraint is `(userId, provider)` — no workspace isolation — see S3-022 |
| Upload MIME type validated server-side | **PASS** | `ingest.ts` checks `file.type` against allowlist before storage. Note: client-supplied Content-Type, not magic-byte sniffing |

## Key Observations

1. **Most severe (S3-020)**: Drive import is completely non-functional in production — `_DRIVE_ACCESS_TOKEN_HEX` is never set by the workflow. Design debt from a "Task 9 wires this up" comment that was apparently never implemented.
2. **Drive cluster (S3-020/S3-021/S3-022/S3-023)**: Even fixing S3-020, the env-var approach is dangerous (multi-tenant race), tokens lack workspace scope, and tokens expire mid-import with no refresh logic.
3. **Literature import is functional** (arXiv/SS/Unpaywall/Crossref federation, DOI dedupe, LitImportWorkflow → IngestWorkflow connection) with caveats noted in S3-027 through S3-036.
4. **S3-033 is the same root cause as S3-003** from iteration 1 — confirmed in both places.
