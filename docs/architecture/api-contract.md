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
| POST | /api/ingest/upload | Yes | Upload file for ingestion | `multipart/form-data: file, projectId` |
| POST | /api/ingest/url | Yes | Ingest from URL | `{ url, projectId }` |
| POST | /api/ingest/youtube | Yes | Ingest YouTube video | `{ url, projectId }` |

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

### Billing

| Method | Path | Auth | Description | Body |
|--------|------|------|-------------|------|
| POST | /api/billing/checkout | Yes | Create Stripe checkout session | `{ plan }` |
| POST | /api/billing/portal | Yes | Create Stripe portal session | - |
| POST | /api/billing/webhook | No | Stripe webhook handler | Stripe event |
