# OpenCairn

AI-powered personal knowledge OS. 11 agents, multi-LLM, Docker self-hosted.

## Architecture

```
apps/web      — Next.js 16. UI ONLY. No Server Actions, no DB access.
apps/api      — Hono 4. ALL business logic.
apps/worker   — Python. LangGraph + Temporal. AI agents.
apps/sandbox  — gVisor. Code execution.
packages/db   — Drizzle ORM + pgvector.
packages/llm  — Python. LLM provider adapters (Gemini/OpenAI/Ollama).
packages/shared — Zod schemas.
```

## Rules

- Frontend: NO Server Actions, NO DB imports. API calls only (TanStack Query)
- Frontend: Next.js 16 — `proxy.ts` 사용 (`middleware.ts` deprecated)
- Backend: Zod validation, requireAuth middleware, scope by userId
- DB: Drizzle only, VECTOR(`VECTOR_DIM` env, default 3072), tsvector via trigger
- Worker: Temporal orchestration, LangGraph per agent, `packages/llm` via `get_provider()`
- AI: Multi-LLM (Gemini/OpenAI/Ollama). Production=Gemini. Context Caching, Thinking Mode, Search Grounding, TTS — Gemini 전용, graceful degradation
- Security: gVisor sandbox, AES-256 API keys, CORS restricted
- i18n: next-intl, default locale `en`, secondary `ko`. All UI strings in messages/{locale}.json

## LLM 참조 규칙

- **Gemini API 문서** → 항상 `references/Gemini_API_docs/` 로컬 문서 사용 (모델명 자주 변경)
- **그 외 라이브러리** → context7 MCP 사용
- **반복 실수 목록** → `docs/contributing/llm-antipatterns.md` 반드시 확인

## Commits

`feat|fix|chore|docs(web|api|worker|db|shared|infra): message`

## Commands

```bash
pnpm dev                           # all services
pnpm --filter @opencairn/api dev   # API only
pnpm --filter @opencairn/web dev   # web only
pnpm db:generate                   # migration
pnpm db:migrate                    # run migration
docker-compose up -d               # infra
```

## Docs Index

Read these docs when you need context. Don't load them all at once.

| Need | Read |
|------|------|
| System design, tech stack, full architecture | `docs/superpowers/specs/2026-04-09-opencairn-design.md` |
| User stories, personas, requirements | `docs/superpowers/specs/2026-04-09-opencairn-prd.md` |
| API endpoints, request/response format | `docs/architecture/api-contract.md` |
| Data flow (ingest → wiki → Q&A) | `docs/architecture/data-flow.md` |
| Agent guardrails, stop conditions, conflicts | `docs/agents/agent-behavior-spec.md` |
| Temporal workflows, retry policies | `docs/agents/temporal-workflows.md` |
| Gemini caching, embeddings, prompts, RAG | `docs/agents/context-management.md` |
| Why Hono? Why Temporal? Why gVisor? | `docs/architecture/adr/` |
| Test strategy, CI pipeline | `docs/testing/strategy.md` |
| Dev setup, conventions, troubleshooting | `docs/contributing/dev-guide.md` |
| Claude 반복 실수, 하지 말 것 목록 | `docs/contributing/llm-antipatterns.md` |
| Multi-LLM provider 설계 (Gemini/OpenAI/Ollama) | `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md` |
| 스토리지/사이징 계산 (벡터 DB, 사용자별 용량) | `docs/architecture/storage-planning.md` |
| DB 백업/복구/데이터 포터빌리티 전략 | `docs/architecture/backup-strategy.md` |

### Implementation Plans

| Plan | Scope |
|------|-------|
| `docs/superpowers/plans/2026-04-09-plan-1-foundation.md` | Monorepo, DB schema, auth, CRUD, Docker |
| `docs/superpowers/plans/2026-04-09-plan-2-editor.md` | Plate editor, LaTeX, wiki-links, slash commands |
| `docs/superpowers/plans/2026-04-09-plan-3-ingest-pipeline.md` | File upload, parsing, Temporal workflows |
| `docs/superpowers/plans/2026-04-09-plan-4-agent-core.md` | Compiler, Research, Librarian agents |
| `docs/superpowers/plans/2026-04-09-plan-5-knowledge-graph.md` | Concepts, edges, D3.js visualization |
| `docs/superpowers/plans/2026-04-09-plan-6-learning-system.md` | Socratic, flashcards, Tool Templates |
| `docs/superpowers/plans/2026-04-09-plan-7-canvas-sandbox.md` | gVisor sandbox, React canvas, Code Agent |
| `docs/superpowers/plans/2026-04-09-plan-8-remaining-agents.md` | Connector, Temporal, Synthesis, Curator, Narrator, Deep Research |
| `docs/superpowers/plans/2026-04-09-plan-9-billing-marketing.md` | Stripe, landing page, blog, docs |
| `docs/superpowers/plans/2026-04-13-multi-llm-provider.md` | packages/llm, provider adapters, VECTOR_DIM, Docker Ollama |
