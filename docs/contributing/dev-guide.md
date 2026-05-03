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
| `DATABASE_URL` | Host dev용 Postgres 연결 | `.env`의 `POSTGRES_PASSWORD`와 같은 비밀번호 사용 |
| `POSTGRES_PASSWORD` | Compose Postgres 비밀번호 | `openssl rand -base64 32` |
| `BETTER_AUTH_SECRET` | 세션 서명키 | `openssl rand -base64 32` |
| `INTERNAL_API_SECRET` | worker → API 내부 콜백 서명 | `openssl rand -base64 32` |
| `S3_SECRET_KEY` | Compose MinIO / S3 client secret | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Better Auth 서버 URL (= API 포트) | `http://localhost:4000` |
| `GEMINI_API_KEY` | Gemini | aistudio.google.com/apikey |
| `VECTOR_DIM` | 임베딩 차원 | `768` 기본 (Gemini embedding-001 MRL / Ollama nomic). ADR-007 참조 |
| `TEMPORAL_ADDRESS` | Temporal 서버 | `localhost:7233` |
| `RESEND_API_KEY` | 이메일 | resend.com (선택 — 개발 시 console log 가능) |
| `SENTRY_DSN` | 에러 트래킹 | (선택) |

### 4. 인프라 기동

```bash
docker compose up -d     # Postgres, Redis, MinIO, Temporal (hocuspocus/worker/ollama는 profile-gated)
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
| `DATABASE_URL` 연결 실패 | Docker 미기동 | `docker compose up -d postgres` |
| `pnpm install` EACCES | 권한 문제 | corepack 활성화: `corepack enable` |
| `uv sync` 실패 | Python 버전 낮음 | `uv python install 3.12` |
| Temporal 연결 거부 | Temporal UI 기동 안 됨 | `docker compose logs temporal` 확인 |
| `pgvector` extension 에러 | 기본 postgres 이미지 사용 중 | compose가 `pgvector/pgvector:pg16` 쓰는지 확인 |
| M1/ARM Mac에서 이미지 오류 | amd64 이미지 강제 | `docker compose pull --platform linux/amd64` |
| Port 3000/4000 in use | 기존 프로세스가 점유 | kill 또는 `.env`에서 포트 변경 |
| `Cannot find module @opencairn/db` | 의존성 미설치 | 루트에서 `pnpm install` 재실행 |

## Project Structure

```
apps/web         — Next.js 16 (UI + 브라우저 샌드박스: Pyodide + iframe)
apps/api         — Hono 4 (all business logic)
apps/worker      — Python (AI agents, Temporal + 자체 `runtime.Agent`)
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

### Agent Workflow Hygiene

Use `.worktrees/<task>` for isolated or parallel feature work. Before creating a
project-local worktree, verify `.worktrees` is ignored:

```bash
git check-ignore -q .worktrees
git worktree add .worktrees/<task> -b <branch> origin/main
```

Do not run two active plans in the same working tree. Avoid parallel edits to
migration files, `packages/db/src/schema.ts`, `packages/shared`, or the same
`apps/web/messages/*.json` namespace.

When publishing from WSL, prefer the Windows GitHub CLI credential bridge:

```bash
git config --global credential.helper /home/sungbin/.local/bin/git-credential-gh-windows
git config --global --get-all credential.helper
git ls-remote --heads origin main
git push --dry-run origin <branch>
```

The helper calls `'/mnt/c/Program Files/GitHub CLI/gh.exe' auth token` and does
not store a token file. If WSL Git still fails with `could not read Username` or
Windows Git Credential Manager cannot read a `/mnt/c/.../.git/worktrees/...`
path, run Windows Git/GitHub CLI from the repo root instead:

```powershell
cmd.exe /C "cd /d C:\Users\Sungbin\Documents\GitHub\opencairn-monorepo && git push -u origin <branch>"
& "C:\Program Files\GitHub CLI\gh.exe" pr create --repo Sungblab/opencairn-monorepo --base main --head <branch> --draft --title "<title>" --body-file <file>
```

If the GitHub connector returns `Resource not accessible by integration` or
403, but local `gh auth status` has the `Sungblab` account with `repo` scope and
`gh repo view Sungblab/opencairn-monorepo --json viewerPermission` says `ADMIN`,
treat it as a connector installation-permission limit and use `gh`/`gh.exe`.

