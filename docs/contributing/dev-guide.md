# Development Guide

OpenCairn 개발 환경 설정 및 컨벤션.

---

## Prerequisites

- Node.js 22+ (LTS)
- pnpm 9+
- Python 3.12+ / uv
- Docker + Docker Compose
- Java 11+ (opendataloader-pdf) — Worker Dockerfile은 openjdk-21 LTS 사용
- ffmpeg (오디오/영상 처리)
- LibreOffice + H2Orestart 확장 (unoserver — Worker Dockerfile에 내장)
- 브라우저 샌드박스는 Pyodide/iframe 기반 → 호스트에 추가 런타임 불필요 (ADR-006)

## Quick Start (신규 개발자 0 → running)

### 1. 전제 조건

| 도구 | 최소 버전 | 권장 | 확인 명령 |
|------|----------|------|----------|
| Node.js | 22.0.0 | 22.x LTS | `node -v` |
| pnpm | 9.0.0 | 9.x | `pnpm -v` |
| Python | 3.12 | 3.12.x | `python --version` |
| uv | 0.4 | latest | `uv --version` |
| Docker | 27.0 | Docker Desktop 최신 | `docker --version` |
| Docker Compose | v2.20 | v2.x | `docker compose version` |

**uv 설치**:
- macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Windows: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`

### 2. 리포 클론 + 의존성

```bash
git clone <repo>
cd opencairn-monorepo
pnpm install
uv sync --directory apps/worker
```

### 3. 환경 변수 — `.env.example` → `.env`

```bash
cp .env.example .env
```

필수 변수 (전부 채워야 `pnpm dev` 동작):

| 변수 | 설명 | 생성/획득 방법 |
|------|------|--------------|
| `DATABASE_URL` | Postgres 연결 | docker-compose 기본값 (`postgresql://opencairn:opencairn@localhost:5432/opencairn`) |
| `BETTER_AUTH_SECRET` | 세션 서명키 | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | 콜백 URL | `http://localhost:3000` |
| `GEMINI_API_KEY` | Gemini | aistudio.google.com/apikey |
| `VECTOR_DIM` | 임베딩 차원 | `768` 기본 (Gemini embedding-001 MRL / Ollama nomic). ADR-007 참조 |
| `TEMPORAL_ADDRESS` | Temporal 서버 | `localhost:7233` |
| `RESEND_API_KEY` | 이메일 | resend.com (선택 — 개발 시 console log 가능) |
| `SENTRY_DSN` | 에러 트래킹 | (선택) |

### 4. 인프라 기동

```bash
docker-compose up -d     # Postgres, Redis, Temporal, (optional) Ollama
pnpm db:migrate          # 스키마 적용
pnpm db:seed             # (선택) 테스트 데이터
```

### 5. 개발 서버

```bash
pnpm dev
```

정상 로그 예시:
```
[web]       ▲ Next.js 16.x ready on http://localhost:3000
[api]       Hono listening on http://localhost:4000
[worker]    Temporal worker started (queues: ingest-queue, agent-queue)
[hocuspocus] listening on ws://localhost:1234
```

**헬스체크**: `curl http://localhost:4000/health` → `{"status":"ok"}`

### 6. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `DATABASE_URL` 연결 실패 | Docker 미기동 | `docker-compose up -d db` |
| `pnpm install` EACCES | 권한 문제 | corepack 활성화: `corepack enable` |
| `uv sync` 실패 | Python 버전 낮음 | `uv python install 3.12` |
| Temporal 연결 거부 | Temporal UI 기동 안 됨 | `docker-compose logs temporal` 확인 |
| `pgvector` extension 에러 | 기본 postgres 이미지 사용 중 | compose가 `pgvector/pgvector:pg16` 쓰는지 확인 |
| M1/ARM Mac에서 이미지 오류 | amd64 이미지 강제 | `docker-compose pull --platform linux/amd64` |
| Port 3000/4000 in use | 기존 프로세스가 점유 | kill 또는 `.env`에서 포트 변경 |
| `Cannot find module @opencairn/db` | 의존성 미설치 | 루트에서 `pnpm install` 재실행 |

## Project Structure

```
apps/web         — Next.js 16 (UI + 브라우저 샌드박스: Pyodide + iframe)
apps/api         — Hono 4 (all business logic)
apps/worker      — Python (AI agents, LangGraph + Temporal)
apps/hocuspocus  — Yjs 협업 서버 (Node, Better Auth 연동)

packages/db      — Drizzle ORM (pgvector 포함)
packages/llm     — Python LLM provider adapters (Gemini/Ollama)
packages/shared  — Zod schemas, constants
packages/ui      — shadcn/ui components
packages/config  — ESLint, TypeScript configs

# apps/sandbox는 2026-04-14 폐기됨 (ADR-006). 서버 코드 실행 서비스 없음.
```

## Conventions

### Git

```bash
# Branch naming
feat/editor-wikilinks
fix/research-agent-timeout
chore/update-dependencies
docs/api-contract

# Commit format (conventional commits)
feat(api): add project CRUD routes
fix(worker): handle Gemini API rate limit
chore(db): update drizzle to 0.45.2
docs(agents): add compiler agent behavior spec

# Scopes
web, api, worker, hocuspocus, db, llm, shared, ui, config, infra, canvas, docs
```

### TypeScript

- Strict mode always
- Prefer `const` > `let`, never `var`
- Zod for runtime validation at API boundaries
- Types shared via @opencairn/shared
- No `any` — use `unknown` and narrow

