# Ralph Audit 2026-04-28 — Consolidated Findings (6 Sessions)

> **Status**: 6/6 sessions completed (each terminated on Critical/High = 0 × 2 consecutive iterations)
> **Compiled**: 2026-04-28
> **Source files**: `docs/review/2026-04-28-ralph-audit/findings/session-{1..6}/SUMMARY.md` + iteration logs

## Domain Map

| Session | Domain | Iterations | Critical | High | Med | Low |
|---|---|---|---|---|---|---|
| 1 | Editor & Realtime Collab | 3 | 0 | 3 | 6 | 5 |
| 2 | App Shell & Chat & Agent UI | 4 | 0 | 4 | 11 | 14 |
| 3 | Ingest Pipeline & Sources | 8 | **1** | 13 | 22 | 26 + 7 info |
| 4 | Agent Runtime (LLM/Compiler/Research/DocEditor/Code/Viz) | 5 | 0 | 3 | 3 | 7 |
| 5 | Backend API & Auth & Permissions | 3 | 0 | 1 | 3 | 11 |
| 6 | Data Layer & Infra & DX | 5 | 0 | 2¹ | 6 | 18 |
| **Total** | | 28 | **1** | **26** (S6-011 already fixed → 25 unfixed) | **51** | **81 + 7 info** |

¹ Session 6 Highs = S6-011 + S6-022. S6-011 (MinIO root password default) is fixed in commit `a1f6bc6`; S6-022 (CI removed) is unfixed.

---

## Critical (1)

| ID | Title | File | Status |
|---|---|---|---|
| **S3-020** | Drive access token NEVER injected into worker — Drive import completely broken | `apps/worker/src/worker/activities/drive_activities.py:82-98` + `apps/worker/src/worker/workflows/import_workflow.py` | Unfixed |

---

## High (26, 25 unfixed)

### Session 1 — Editor & Realtime Collab (3)

| ID | Title | File |
|---|---|---|
| S1-001 | SlashMenu global keydown lacks `PlateContent` focus check — title/comment input may delete editor characters | `apps/web/src/components/editor/.../slash-menu.tsx` |
| S1-002 | Hocuspocus client `token: ""` — server auth path may be bypassed or fully rejected | `apps/web/src/lib/yjs-provider.ts` |
| S1-003 | `HOCUSPOCUS_ORIGINS` env parsed but `Server({ origins })` never receives it | `apps/hocuspocus/src/index.ts` |

### Session 2 — App Shell & Chat & Agent UI (4)

| ID | Title | File |
|---|---|---|
| S2-001 | `addTab` does not focus new tab (keeps `activeId ?? tab.id`) | `apps/web/src/stores/tabs-store.ts` |
| S2-006 | ChatPanel uses `res.text()` — no SSE streaming, full buffering | `apps/web/src/components/chat/ChatPanel.tsx` |
| S2-007 | ChatPanel ignores SSE `event: error` — empty response on LLM misconfig | same |
| S2-026 | Agent Panel `history: []` hardcoded — multi-turn LLM context = 0 | `apps/api/src/lib/agent-pipeline.ts:56` |

### Session 3 — Ingest Pipeline & Sources (13 unfixed)