### Windows Verification Notes

In a new Windows worktree, smoke-test ripgrep once before broad searches:

```powershell
rg --version
rg --files -g package.json
```

If `rg.exe` fails with access denied or execution-block errors, switch to
PowerShell fallback instead of retrying:

```powershell
Get-ChildItem -Recurse -File -Filter package.json
Get-ChildItem -Recurse -File | Select-String -Pattern '<term>'
```

Keep `.npmrc` `virtual-store-dir=.pnpm`. Long
`.worktrees/.../node_modules/.pnpm/...` paths can break Node/Vitest package
imports on Windows.

For `packages/db`, use Node-oriented checks:

```bash
pnpm --filter @opencairn/db exec tsc --noEmit
```

If `packages/db` tests fail with auth/schema startup errors, verify services and
migrations before treating the test as a code failure:

```bash
docker compose up -d postgres
pnpm --filter @opencairn/db db:migrate
pnpm --filter @opencairn/db test
```

If PowerShell or Python reads GitHub Actions logs, `gh run view`, or subprocess
output containing UTF-8, do not rely on CP949 defaults. Set UTF-8 explicitly:

```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
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

1. `apps/worker/src/worker/agents/<agent_name>/agent.py` 생성, `runtime.Agent` 서브클래스 작성 (Plan 12 + Agent Runtime v2 Sub-A)
2. 도구는 `@tool` 데코레이터로 등록 (`runtime.tools`), provider 호출은 `packages/llm` `get_provider()` 경유
3. Temporal Activity wrapper 작성 (`apps/worker/src/worker/activities/`) — 비결정적 LLM/IO를 격리
4. 적절한 Temporal Workflow에 등록
5. `docs/agents/agent-behavior-spec.md`에 가드레일 정의
6. Pytest로 입력 스키마 + trajectory 이벤트 시퀀스 검증
7. 신규 라이브러리 도입은 `docs/architecture/agent-platform-roadmap.md` 우선순위표 통과 필요

## Docker

```bash
# Start all infrastructure
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f postgres
docker compose logs -f temporal

# Reset database
docker compose down -v  # WARNING: deletes all data
docker compose up -d
pnpm db:migrate
```

### Self-hosted Compose Smoke

The default compose command intentionally starts only shared infrastructure.
Production-ish API/Web containers are behind profiles so local development does
not suddenly build Node images.

1. Fill the required secrets in `.env`: `POSTGRES_PASSWORD`,
   `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET`, and `S3_SECRET_KEY`.
2. Validate interpolation before booting:

```bash
docker compose --profile app --profile worker --profile hocuspocus config
```

3. Start infra and apply migrations from the host:

```bash
docker compose up -d postgres redis minio temporal temporal-ui
pnpm db:migrate
```

4. Build and run the app containers:

```bash
docker compose --profile app --profile worker --profile hocuspocus up -d --build
```

This starts `api` on `http://localhost:4000`, `web` on
`http://localhost:3000`, `hocuspocus` on `ws://localhost:1234`, and the worker
against `temporal:7233`. Use `--profile ollama` as well when running the local
LLM service.

#### Full-stack Docker shortcut

Steps 3–4 above are wrapped into a single command for end-to-end smoke tests
where you don't need hot-reload:

```bash
pnpm dev:docker          # infra → migrate → web/api/worker/hocuspocus 빌드+기동
pnpm dev:docker:logs     # 모든 앱 컨테이너 로그 follow
pnpm dev:docker:rebuild  # 코드 수정 후 캐시 없이 다시 빌드 (이후 dev:docker로 기동)
pnpm dev:docker:down     # 컨테이너 정리 (볼륨 유지)
pnpm dev:docker:reset    # 컨테이너 + 볼륨까지 삭제 (DB/MinIO 초기화)
```

코드를 자주 고치는 흐름이면 호스트 hot-reload 경로 (`docker compose up -d`
+ `pnpm dev`)가 빠릅니다. `dev:docker`는 production-ish 이미지를 빌드하므로
소스 변경 반영에 매번 `dev:docker:rebuild` → `dev:docker`가 필요합니다.

## Import (Drive + Notion)

One-shot bulk import at `/workspace/[slug]/import`. Feature flag:
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
