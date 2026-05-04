# API Contract

Hono 백엔드 API 명세. 프론트엔드는 이 계약에만 의존한다.

---

## Base URL

- Development: `http://localhost:4000`
- Production: `https://api.opencairn.com`

## Authentication

모든 `/api/*` 라우트 (health, auth, share 공개 링크 제외)는 세션 쿠키 필요.

```
Cookie: better-auth.session_token=<token>
```

## Authorization

> 협업 도입 (2026-04-18)으로 모든 리소스 접근은 **권한 계층 검증**을 거친다. 상세: [collaboration-model.md](./collaboration-model.md).

| 리소스 | 최소 역할 | 설명 |
|--------|----------|------|
| Workspace CRUD | workspace role 이상 | `member` / `admin` / `owner` |
| Project CRUD | project role 이상 | `viewer` / `editor`, workspace admin/owner는 자동 통과 |
| Note CRUD | page role 이상 | `viewer` / `editor` / `none`, project role 상속 또는 page override |
| Comment | page `viewer` 이상 (읽기), page `editor` 이상 (작성) | |
| Invite 생성 | workspace `admin` 이상 | |
| 멤버 역할 변경 | workspace `admin` 이상 (owner 제외하고) | |
| 공개 링크 발급 | resource `editor` 이상 | |

각 엔드포인트 표의 **"Auth"** 컬럼에 명시된 최소 역할이 필요하다 (없으면 로그인만으로 충분).

## Response Format

```json
// Success
{ "id": "uuid", "name": "...", ... }

// List
[{ "id": "uuid", ... }, ...]

// Error
{ "error": "Error message" }
```

### Error Codes

| Status | 의미 | 응답 예 |
|--------|------|--------|
| 400 | 유효성 | `{ error: "validation failed", details: [...] }` |
| 401 | 인증 누락/실패 | `{ error: "unauthorized" }` |
| 403 | 권한 없음 | `{ error: "forbidden", resource: "page:uuid" }` |
| 404 | 리소스 없음 (권한 없음과 구분) | `{ error: "not_found" }` |
| 409 | 충돌 (동시 쓰기 등) | `{ error: "conflict", retry_after_ms: 500 }` |
| 429 | Rate limit | `{ error: "rate_limited", retry_after: 30 }` — `Retry-After: 30` 헤더 (단위: 초) |
| 500 | 서버 에러 | `{ error: "internal", request_id: "..." }` |

**권한 없음 vs 리소스 없음**: 사용자가 해당 workspace 멤버가 아니면 **404** 반환(리소스 존재 은닉). 멤버이지만 구체 권한 없으면 **403**.

### API 버전 정책

- 현재 버전: v1 (경로에 버전 없음, v0.1까지는 unversioned).
- Breaking change 시 `/v2/*` 병행 운영 + 6개월 deprecation.

---

## Endpoints

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | No | Health check |

### Auth (Better Auth)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/sign-up/email | No | Email/password signup |
| POST | /api/auth/sign-in/email | No | Email/password login |
| POST | /api/auth/sign-out | Yes | Logout |
| GET | /api/auth/get-session | Yes | Get current session |

### Workspaces

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/workspaces | Yes | 내가 멤버인 모든 워크스페이스 — 응답 `[{ id, slug, name, role }]` | - |
| GET | /api/workspaces/me | Yes | 사이드바 스위처 1회 호출 페이로드 — 응답 `{ workspaces: [{id,slug,name,role}], invites: [{id,workspaceId,workspaceName,workspaceSlug,role,expiresAt}] }`. invites는 현재 사용자의 email에 발급된 pending(미수락+미만료) 초대만. | - |
| POST | /api/workspaces | Yes | 새 workspace 생성 (생성자는 owner, 기본 프로젝트 1개 자동 생성). slug 미지정 시 이름에서 ASCII 파생, 불가/충돌 시 `w-{hex8}` fallback | `{ name, slug? }` |
| GET | /api/workspaces/by-slug/:slug | member | slug로 워크스페이스 조회 — 응답 `{ id, slug, name, role }` (redirect 체인 용) | - |
| GET | /api/workspaces/:workspaceId | member | 워크스페이스 상세 | - |
| PATCH | /api/workspaces/:workspaceId | admin | 이름/slug/plan 변경 | `{ name?, slug?, planType? }` |
| DELETE | /api/workspaces/:workspaceId | owner | 워크스페이스 삭제 (cascade) | - |
| POST | /api/workspaces/:workspaceId/transfer-owner | owner | owner 이전 | `{ newOwnerId }` |

### Workspace Members

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/workspaces/:workspaceId/members | member | 멤버 목록 | - |
| PATCH | /api/workspaces/:workspaceId/members/:userId | admin | 역할 변경 | `{ role: "admin"\|"member"\|"guest" }` |
| DELETE | /api/workspaces/:workspaceId/members/:userId | admin | 멤버 제거 (owner 보호) | - |

### Workspace Invites

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/workspaces/:workspaceId/invites | admin | 이메일 초대 발송 | `{ email, role }` |
| GET | /api/workspaces/:workspaceId/invites | admin | 대기 중 초대 목록 | - |
| DELETE | /api/workspaces/:workspaceId/invites/:id | admin | 초대 취소 | - |
| POST | /api/invites/:token/accept | Yes (로그인) | 초대 수락 | - |
| POST | /api/invites/:token/decline | No | 초대 거절 | - |
| GET | /api/invites/:token | No | 초대 정보 조회 (수락 UI용) — 응답 `{ workspaceId, workspaceName, inviterName, role, email, expiresAt }`. 404 / 410 / 400 `already_accepted`. | - |

### Permissions

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/projects/:id/permissions | project `viewer` | 프로젝트 권한 목록 | - |
| PUT | /api/projects/:id/permissions | project `editor` | 사용자 권한 부여 | `{ userId, role }` |
| DELETE | /api/projects/:id/permissions/:userId | project `editor` | 권한 해제 | - |
| GET | /api/notes/:id/permissions | page `viewer` | 페이지 권한 목록 | - |
| PUT | /api/notes/:id/permissions | page `editor` | 페이지 권한 부여 | `{ userId, role }` |
| DELETE | /api/notes/:id/permissions/:userId | page `editor` | 페이지 권한 해제 | - |

