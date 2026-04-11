# Development Guide

OpenCairn 개발 환경 설정 및 컨벤션.

---

## Prerequisites

- Node.js 22+ (LTS)
- pnpm 9+
- Python 3.12+
- Docker + Docker Compose
- Java 11+ (opendataloader-pdf)
- ffmpeg (오디오/영상 처리)
- gVisor (runsc, 샌드박스용, 선택)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/opencairn/opencairn.git
cd opencairn

# 2. Install dependencies
pnpm install

# 3. Start infrastructure
docker-compose up -d

# 4. Setup environment
cp .env.example .env
# Edit .env: set GEMINI_API_KEY

# 5. Run database migrations
pnpm db:migrate

# 6. Start development servers
pnpm dev
# → API: http://localhost:4000
# → Web: http://localhost:3000

# 7. (Optional) Start Python worker
cd apps/worker
pip install -e .
python -m opencairn_worker
```

## Project Structure

```
apps/web      — Next.js 16 (UI only)
apps/api      — Hono 4 (all business logic)
apps/worker   — Python (AI agents)
apps/sandbox  — gVisor (code execution)

packages/db      — Drizzle ORM
packages/shared  — Zod schemas, constants
packages/ui      — shadcn/ui components
packages/config  — ESLint, TypeScript configs
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
web, api, worker, sandbox, db, shared, ui, config, infra
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

- **Plate v49**: Block editor
- **TanStack Query**: API state management
- **shadcn/ui**: UI components
- **Tailwind CSS v4**: Styling
- **D3.js**: Knowledge graph visualization

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

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Cannot find module @opencairn/db` | Run `pnpm install` from root |
| DB connection refused | Check `docker-compose ps`, ensure postgres is running |
| Temporal connection failed | Check temporal service: `docker-compose logs temporal` |
| Migration fails | Check DATABASE_URL in .env matches docker-compose |
| Port 3000/4000 in use | Kill existing process or change port in .env |
