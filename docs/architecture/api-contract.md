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
| DELETE | /api/projects/:id | workspace `admin` or creator | 삭제 | - |

### Folders

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/folders/by-project/:projectId | Yes | List folders | - |
| POST | /api/folders | Yes | Create folder | `{ projectId, parentId?, name }` |
| PATCH | /api/folders/:id | Yes | Update folder. `parentId` 변경 시 `moveFolder()`가 ltree 서브트리 전체를 재작성(App Shell Phase 2 Task 11). cross-project 이동 시 400. 스칼라(name/position)는 이동 후 별도 적용. | `{ name?, parentId?, position? }` |
| DELETE | /api/folders/:id | Yes | Delete folder | - |

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

Public — Better Auth 세션 + `canWrite`(project, 생성/변경) 또는 `canRead`(workspace, 조회/스트림). `FEATURE_DEEP_RESEARCH=false` 시 모든 경로 404. `billingPath: "managed"`는 `FEATURE_MANAGED_DEEP_RESEARCH` 필요 (off 시 403 `{error:"managed_disabled"}`).

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

#### Tool-calling loop (worker runtime, Agent Runtime v2 · A)

`run_with_tools(...)` (`apps/worker/src/runtime/loop_runner.py`)은 Temporal activity 내부에서 호출되는 러너. 시그니처는 `provider, initial_messages, tools, tool_context (dict), config: LoopConfig | None, hooks: LoopHooks | None`. 한 activity = 한 loop이며 `LoopConfig.max_turns (default 8)`, `max_tool_calls (12)`, `max_total_input_tokens (200_000)`, per-tool timeout, 소프트 루프 detection으로 bounded. Provider가 tool calling을 지원하지 않으면 `ToolCallingNotSupported` fail-fast.

### Chat

> 🟡 **Status: Planned (Plan 11A — Chat Scope Foundation).** 아래 계약은 설계서대로의 최종 상태이며 아직 `apps/api`에 라우트가 없다. Plan 1의 `conversations`/`messages`/`conversation_scope`/`message_role` 스텁은 드리프트가 있어 migration 0019에서 제거됨 — Plan 11A가 `scope_type` enum(`['page','project','workspace']`), split `scopeType`+`scopeId` 컬럼, `ragMode`, `attachedChips`, `memoryFlags`, 확장된 `message_role`(`user`/`assistant`/`system`/`tool`)로 스키마 전체를 새로 정의한다. 현 상태에서 해당 엔드포인트를 호출하면 404.

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/chat/conversations/by-project/:projectId | Yes | List conversations | - |
| POST | /api/chat/conversations | Yes | Create conversation | `{ projectId?: string, workspaceId?: string, pageId?: string, scope: 'workspace'\|'project'\|'page', attached_chips?: ChipRef[] }` |
| GET | /api/chat/conversations/:id/messages | Yes | List messages | - |
| POST | /api/chat/message | Yes | Send message (SSE stream) | `{ conversationId, content }` |

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
| GET | /api/notification-preferences | Yes | 선호도 조회 | - |
| PUT | /api/notification-preferences | Yes | 선호도 업데이트 | `{ type, channelInapp, channelEmail, frequency }` |

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

### Code Agent (브라우저 샌드박스)

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/code/run | Yes | Code Agent에게 코드 생성 요청 (실행 안 함) | `{ prompt, language: python\|javascript\|html\|react, context? }` |
| POST | /api/code/feedback | Yes | 브라우저에서 실행 후 stdout/stderr 피드백 (self-healing 재생성용) | `{ workflowId, stdout, stderr, timedOut }` |

### Canvas Templates

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/canvas/from-template | Yes | slides/mindmap/cheatsheet 템플릿 → React 컴포넌트 소스 생성 | `{ templateId, variables }` |
| GET  | /api/canvas/sessions/:id | Yes | 저장된 canvas 세션 소스 조회 | — |

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