### Projects

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/workspaces/:workspaceId/projects | member | 워크스페이스 내 프로젝트 목록 (권한 필터링됨) | - |
| POST | /api/workspaces/:workspaceId/projects | member | 새 프로젝트 생성 | `{ name, description?, defaultRole? }` |
| GET | /api/projects/:id | project `viewer` | 프로젝트 상세 | - |
| PATCH | /api/projects/:id | project `editor` | 수정 | `{ name?, description?, defaultRole? }` |
| DELETE | /api/projects/:id | workspace `owner`, `admin`, or creator | 삭제 | - |

### Folders

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/folders/by-project/:projectId | project `viewer` | List folders | - |
| POST | /api/folders | project `editor` | Create folder | `{ projectId, parentId?, name }` |
| PATCH | /api/folders/:id | project `editor` | Update folder. `parentId` 변경 시 `moveFolder()`가 ltree 서브트리 전체를 재작성(App Shell Phase 2 Task 11). cross-project 이동 시 400. 스칼라(name/position)는 이동 후 별도 적용. | `{ name?, parentId?, position? }` |
| DELETE | /api/folders/:id | project `editor` | Delete folder | - |

### Tags

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/tags/by-project/:projectId | Yes | List tags | - |
| POST | /api/tags | Yes | Create tag | `{ projectId, name, color? }` |
| POST | /api/tags/:tagId/notes/:noteId | Yes | Tag a note | - |
| DELETE | /api/tags/:tagId/notes/:noteId | Yes | Untag a note | - |
| DELETE | /api/tags/:id | Yes | Delete tag | - |

### Notes (Pages)

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/projects/:projectId/notes | project `viewer` | 노트 목록 (접근 불가 page 필터링) | - |
| GET | /api/notes/search | project `viewer` | 제목 substring 검색 (wiki-link combobox 용, max 10) — `?q=<str>&projectId=<uuid>`, 응답 `[{ id, title, updatedAt }]` | - |
| GET | /api/notes/:id | page `viewer` | 노트 조회 | - |
| GET | /api/notes/:id/file | page `viewer` + `sourceFileKey !== null` | MinIO 오브젝트 스트리밍 (source-mode 뷰어, PDF 등). `Content-Type`은 S3 `statObject`에서. 400 non-UUID / 403 read 없음 또는 note 없음(존재 누수 방지) / 404 note는 있으나 `sourceFileKey`가 없을 때. | - |
| GET | /api/notes/:id/data | page `viewer` | `{ data: <JSON> \| null }` — `content_text`를 JSON 파싱. 비-JSON/빈 문자열은 `null` (500 아님). data-mode 뷰어용. 400 non-UUID / 403 read 없음 또는 note 없음. | - |
| POST | /api/projects/:projectId/notes | project `editor` | 노트 생성 | `{ folderId?, title?, content?, type?, inheritParent? }` |
| PATCH | /api/notes/:id | page `editor` | 메타 수정. `content`는 Yjs canonical(Plan 2B에서 body에서 strip), `folderId`도 이 경로에서 제거됨 — 이동은 `/:id/move` 사용(App Shell Phase 2 Task 11, cross-project 스코프 누수 방지). 서버가 `content_text`를 텍스트 추출로 자동 파생(FTS 용). | `{ title?, inheritParent? }` |
| PATCH | /api/notes/:id/move | page `editor` | 폴더 간 이동(또는 프로젝트 루트로). `moveNote()`가 cross-project 타겟을 거절. | `{ folderId: uuid \| null }` |
| DELETE | /api/notes/:id | page `editor` | 소프트 삭제 | - |

### Agent Files

Agent-generated files are first-class project objects stored in MinIO/R2 and surfaced in the project tree as `kind:"agent_file"`. They are not Plate notes, but may link to a source note after ingest or to a Canvas note after code materialization.

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/agent-files | project `editor` | Create 1-5 stored files from inline UTF-8 content or base64 bytes. Supported kinds include `markdown`, `text`, `latex`, `html`, `code`, `json`, `csv`, `xlsx`, `pdf`, `docx`, `pptx`, `image`, and `binary`. Uploads bytes, inserts `agent_files`, optionally starts ingest, emits tree event. | `{ projectId, source?, threadId?, messageId?, files: [{ filename, title?, kind?, mimeType?, content? XOR base64?, folderId?, startIngest? }] }` |
| GET | /api/agent-files/:id | project `viewer` | Read metadata for an undeleted generated file. | - |
| GET | /api/agent-files/:id/file | project `viewer` | Stream original bytes with safe `Content-Disposition`; inline for previewable kinds, attachment for opaque binaries. | - |
| GET | /api/agent-files/:id/compiled | project `viewer` | Stream compiled derivative, currently LaTeX PDF when `compiled_object_key` exists. | - |
| PATCH | /api/agent-files/:id | project `editor` | Rename title/filename or move folder. Never overwrites original bytes. | `{ title?, filename?, folderId? }` |
| POST | /api/agent-files/:id/versions | project `editor` | Create a new immutable version row with a new object key. | `{ title?, filename?, content? XOR base64?, startIngest? }` |
| POST | /api/agent-files/:id/ingest | project `editor` | Start or retry existing `IngestWorkflow` against the stored object. | - |
| POST | /api/agent-files/:id/compile | project `editor` | Compile LaTeX through Tectonic when `FEATURE_TECTONIC_COMPILE=true`; otherwise `409 { error:"compile_disabled" }`. | - |
| POST | /api/agent-files/:id/canvas | project `editor` | Materialize code/html source into a Canvas note and link `agent_files.canvas_note_id`. Execution remains browser sandboxed. | - |
| DELETE | /api/agent-files/:id | project `editor` | Soft delete generated file row; stored bytes remain immutable. | - |