| ID | Title | File |
|---|---|---|
| S3-001 | `workspace_id` never passed from `/ingest/upload` and `/ingest/url` to `IngestInput` | `apps/api/src/routes/ingest.ts:182-245` |
| S3-002 | `ImportWorkflow._run_binary` omits `workspace_id` in child `IngestInput` | `apps/worker/src/worker/workflows/import_workflow.py:235-246` |
| S3-003 | `LitImportWorkflow._handle_paper` omits `workspace_id` in child `IngestInput` | `apps/worker/src/worker/workflows/lit_import_workflow.py:150-157` |
| S3-004 | `text/plain` and `text/markdown` MIME hit `raise ValueError` in workflow | `apps/worker/src/worker/workflows/ingest_workflow.py:225-226` |
| ~~S3-006~~ | ~~No `heartbeat_timeout` on any IngestWorkflow activity~~ — **FIXED** on `fix/ralph-reliability-compose`. Every `workflow.execute_activity(...)` now passes `_LONG_HEARTBEAT` (60 s) or `_SHORT_HEARTBEAT` (30 s); `office_activity` calls `activity.heartbeat()` between LibreOffice/markitdown steps; static + dynamic regression in `apps/worker/tests/workflows/test_ingest_heartbeat.py` | `apps/worker/src/worker/workflows/ingest_workflow.py` |
| S3-021 | Drive token via `os.environ` in shared worker process (cross-user race) | `apps/worker/src/worker/activities/drive_activities.py:82-98` |
| S3-022 | Drive OAuth token stored per-user, not per-workspace | `packages/db/src/schema/user-integrations.ts:9-32` |
| S3-023 | Drive token refresh not implemented; expiry → silent failure | `apps/worker/src/worker/activities/drive_activities.py` |
| S3-024 | Notion ZIP `zipObjectKey` not validated against issuer's prefix | `apps/api/src/routes/import.ts:170-228` |
| S3-025 | Drive folder walk does not paginate `nextPageToken` (silent truncation > 1000) | `apps/worker/src/worker/activities/drive_activities.py:157-176` |
| ~~S3-052~~ | ~~Redis 6379 + Temporal gRPC 7233 + Temporal UI 8080 + MinIO 9001 — all unauthenticated, host-published~~ — **FIXED** on `fix/ralph-reliability-compose`. `postgres`, `temporal`, `temporal-ui`, `minio`, `ollama` all default to `host_ip: 127.0.0.1`; matching `*_HOST_BIND` knobs in `.env.example`; policy + override guidance in `docs/contributing/hosted-service.md § Compose port exposure policy`. Verified via `docker compose config`. Auth status per service is documented; `temporal`/`temporal-ui`/`ollama` remain auth-less (out of scope for this fix), so they require SSH tunnel or reverse-proxy auth before any host_bind override. | `docker-compose.yml` |
| S3-056 | `startRun` has no UI call site — Live Ingest Visualization completely dead in production | `apps/web/src/stores/ingest-store.ts:71` |
| S3-073 | MinIO/Worker S3 client hardcoded `minioadmin` fallback credentials | `apps/api/src/lib/s3.ts:37-38`, `apps/worker/src/worker/lib/s3_client.py:30-31` |
| S3-089 | `INTERNAL_API_SECRET` defaults to `"change-me-in-production"` in worker | `apps/worker/src/worker/lib/api_client.py:21` |

(S3-105 = duplicate of S3-004 from Drive/Notion side; merged.)

### Session 4 — Agent Runtime (3)

| ID | Title | File |
|---|---|---|
| S4-001 | `_inject_loop_warning` produces two `FunctionResponse`s with the same `tool_use_id` | `apps/worker/src/runtime/tool_loop.py:296-320` |
| S4-008 | Deep Research URL paths missing `/api/` prefix (`/internal/notes`, `/internal/research/.../artifacts`) + endpoint never implemented | `apps/worker/src/worker/activities/{execute_research,persist_report}.py` |
| S4-011 | `CodeAgentWorkflow` `wait_condition` timeout returns `False` (not raises `TimeoutError`); subsequent `assert fb is not None` blows up | `apps/worker/src/worker/workflows/code_workflow.py:97-110` |

### Session 5 — Backend API & Auth (1)

| ID | Title | File |
|---|---|---|
| S5-001 | Private note title disclosure via `/recent-notes` and `/notes/search` — `inheritParent=false` filter bypassed | `apps/api/src/routes/workspaces.ts:322-387` |

### Session 6 — Data Layer & DX (1 unfixed)

| ID | Title | File |
|---|---|---|
| S6-022 | CI removed; no automated test/lint/type-check enforcement (AGENTS.md claim incorrect) | `.github/workflows/` |
| ~~S6-011~~ | ~~MinIO root password defaults to `minioadmin`~~ | Fixed in `a1f6bc6` |

---

## Top 10 Priority — current status (2026-04-28 evening)

Selection criteria (in order): (1) Critical first; (2) anyone-can-exploit security gaps; (3) silently-broken production paths blocking enrichment/storage; (4) user-facing UX regressions where the surface is heavily exercised; (5) feasibility within a single repo edit.

