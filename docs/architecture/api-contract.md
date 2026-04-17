# API Contract

Hono 백엔드 API 명세. 프론트엔드는 이 계약에만 의존한다.

---

## Base URL

- Development: `http://localhost:4000`
- Production: `https://api.opencairn.com`

## Authentication

모든 `/api/*` 라우트 (health, auth 제외)는 세션 쿠키 필요.

```
Cookie: better_auth.session_token=<token>
```

## Response Format

```json
// Success
{ "id": "uuid", "name": "...", ... }

// List
[{ "id": "uuid", ... }, ...]

// Error
{ "error": "Error message" }
```

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

### Projects

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/projects | Yes | List user's projects | - |
| GET | /api/projects/:id | Yes | Get project | - |
| POST | /api/projects | Yes | Create project | `{ name, description? }` |
| PATCH | /api/projects/:id | Yes | Update project | `{ name?, description? }` |
| DELETE | /api/projects/:id | Yes | Delete project | - |

### Folders

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/folders/by-project/:projectId | Yes | List folders | - |
| POST | /api/folders | Yes | Create folder | `{ projectId, parentId?, name }` |
| PATCH | /api/folders/:id | Yes | Update folder | `{ name?, parentId?, position? }` |
| DELETE | /api/folders/:id | Yes | Delete folder | - |

### Tags

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/tags/by-project/:projectId | Yes | List tags | - |
| POST | /api/tags | Yes | Create tag | `{ projectId, name, color? }` |
| POST | /api/tags/:tagId/notes/:noteId | Yes | Tag a note | - |
| DELETE | /api/tags/:tagId/notes/:noteId | Yes | Untag a note | - |
| DELETE | /api/tags/:id | Yes | Delete tag | - |

### Notes

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/notes/by-project/:projectId | Yes | List notes | - |
| GET | /api/notes/:id | Yes | Get note | - |
| POST | /api/notes | Yes | Create note | `{ projectId, folderId?, title?, content?, type? }` |
| PATCH | /api/notes/:id | Yes | Update note | `{ title?, content?, folderId? }` |
| DELETE | /api/notes/:id | Yes | Soft-delete note | - |

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

`X-Internal-Secret` 헤더는 `INTERNAL_API_SECRET` env와 일치해야 하며, 불일치 시 `401`.

### Chat

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| GET | /api/chat/conversations/by-project/:projectId | Yes | List conversations | - |
| POST | /api/chat/conversations | Yes | Create conversation | `{ projectId, scope? }` |
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

### Billing (Toss Payments)

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/billing/subscribe | Yes | Create Toss billing-key subscription | `{ plan: "pro" \| "byok" }` |
| POST | /api/billing/cancel | Yes | Cancel active subscription (현행 청구 주기 종료 시) | — |
| GET  | /api/billing/subscription | Yes | Get current subscription state | — |
| PUT  | /api/billing/byok-key | Yes | Save encrypted BYOK Gemini API key | `{ geminiKey }` |
| POST | /api/billing/refund-request | Yes | 환불 요청 접수 (정책은 Plan 9 참조) | `{ reason }` |
| POST | /api/billing/webhook | No | Toss webhook handler (PAYMENT_APPROVED / PAYMENT_REFUNDED / BILLING_KEY_ISSUED 등) | Toss event |

> 참고: 결제 수단은 v0.1에서 Toss Payments 단독 (한국 원화). 글로벌 확장 시 Stripe 등 다른 PSP 추가 가능 (v0.2+).

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