### Ingest

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/ingest/upload | Yes | Upload file for ingestion (max `MAX_UPLOAD_BYTES`, 기본 200MB; 이미지 20MB, A/V 500MB) | `multipart/form-data: file, projectId, noteId?` |
| POST | /api/ingest/url | Yes | Ingest URL (웹 or YouTube — `url` 호스트로 분기) | `{ url, projectId, noteId? }` |
| GET  | /api/ingest/status/:workflowId | Yes | Temporal workflow 상태 조회 (COMPLETED, RUNNING, FAILED 등) | — |

> 참고: 별도의 `/api/ingest/youtube` 전용 엔드포인트는 없음. YouTube URL은 `/api/ingest/url`이 mimeType으로 분기하여 `yt-dlp` 또는 Gemini YouTube URL 직접 처리.

### Internal (worker → API)

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /internal/source-notes | `X-Internal-Secret` | 파싱된 텍스트로 source 노트 생성 + (선택) Compiler 트리거 | `{ userId, projectId, parentNoteId?, title, content, sourceType, objectKey?, sourceUrl?, mimeType, triggerCompiler }` |
| POST | /internal/test-seed | `X-Internal-Secret` + `NODE_ENV !== "production"` | E2E 전용 — 유저 + 워크스페이스 + 프로젝트 + "Welcome" 노트를 생성하고 서명된 Better Auth 세션 쿠키를 반환. 응답: `{ userId, wsSlug, workspaceId, projectId, noteId, sessionCookie, cookieName, cookieValue, expiresAt }`. 프로덕션에서는 403. | `{}` |
| GET | /internal/projects/:id/topics | `X-Internal-Secret` | 프로젝트의 top 30 concepts (note-link count desc)를 `[{ topic_id, name, concept_count }]`로 반환. `list_project_topics` 툴 (Agent Runtime v2 · A)의 Layer 3 hierarchical retrieval entry. | — |

`X-Internal-Secret` 헤더는 `INTERNAL_API_SECRET` env와 일치해야 하며, 불일치 시 `401`.

### Deep Research (Phase C, feature-flag `FEATURE_DEEP_RESEARCH`)

Public — Better Auth 세션 + `canWrite`(project, 생성/변경) 또는 `canRead`(workspace, 조회/스트림). 기본 활성화이며, `FEATURE_DEEP_RESEARCH=false` 시 모든 경로 404. `billingPath: "managed"`는 `FEATURE_MANAGED_DEEP_RESEARCH` 필요 (off 시 403 `{error:"managed_disabled"}`).

| Method | Path                                     | Body / Query                | Response |
|--------|------------------------------------------|-----------------------------|----------|
| POST   | `/api/research/runs`                     | `createResearchRunSchema`   | `201 { runId }` |
| GET    | `/api/research/runs?workspaceId=&limit=` | `listRunsQuerySchema`       | `200 { runs: ResearchRunSummary[] }` (newest-first, default limit 50) |
| GET    | `/api/research/runs/:id`                 | —                           | `200 ResearchRunDetail` (run + turns asc + artifacts asc) |
| POST   | `/api/research/runs/:id/turns`           | `addTurnSchema`             | `202 { turnId }` — inserts `user_feedback` turn + signals workflow |
| PATCH  | `/api/research/runs/:id/plan`            | `updatePlanSchema`          | `200 { turnId }` — inserts `user_edit` turn, DB only (no signal) |
| POST   | `/api/research/runs/:id/approve`         | `approvePlanSchema`         | `202 { approved: true }` — resolves override > user_edit > plan_proposal, signals `approve_plan` |
| POST   | `/api/research/runs/:id/cancel`          | —                           | `202 { cancelled: true }` / `{ cancelled: true, alreadyTerminal: true }` |
| GET    | `/api/research/runs/:id/stream`          | —                           | `200 text/event-stream`; events: `status`, `turn`, `artifact`, `error`, `done`. 2s poll, 70min cap. |

Internal (`X-Internal-Secret`) — Phase B worker의 `persist_report` 호출 경로:

| Method | Path                                     | Body | Response |
|--------|------------------------------------------|------|----------|
| POST   | `/api/internal/notes`                    | legacy ingest shape OR `{idempotencyKey, projectId, workspaceId, userId, title, plateValue}` | `201 { id, noteId }` — idempotencyKey가 UUID이고 기존 `researchRuns.id` 매칭 시 back-fill → 재시도 idempotent |
| POST   | `/api/internal/research/image-bytes`     | `{ url }` | `200 { base64, mimeType }` / `404` (artifact 매칭/base64 없음) |

Cross-workspace 접근은 **404** (존재 은닉). 상태별 쓰기 금지는 `409 { error:"invalid_state", status }` — `planning`/`awaiting_approval` 외 상태에서의 turns/plan/approve 거절.

#### Doc-Editor (Plan 11B Phase A)