### Python

- Python 3.12+, type hints everywhere
- Pydantic for data models
- async/await for I/O
- Black for formatting, Ruff for linting

### File Organization

- One responsibility per file
- Schema files split by domain
- Routes split by resource
- Agent files split by agent

## Database

```bash
# Generate migration after schema change
pnpm db:generate

# Run migrations
pnpm db:migrate

# Open Drizzle Studio (visual DB browser)
pnpm db:studio
```

### Schema Changes

1. Edit schema file in `packages/db/src/schema/`
2. Run `pnpm db:generate`
3. Review generated SQL in `packages/db/drizzle/`
4. Run `pnpm db:migrate`
5. Commit schema + migration together

## API Development

### Adding a New Route

1. Create `apps/api/src/routes/your-resource.ts`
2. Define Zod schemas in `packages/shared/src/api-types.ts`
3. Add route with `requireAuth` middleware
4. Mount in `apps/api/src/app.ts`
5. Write integration test

### Route Pattern

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth";

export const yourRoutes = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => { /* list */ })
  .get("/:id", async (c) => { /* get */ })
  .post("/", zValidator("json", createSchema), async (c) => { /* create */ })
  .patch("/:id", zValidator("json", updateSchema), async (c) => { /* update */ })
  .delete("/:id", async (c) => { /* delete */ });
```

## Frontend Development

### Adding a New Page

1. Create `apps/web/src/app/(app)/your-page/page.tsx`
2. Use TanStack Query to fetch from API
3. Use shadcn/ui components
4. Never import from @opencairn/db

### Key Libraries

- **Plate v49**: Block editor (LaTeX, 위키링크, 슬래시 커맨드)
- **TanStack Query**: API state management
- **shadcn/ui**: UI components
- **Tailwind CSS v4**: Styling (CSS-first config)
- **Cytoscape.js + react-cytoscapejs**: Knowledge graph 5뷰 (Graph/Mindmap/Cards/Canvas/Timeline). D3는 사용하지 않음 (2026-04-14 결정)
- **Pyodide (WASM)**: 브라우저 내 Python 실행 (Canvas 샌드박스)
- **Yjs + @platejs/yjs**: 실시간 협업 (CRDT)

## Agent Development

### Adding a New Agent

1. Create `apps/worker/src/agents/your_agent.py`
2. Define LangGraph state machine
3. Create Temporal Activity wrapper
4. Add to appropriate Temporal Workflow
5. Define guardrails in `docs/agents/agent-behavior-spec.md`
6. Write tests (Pydantic schema validation + workflow order)

## Docker

```bash
# Start all infrastructure
docker-compose up -d

# Stop
docker-compose down

# View logs
docker-compose logs -f postgres
docker-compose logs -f temporal

# Reset database
docker-compose down -v  # WARNING: deletes all data
docker-compose up -d
pnpm db:migrate
```

## Import (Drive + Notion)

One-shot bulk import at `/app/w/[slug]/import`. Feature flag:
`FEATURE_IMPORT_ENABLED=true`. Full design in
`docs/superpowers/specs/2026-04-22-ingest-source-expansion-design.md`
(spec) and `docs/superpowers/plans/2026-04-22-ingest-source-expansion.md`
(plan).

### Google Drive setup

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth
   client ID. Application type: **Web**.
2. Authorized redirect URI: `{PUBLIC_API_URL}/api/integrations/google/callback`.
3. Scopes on the OAuth consent screen: `drive.file` + `userinfo.email`.
   Both are non-sensitive — **no CASA audit required**.
4. Set `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` in `.env`.

### Token encryption key

Generate once per deployment and keep stable — rotation requires
re-encrypting existing `user_integrations` rows:

```bash
openssl rand -base64 32
```

Set the output as `INTEGRATION_TOKEN_ENCRYPTION_KEY`. The API (TS) and
worker (Python) both decrypt from the same bytes — wire format is
`iv(12) || tag(16) || ct`, see `apps/api/src/lib/integration-tokens.ts`
and `apps/worker/src/worker/lib/integration_crypto.py`.

### Notion ZIPs

No OAuth. Users upload their workspace export ZIP directly via a
presigned MinIO URL. Size ceilings are env-tunable
(`IMPORT_NOTION_ZIP_MAX_BYTES`, `IMPORT_NOTION_ZIP_MAX_UNCOMPRESSED_BYTES`).
The worker extracts into `NOTION_IMPORT_STAGING_DIR/<job_id>/` with
zip-slip / bomb / file-count defenses before any file hits disk.

## Troubleshooting

위 Quick Start §6을 먼저 확인. 이하는 추가 케이스:

| Problem | Solution |
|---------|----------|
| Migration fails | `.env`의 `DATABASE_URL`과 docker-compose 값 일치 확인 |
| Hocuspocus 연결 실패 | Better Auth 세션 쿠키가 ws 핸드셰이크에 전달되는지 확인 |
| Gemini 429 rate limit | 로컬 개발 시 BYOK 키 사용 권장, 또는 Ollama provider로 전환 |
| /import returns 404 | `FEATURE_IMPORT_ENABLED=true` 설정 및 서버 재시작 |
| Drive connect → 503 | `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` 미설정 |
| OAuth state expired | 10분 TTL — OAuth 동의 화면에서 너무 오래 머물면 재시작 필요 |
| Notion zip_slip/bomb | ZIP 내부에 `../` 경로 혹은 과도한 압축률 — 다른 경로 재업로드 |