8/10 already landed in PRs #145-148 merged into `main` on 2026-04-28. This session's remaining target: **S3-089** + **S4-008**.

| Rank | ID | Severity | Status (verified against `main` HEAD `2e1671e`) |
|---|---|---|---|
| **P1** | **S3-020** | Critical | ✅ **MERGED** — PR #146 `053d9de`. `fetch_google_drive_access_token` activity now reads token from DB and returns it via the activity's return value (not `os.environ`). Drive import functional. |
| **P2** | **S5-001** | High | ✅ **MERGED** — PR #147 `70d441b`. `readableNoteSql()` predicate added to both `/notes/search` and `/recent-notes` WHERE clauses. SQL-side filter, no overfetch. |
| **P3** | **S3-001 / S3-002 / S3-003** | High | ✅ **MERGED** — PR #146 `053d9de`. `workspace_id` propagated through `ingest.ts` (upload + url), `import_workflow.py:246`, `lit_import_workflow.py:157`. |
| **P4** | **S3-004** (covers S3-105) | High | ✅ **MERGED** — PR #146 `053d9de`. `_TEXT_MIMES` set + `read_text_for_ingest` activity at `ingest_workflow.py:72-104`. |
| **P5** | **S3-073** | High | ✅ **MERGED** — PR #145 `d485a28`. `requiredS3Env()` throws on unset; both API and worker S3 clients wired through it. |
| **P6** | **S3-089** | High | ❌ **OPEN** — `apps/worker/src/worker/lib/api_client.py:21` still defaults to `"change-me-in-production"`. Fix in this session. |
| **P7** | **S2-006 + S2-007 + S2-001** | High | ✅ **MERGED** — PR #148 `20066a0`. ChatPanel uses `eventsource-parser` + `getReader()`, handles `event: error`/cost/save_suggestion. `tabs-store.addTab` now sets `activeId: tab.id`. |
| **P8** | **S4-008** | High | ❌ **OPEN** — `execute_research.py:165`, `persist_report.py:119,146` still use `/internal/...`. Endpoint `/api/internal/research/:run_id/artifacts` not yet implemented. Fix in this session. |
| **P9** | **S4-011** | High | ✅ **MERGED** — PR #145 `d485a28`. Both `signalled is False` and `asyncio.TimeoutError` paths return `CodeRunResult(status="abandoned", ...)`. |
| **P10** | **S4-001** | High | ✅ **MERGED** — PR #145 `d485a28`. `_build_loop_warning` returns a `ToolResult` and tool execution is **skipped** when warning fires (Option A from audit). |

### This session — focus

1. **S3-089** — fail-fast on missing `INTERNAL_API_SECRET` in `apps/worker/src/worker/lib/api_client.py`.
2. **S4-008** — repath three Deep Research callbacks; add `POST /api/internal/research/:runId/artifacts` endpoint.

### Deferred (not in this session)

- ~~**S3-052** (open ports / docker-compose)~~ — **closed** on `fix/ralph-reliability-compose`: loopback bind chosen, knobs documented in `hosted-service.md`.
- **S3-021/022/023/024/025** — Drive cluster, deferred until S3-020 token-by-payload landing; full hardening is a multi-day workstream.
- ~~**S3-006** (heartbeat_timeout)~~ — **closed** on `fix/ralph-reliability-compose`: every IngestWorkflow dispatch now carries a heartbeat budget; office activity heartbeats between LibreOffice steps.
- **S3-056** (Live Ingest Viz `startRun` dead) — Plan Phase E flip; tracked there.
- **S6-022** (CI restoration) — needs workflow file design + secrets review; separate operations session.
- **S1-001/002/003**, **S2-001/026** — separate "frontend hardening" batch after this fix wave.

---

## Acceptance for the Top-10 wave

- Each fix lands as **one atomic commit** (TDD: failing test → fix → green → commit).
- After all 10 are in, run `opencairn:post-feature` workflow: build/typecheck/test, code-review, docs.
- Update `docs/contributing/plans-status.md` and audit-completion claims as needed.
- `docs/review/2026-04-28-completion-claims-audit.md` should be cross-referenced if any "✅ CLOSED" claims are touched.