Public — Better Auth 세션 + `canWrite(noteId)`. `FEATURE_DOC_EDITOR_SLASH=false` 시 라우터 전체 404 (Hono `use("*", ...)` 게이트, research.ts 패턴). 클라이언트 측 슬래시 메뉴는 `NEXT_PUBLIC_FEATURE_DOC_EDITOR_SLASH=true` 일 때만 AI 섹션을 렌더 — 두 플래그가 따로 가는 것은 클라이언트 캐시 stale 시 메뉴는 보이지만 API 가 404 응답하도록 fail-safe 하게 두기 위함.

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/notes/:noteId/doc-editor/commands/:command` | `{ selection: { blockId, start, end, text ≤4000 }, language?, documentContextSnippet ≤4000 }` | `200 text/event-stream` — events: `doc_editor_result` (`{ output_mode:"diff", payload: { hunks[], summary } }`), `cost` (`{ tokens_in, tokens_out, cost_krw }`), `error` (`{ code: "llm_failed"\|"selection_race"\|"command_unknown"\|"internal", message }`), `done`. `command` enum: `improve`/`translate`/`summarize`/`expand` (Phase A). `/cite` + `/factcheck` ship in Phase B (Research/factcheck builtin tools). Audit row written to `doc_editor_calls` on every terminal path (ok/failed/cancelled). Client `AbortController` 가 fetch 를 끊으면 `stream.onAbort` → `handle.cancel()` 가 워크플로를 cancel 하고 `error_code='cancelled'` 로 audit. `language` 는 `/translate` 에서만 의미. `tokens_in`/`out` 은 zero placeholder until `LLMProvider.Usage` (Plan 12 follow-up). |

Phase B adds `cite` and `factcheck` behind `FEATURE_DOC_EDITOR_RAG`, layered on
`FEATURE_DOC_EDITOR_SLASH`. `cite` returns the same `output_mode:"diff"` payload
with citation markers and references. `factcheck` returns
`output_mode:"comment"` with `{ claims[] }`; the API inserts one `comments` row
per claim using the triggering user as `authorId` and stores agent metadata in
`bodyAst.agentKind="doc_editor"`, `bodyAst.command="factcheck"`,
`bodyAst.verdict`, `bodyAst.evidence`, `bodyAst.range`, and
`bodyAst.triggeredBy`. Phase B SSE also includes `tool_progress` and
`factcheck_comments_inserted`.

#### Tool-calling loop (worker runtime, Agent Runtime v2 · A)

`run_with_tools(...)` (`apps/worker/src/runtime/loop_runner.py`)은 Temporal activity 내부에서 호출되는 러너. 시그니처는 `provider, initial_messages, tools, tool_context (dict), config: LoopConfig | None, hooks: LoopHooks | None`. 한 activity = 한 loop이며 `LoopConfig.max_turns (default 8)`, `max_tool_calls (12)`, `max_total_input_tokens (200_000)`, per-tool timeout, 소프트 루프 detection으로 bounded. Provider가 tool calling을 지원하지 않으면 `ToolCallingNotSupported` fail-fast.

### Chat Threads (App Shell Phase 4 agent panel)

> ✅ **Status: Phase 4 merged + Plan 11B Phase A second commit — Agent panel now calls real LLM.** `apps/api/src/lib/agent-pipeline.ts` no longer returns the `(stub agent response to: <input>)` echo (audit Tier 1 #1 closure); `defaultRunAgent` delegates to `chat-llm.runChat()` against `gemini-2.5-flash` with workspace-scoped retrieval, and `chat_messages.token_usage` is populated from provider-reported `tokensIn`/`tokensOut` + `model` (`provider="gemini"`). `AGENT_STUB_EMIT_SAVE_SUGGESTION` env removed; `save_suggestion` chunks are now produced by the LLM-fence parser at `apps/api/src/lib/save-suggestion-fence.ts` (audit Tier 1 #3 closure).

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET    | /api/threads | Better Auth + workspace 멤버 | List threads for a workspace | `?workspaceId=` |
| POST   | /api/threads | Better Auth + workspace 멤버 | Create thread | `{ workspaceId, title? }` |
| PATCH  | /api/threads/:id | owner | Update thread title | `{ title }` |
| DELETE | /api/threads/:id | owner | Delete thread (cascade messages + feedback) | - |
| GET    | /api/threads/:id/messages | owner | List messages (oldest → newest) | - |
| POST   | /api/threads/:id/messages | owner | Send message. SSE order: `user_persisted` (`{ id }`) → `agent_placeholder` (`{ id }`) → (`status` / `thought` / `text` (delta) / `citation` / `usage` / `save_suggestion?`)\* → `error?` → `done` (`{ id, status }`). Single canonical `done` is emitted by the route after persistence — `runChat`'s sentinel `done` is suppressed. Real `gemini-2.5-flash`; citations from workspace-scoped RAG retrieval. On runtime exception (or `LLMNotConfiguredError` surfaced via `chat-llm`'s `error` chunk) the agent row is finalized with `status='failed'` and an `error` SSE frame is forwarded. `usage` payload uses provider-reported `tokensIn`/`tokensOut`/`model` and is hoisted into `chat_messages.token_usage` by `finalizeAgentMessage`. | `{ content, scope?, mode? }` |
| GET    | /api/message-feedback | owner | List feedback rows for current user (filtered by `messageId`) | `?messageId=` |
| POST   | /api/message-feedback | owner | Upsert feedback (one row per `(message_id, user_id)`, `sentiment ∈ {up,down}`) | `{ messageId, sentiment, comment? }` |

### Chat

> ✅ **Status: Plan 11A merged + Plan 11B Phase A second commit — Chat Scope Foundation with real LLM.** 라우트는 `apps/api/src/routes/chat.ts`에 구현되어 있고 DB는 `conversations`/`conversation_messages`/`pinned_answers` (migration 0029, `scope_type` / `rag_mode` / `conversation_message_role` enums). `/message` 는 더 이상 placeholder 가 아니다 — `chat-llm.runChat()` 가 `gemini-2.5-flash` 를 호출하고, retrieval 은 `attachedChips` + `ragMode` 를 읽어 workspace-scoped RAG 로 답변한다. Token 회계는 provider 가 보고한 `usageMetadata` (promptTokens/candidatesTokens) 를 그대로 user/assistant row 에 분배해 `conversation_messages.tokensIn`/`tokensOut` + `conversations.totalCostKrw` 에 반영한다 (audit Tier 1 #2 closure). `LLMNotConfiguredError` 는 SSE `event: error` (`code: "llm_not_configured"`) 로 매핑되어 misconfigured operator 에게 가시 신호. Pin은 인용 가시성 델타 검사(409 → /pin/confirm) 포함.

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/chat/conversations | workspace 멤버 | List owner's conversations | `?workspaceId=` |
| POST | /api/chat/conversations | workspace 멤버 | Create conversation (auto-attach scope chip) | `{ workspaceId, scopeType: 'page'\|'project'\|'workspace', scopeId, attachedChips: AttachedChip[], ragMode?: 'strict'\|'expand', memoryFlags: { l3_global, l3_workspace, l4, l2 }, title? }` |
| GET | /api/chat/conversations/:id | owner | Get one conversation | - |
| PATCH | /api/chat/conversations/:id | owner | Update ragMode / memoryFlags / title | `{ ragMode?, memoryFlags?, title? }` |
| POST | /api/chat/conversations/:id/chips | owner | Add chip (workspace boundary enforced for page/project/workspace; memory:l* accepted as-is) | `{ type: ChipType, id }` |
| DELETE | /api/chat/conversations/:id/chips/:chipKey | owner | Remove chip by composite key `<type>:<id>` (lastIndexOf separator handles `memory:l*` types) | - |
| POST | /api/chat/message | owner | Send message. SSE: `delta` (text deltas) / `save_suggestion?` (LLM fence parsed by `save-suggestion-fence.ts`) / `cost` (`{ messageId, tokensIn:0, tokensOut, costKrw }` for assistant row) / `error` (`{ code: 'llm_not_configured'\|'llm_failed', message }` on `LLMNotConfiguredError` or runtime exception) / `done`. Real `gemini-2.5-flash` via `chat-llm.runChat()`; citations from workspace-scoped RAG retrieval. `usage` payload uses provider-reported `tokensIn`/`tokensOut`/`model` (no more `Math.ceil(len/4)` estimate). | `{ conversationId, content }` |
| POST | /api/chat/messages/:id/pin | owner of convo + write on target page | Pin assistant message to a page block. Returns `200 { pinned:true }` if no permission delta, otherwise `409 { requireConfirm:true, warning: { hiddenSources, hiddenUsers } }` | `{ noteId, blockId }` |
| POST | /api/chat/messages/:id/pin/confirm | owner of convo + write on target page | Force-pin after the user accepts the visibility warning (records `reason='user_confirmed_permission_warning'` on the row) | `{ noteId, blockId }` |
| GET | /api/search/scope-targets | workspace 멤버 | Chip combobox backing search (pages + projects matching `q`, per-row canRead filtered) | `?workspaceId=&q=` |

### Knowledge Graph

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/graph/concepts/by-project/:projectId | Yes | List concepts | - |
| GET | /api/graph/edges/by-project/:projectId | Yes | List edges | - |
| POST | /api/graph/edges | Yes | Create edge | `{ sourceId, targetId, relationType }` |
| DELETE | /api/graph/edges/:id | Yes | Delete edge | - |
| GET | /api/graph/traverse/:conceptId | Yes | N-hop traversal | `?depth=3` |

### Tools (Tool Template)

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/tools/templates | Yes | List available templates | - |
| POST | /api/tools/execute | Yes | Execute tool template | `{ templateId, scope, scopeIds[] }` |

### Flashcards

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/flashcards/due | Yes | Get due flashcards | `?projectId` |
| POST | /api/flashcards/review | Yes | Submit review | `{ flashcardId, rating }` |

### Jobs

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/jobs | Yes | List user's jobs | `?status=running` |
| GET | /api/jobs/:id | Yes | Get job status + progress | - |

### Settings

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/settings/usage | Yes | Get current usage | - |
| GET | /api/settings/plan | Yes | Get current plan | - |
| POST | /api/settings/api-key | Yes | Set BYOK Gemini API key | `{ apiKey }` |
| DELETE | /api/settings/api-key | Yes | Remove BYOK key | - |

### MCP Client (Phase 1, feature-flag `FEATURE_MCP_CLIENT`)

Public API is user-owned, not workspace-owned. When `FEATURE_MCP_CLIENT=false`,
all routes below return 404. Responses never include plaintext auth header
values; summaries expose `hasAuth` only.

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/mcp/servers | Yes | List current user's MCP server registrations. | - |
| POST | /api/mcp/servers | Yes | Register one streamable-HTTP MCP server. Server slug is generated from `displayName`; route auto-runs `list_tools` and rejects unreachable or >50-tool servers. | `{ displayName, serverUrl, authHeaderName?, authHeaderValue? }` |
| PATCH | /api/mcp/servers/:id | owner | Update display name/auth header/status. URL changes are intentionally rejected; create a new server instead. | `{ displayName?, authHeaderName?, authHeaderValue?, status? }` |
| DELETE | /api/mcp/servers/:id | owner | Delete one registration. Cross-user IDs return 404. | - |
| POST | /api/mcp/servers/:id/test | owner | Run `list_tools` once and update `lastSeenToolCount`, `lastSeenAt`, and auth-expired status. | - |

### MCP Server Read-Only Phase 1 (feature-flag `FEATURE_MCP_SERVER`)

OpenCairn can expose workspace knowledge as a read-only MCP Streamable HTTP
server. When `FEATURE_MCP_SERVER=false`, `/api/mcp` and `/api/mcp/tokens*`
return 404. The existing MCP client routes at `/api/mcp/servers*` remain
separate and keep their own `FEATURE_MCP_CLIENT` flag.

Token management uses the user's Better Auth session and requires workspace
`owner` or `admin`. Plaintext tokens are returned once on create and are never
stored; the database stores only a SHA-256 hash and a redacted prefix.

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | `/.well-known/oauth-protected-resource` | No | OAuth Protected Resource Metadata for the OpenCairn MCP resource server. | - |
| GET | `/.well-known/oauth-protected-resource/api/mcp` | No | Path-specific protected resource metadata for `/api/mcp`. | - |
| GET/POST/DELETE | `/api/mcp` | MCP bearer token | Streamable HTTP MCP endpoint. Exposes `search_notes`, `get_note`, and `list_projects`; all tools are read-only and scoped to the token workspace. | MCP JSON-RPC |
| GET | `/api/mcp/tokens?workspaceId=` | workspace `admin` | List token metadata for a workspace. Response omits plaintext token values. | - |
| POST | `/api/mcp/tokens` | workspace `admin` | Create one read-only workspace token. Response includes `token` exactly once. | `{ workspaceId, label, expiresAt? }` |
| DELETE | `/api/mcp/tokens/:id` | workspace `admin` | Revoke a token by setting `revokedAt`. | - |

MCP tools:

| Tool | Input | Output |
|------|-------|--------|
| `search` | `{ query }` | OpenAI/ChatGPT data-only alias: `{ results: [{ id, title, url, text, metadata }] }` as JSON text content. Calls the same search service as `search_notes`. |
| `fetch` | `{ id }` | OpenAI/ChatGPT data-only alias: `{ id, title, url, text, metadata }` as JSON text content. Calls the same note service as `get_note`; `text` preserves note formatting. |
| `search_notes` | `{ query, limit?, projectId? }` | `{ hits: [{ noteId, title, projectId, projectName, snippet, sourceType, sourceUrl, updatedAt, vectorScore, bm25Score, rrfScore }] }` |
| `get_note` | `{ noteId }` | `{ noteId, title, projectId, projectName, sourceType, sourceUrl, contentText, updatedAt }` |
| `list_projects` | `{ limit? }` | `{ projects: [{ projectId, name, description, updatedAt }] }` |

Interop docs for Claude Code, Codex, ChatGPT/OpenAI Apps, hosted endpoint
readiness, and OAuth Phase 2-B gaps live in
[`mcp-server.md`](./mcp-server.md).

### Connector Foundation (feature-flag `FEATURE_CONNECTOR_PLATFORM`)

Connector routes are hosted-SaaS-first and workspace-scoped at the source grant
layer. Responses never include plaintext token material; account summaries
expose token presence as booleans only.

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | `/api/connectors/accounts` | Yes | List current user's connector accounts. Token values are redacted. | - |
| GET | `/api/connectors/sources?workspaceId=` | workspace writer | List connector sources granted to a workspace. | - |
| POST | `/api/connectors/sources` | workspace writer + account owner | Grant one connector source to a workspace/project. Emits `source.granted` audit event. | `{ workspaceId, projectId?, accountId, provider, sourceKind, externalId, displayName, syncMode?, permissions? }` |
| GET | `/api/connectors/audit?workspaceId=` | workspace writer | List connector audit events for a workspace. | - |

Provider-specific connect/import routes are implemented in follow-up plans.
Existing `/api/integrations/google`, `/api/import/*`, and `/api/mcp/servers`
remain available until their compatibility bridges are complete.

### Billing

> **결제 레일 TBD (사업자등록 후 확정, 현재 BLOCKED)**. 후보: Toss Payments / 포트원(아임포트) / Stripe. 아래 스키마는 provider-agnostic core — 구체 PSP 웹훅 이벤트 이름은 확정 후 치환.

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/billing/subscribe | Yes | Create billing-key subscription | `{ plan: "pro" \| "byok" }` |
| POST | /api/billing/cancel | Yes | Cancel active subscription (현행 청구 주기 종료 시) | — |
| GET  | /api/billing/subscription | Yes | Get current subscription state | — |
| PUT  | /api/billing/byok-key | Yes | Save encrypted BYOK Gemini API key | `{ geminiKey }` |
| POST | /api/billing/refund-request | Yes | 환불 요청 접수 (정책은 Plan 9 참조) | `{ reason }` |
| POST | /api/billing/webhook | No | PG webhook handler (결제 승인/환불/빌링키 발급 등) | provider event |

> 참고: 결제 수단은 **사업자등록 후 결정 (BLOCKED)**. 그 전까지 provider-agnostic core만 구현.

### Comments

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/notes/:noteId/comments | page `viewer` | 페이지 코멘트 트리 (thread 구조) | - |
| POST | /api/notes/:noteId/comments | page `viewer` (기본) / `editor` if anchored | 코멘트 작성 | `{ body, parentId?, anchorBlockId? }` |
| PATCH | /api/comments/:id | 본인 작성자 | 수정 | `{ body }` |
| DELETE | /api/comments/:id | 본인 작성자 or page `editor` | 삭제 | - |
| POST | /api/comments/:id/resolve | page `editor` or 스레드 참여자 | thread resolve | - |
| POST | /api/comments/:id/reopen | page `editor` | resolve 되돌리기 | - |

### Mentions

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/mentions/search | Yes | `@` combobox 검색 | `?q=&type=user\|page\|concept&workspaceId=` |

### Notifications

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/notifications | Yes | 내 알림 목록 | `?unread=true&limit=50&cursor=` |
| GET | /api/notifications/stream | Yes | SSE 실시간 스트림 | — (event-stream) |
| POST | /api/notifications/mark-read | Yes | 일괄 읽음 | `{ ids: [] }` or `{ all: true }` |
| GET | /api/notification-preferences | Yes | 5개 kind effective 선호도 (defaults merged). | — |
| PUT | /api/notification-preferences/:kind | Yes | 한 kind 선호도 upsert. `:kind ∈ {mention,comment_reply,share_invite,research_complete,system}` | `{ emailEnabled: boolean, frequency: 'instant'\|'digest_15min'\|'digest_daily' }` |
| GET | /api/notification-preferences/profile | Yes | 이메일 본문 locale + digest_daily timezone. | — |
| PUT | /api/notification-preferences/profile | Yes | 부분 업데이트. `locale ∈ {ko,en}`, `timezone` ∈ SUPPORTED_TIMEZONES (packages/shared). | `{ locale?, timezone? }` |

### Activity Feed

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/activity | workspace `member` | 통합 활동 피드 | `?workspaceId=&projectId=&actor=&actorType=&since=&limit=&cursor=` |

### Public Share

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/share | resource `editor` | 공개 링크 발급 | `{ scopeType: "note"\|"project", scopeId, role: "viewer"\|"commenter", password?, expiresAt? }` |
| GET | /api/share/my | Yes | 내가 발급한 링크 목록 | - |
| DELETE | /api/share/:id | 발급자 or resource `editor` | 링크 revoke | - |
| GET | /s/:token | No | 공개 페이지 렌더링 (Next.js 라우트, Hono 프록시 아님) | - |
| POST | /api/share/:token/verify-password | No | 암호 확인 | `{ password }` |

### Guest Management

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/workspaces/:workspaceId/guests | workspace `admin` | guest 목록 + 공유된 리소스 | - |
| POST | /api/workspaces/:workspaceId/guests/:userId/resources | workspace `admin` | guest에게 특정 리소스 공유 | `{ type, id, role }` |

### Hocuspocus WebSocket

별도 서비스 (기본 port 1234). `/ws/pages/<noteId>` URL로 연결.

- Cookie: `better_auth.session_token` 전달 (WebSocket upgrade 시)
- 서버가 `canWrite(user, note)` 검증 → 실패 시 연결 거부 또는 readOnly 세션
- Yjs update 메시지는 CRDT protocol
- Awareness 메시지로 presence 공유 (user, cursor)

### Code Agent (Plan 7 Phase 2, feature-flag `FEATURE_CODE_AGENT`)

Public — Better Auth 세션 + canvas note 소유자. `FEATURE_CODE_AGENT=false` 시 모든 경로 404.

| Method | Path                              | Auth | Description / Body |
|--------|-----------------------------------|------|--------------------|
| POST   | /api/code/run                     | Yes  | Body: `{ noteId, prompt, language }` → `{ runId }`. 409 `notCanvas` (note `source_type` ≠ `canvas`) / `wrongLanguage` (note `canvas_language` 와 body `language` 불일치). Temporal `CodeAgentWorkflow` start. |
| GET    | /api/code/runs/:runId/stream      | Yes  | SSE. Owner-only. `code_runs.status` + `code_turns` 폴링. Events: `queued` / `turn_complete` / `awaiting_feedback` / `done` / `error`. Keep-alive comment frames every 2s. |
| POST   | /api/code/feedback                | Yes  | Body: `{ runId, kind: "error"\|"ok"\|"cancel", error?, stdout? }`. 409 `alreadyTerminal` if run 종료. Temporal `client_feedback` signal forward. |

Internal worker callbacks (`X-Internal-Secret`, `NODE_ENV !== "production"` 또는 secret 일치):

| Method | Path                                       | Notes |
|--------|--------------------------------------------|-------|
| POST   | /api/internal/code/turns                   | Worker → API. Idempotent on `(run_id, seq)` UNIQUE. |
| PATCH  | /api/internal/code/runs/:id/status         | Worker → API. 8-state allow-list (`queued`/`running`/`awaiting_feedback`/`completed`/`failed`/`cancelled`/`abandoned`/`max_turns`). |

### Canvas (Plan 7 Phase 2)

| Method | Path                            | Auth   | Description / Body |
|--------|---------------------------------|--------|--------------------|
| POST   | /api/canvas/from-template       | Yes    | 501 `templatesNotAvailable` until Plan 6 lands templates. (Reserved interface — `{ templateId, variables }`.) |
| POST   | /api/canvas/output              | page `editor` | `multipart/form-data: file, noteId, contentHash`. ≤2MB png/svg, idempotent on `(noteId, contentHash)` via `canvas_outputs_note_hash_unique`. 413 `outputTooLarge` / 400 `outputBadType`. → MinIO `canvas-outputs/<workspaceId>/<noteId>/<contentHash>.{png\|svg}` + `canvas_outputs` row. |
| GET    | /api/canvas/outputs?noteId=     | page `viewer` | List by `noteId` (DESC). |
| GET    | /api/canvas/outputs/:id/file    | page `viewer` | Streams the binary from MinIO (`Content-Type` from row). |
| GET    | /api/canvas/sessions/:id        | Yes    | (Reserved — Phase 3.) |

### Synthesis Export (Plan 2026-04-27, feature-flag `FEATURE_SYNTHESIS_EXPORT`)

> ✅ **Status:** Phases A–F complete on `feat/plan-synthesis-export`. Long-form export pipeline producing LaTeX `.tex`, LaTeX→PDF (Tectonic Pro tier, gated by `FEATURE_TECTONIC_COMPILE`), DOCX (`apps/worker/.../activities/synthesis_export/docx.py` via `python-docx`), PDF (Playwright Chromium headless), and Markdown from a fan-out of `note` / `s3_object` / `dr_result` sources. Worker pipeline: `fetch-source → synthesize → compile-document` activities under `SynthesisExportWorkflow` (`apps/worker/src/worker/workflows/synthesis_export_workflow.py`). Tectonic compile path runs in a separate FastAPI MSA (`apps/tectonic`, `profiles: ["pro"]` in `docker-compose.yml`) with xelatex + kotex + Nanum/Noto CJK fonts. Public router lives in `apps/api/src/routes/synthesis-export.ts`; `FEATURE_SYNTHESIS_EXPORT=false` → `use("*")` returns `404 not_found` on every path. Workspace-scoped visibility (every workspace editor can read all runs in the workspace, mirroring Deep Research).

Public — Better Auth session + `canWrite(workspace)` for create/list/detail/document/resynthesize/delete. SSE stream uses the same auth gate; `runs/:id/stream` re-checks ownership before opening the connection.

| Method | Path                                            | Auth | Description / Body | Response |
|--------|-------------------------------------------------|------|--------------------|----------|
| POST   | /api/synthesis-export/run                       | workspace `member` (write) | `createSynthesisRunSchema` (see Types) — `{ workspaceId, projectId?, format: "latex"\|"docx"\|"pdf"\|"md", template: "ieee"\|"acm"\|"apa"\|"korean_thesis"\|"report", userPrompt (≤4000), explicitSourceIds[] (≤50 uuid), noteIds[] (≤50 uuid), autoSearch }`. Run row pre-inserted with `crypto.randomUUID()` + `workflowId` to close the orphan-workflow window if the Temporal `start` races. | `200 { runId }` |
| GET    | /api/synthesis-export/runs                      | workspace `member` (write) | `?workspaceId=` (uuid required, 400 if missing). Newest-first, hard limit 50. | `200 { runs: SynthesisRunSummary[] }` |
| GET    | /api/synthesis-export/runs/:id                  | workspace `member` (write) | Detail. `id` must be uuid (else 404 to avoid existence leak). | `200 SynthesisRunDetail` (run + sources asc + documents desc) |
| GET    | /api/synthesis-export/runs/:id/document         | workspace `member` (write) | Streams primary document binary from MinIO (`Content-Type` from S3 `statObject`). 404 if the run has no completed document yet. | `200 <binary>` |
| POST   | /api/synthesis-export/runs/:id/resynthesize     | workspace `member` (write) | `resynthesizeSchema` (`{ userPrompt }`). Forks a new run from the previous one's `(workspaceId, projectId, format, template, autoSearch)` envelope; `explicitSourceIds`/`noteIds` reset to `[]`. | `200 { runId }` (new id) |
| DELETE | /api/synthesis-export/runs/:id                  | workspace `member` (write) | Cancels the workflow (best-effort — terminal workflows are tolerated) **and** deletes the run row. The DB row is the source of truth for "this run no longer exists from the user's POV." | `200 { ok: true }` |
| GET    | /api/synthesis-export/runs/:id/stream           | workspace `member` (write) | SSE. Polls `synthesis_runs` every 2s (followup #7: switch to Redis pub/sub). Closes the connection on terminal status (`completed`/`failed`/`cancelled`) or after a 15-minute orphan window. Headers: `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. | `200 text/event-stream` |

#### SSE event schema (`synthesisStreamEventSchema`, discriminated on `kind`)

Defined in `packages/shared/src/synthesis-types.ts`. Frames are emitted in monotonically-advancing order; clients drive a state machine off `kind`:

| `kind`             | Payload                                                                  | Notes |
|--------------------|--------------------------------------------------------------------------|-------|
| `queued`           | `{ runId: uuid }`                                                        | Always the first frame. Mirrors the row's `pending` status. |
| `fetching_sources` | `{ count: int ≥0 }`                                                      | Final source count after `fetch-source` activity completes. |
| `synthesizing`     | `{ thought?: string }`                                                   | Optional reflection text from the synthesis tool-loop; UI is free to ignore. |
| `compiling`        | `{ format: "latex"\|"docx"\|"pdf"\|"md" }`                              | Echoes the run format; Tectonic-PDF emits this once. |
| `done`             | `{ docUrl: string, format, sourceCount: int, tokensUsed: int }`          | Terminal happy path. `docUrl` is a same-origin `/api/synthesis-export/runs/:id/document` link, not a presigned S3 URL. |
| `error`            | `{ code: string }`                                                       | Terminal failure. `code` is one of `llm_failed` / `compile_failed` / `tectonic_unavailable` / `internal` (extensible). |

> Workflow-level `failed`/`cancelled` flips into the DB are tracked as **followup #1** (`docs/contributing/synthesis-export-followups.md`) — until then, hard worker crashes only surface via the 15-minute orphan window.

#### Worker → API internal callbacks (`X-Internal-Secret`, mounted under `/api/internal`)

Worker activities call back via `X-Internal-Secret`. Field names are snake_case in the wire payload to match the worker's Pydantic schemas; the API normalises into Drizzle column names internally.

| Method | Path                                       | Body | Response |
|--------|--------------------------------------------|------|----------|
| POST   | /api/internal/synthesis-export/sources     | `{ run_id, rows: [{ source_id, kind: "s3_object"\|"note"\|"dr_result", title, token_count, included }] }` | `200 { ok: true }` |
| POST   | /api/internal/synthesis-export/documents   | `{ run_id, format: "latex"\|"docx"\|"pdf"\|"md"\|"bibtex"\|"zip", s3_key, bytes }` | `200 { ok: true }` |
| PATCH  | /api/internal/synthesis-export/runs/:id    | `{ status?: synthesisStatusValues, tokens_used? }` (empty body returns `{ok:true}` no-op; 404 if run id unknown) | `200 { ok: true }` |
| POST   | /api/internal/synthesis-export/compile     | `{ run_id, format: "docx"\|"pdf"\|"md", output: SynthesisOutputJson }` — runs the docx/pdf/md compilers in-process and uploads to MinIO at `synthesis/runs/<run_id>/document.<ext>`. **LaTeX**/**Tectonic** path is owned by the worker, not this API. | `200 { s3Key, bytes }` |
| POST   | /api/internal/synthesis-export/fetch-source | `{ source_id, kind: "s3_object"\|"note"\|"dr_result" }` — note: direct lookup; s3_object: looks up the backfilled note via `notes.source_file_key` and falls back to a placeholder body so the run can still proceed; dr_result: `501 kind_not_supported` (followup #3). | `200 { id, title, body, kind }` / `404` / `501` |
| POST   | /api/internal/synthesis-export/auto-search | `{ workspace_id, query, limit≤20=10 }` — currently returns `{ hits: [] }` (followup #2). | `200 { hits: [] }` |

> `apps/tectonic` is a separate MSA. Its public surface (`POST /compile`, `GET /healthz`) is consumed only by the worker, not by `apps/api` — see `apps/tectonic/server.py` and `apps/worker/src/worker/activities/synthesis_export/compile.py` `_post_tectonic`.

---

## Types

### ChipRef (Chat scope attachment)

Agent chat scope (Plan 11A)에서 conversation에 attach되는 칩 참조:

```ts
type ChipRef =
  | { type: 'page'; id: string }
  | { type: 'project'; id: string }
  | { type: 'workspace'; id: string }
  | { type: 'document'; id: string };  // uploaded source
```

`POST /api/chat/conversations` 의 `attached_chips` 필드와 `POST /api/chat/message` 컨텍스트 payload에서 동일하게 사용. 칩이 가리키는 리소스는 호출 사용자 `canRead` 통과가 선결.
