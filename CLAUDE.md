# OpenCairn

AI-powered personal knowledge OS. 11 agents, multi-LLM, Docker self-hosted.

## Architecture

```
apps/web        — Next.js 16. UI + 브라우저 샌드박스 (Pyodide + iframe).
apps/api        — Hono 4. ALL business logic.
apps/worker     — Python. LangGraph + Temporal. 11 AI 에이전트.
apps/hocuspocus — Yjs 협업 서버 (Better Auth 연동).
packages/db     — Drizzle ORM + pgvector.
packages/llm    — Python. LLM provider 추상화 (Gemini/OpenAI/Ollama).
packages/shared — Zod 스키마 (API 계약).
```

> 2026-04-14 업데이트: `apps/sandbox` 폐기 (gVisor 제거). 코드 실행은 전부 브라우저 (Pyodide/iframe). 파싱 스택은 opendataloader-pdf + markitdown + unoserver + H2Orestart + faster-whisper. 시각화는 Cytoscape 5뷰. 상세는 세션 커밋 `7587347`.

## Rules

- Frontend: NO Server Actions, NO DB imports. API calls only (TanStack Query)
- Frontend: Next.js 16 — `proxy.ts` 사용 (`middleware.ts` deprecated)
- Backend: Zod validation, requireAuth middleware, scope by userId
- DB: Drizzle only, `VECTOR_DIM` env (권장 1536d Gemini Matryoshka truncate), tsvector via trigger
- Worker: Temporal orchestration, LangGraph per agent, **`packages/llm` get_provider() 필수** (Gemini 직접 호출 금지)
- AI: Multi-LLM (Gemini/OpenAI/Ollama). BYOK Gemini 추천 (프리미엄 기능 보존). Thinking/Caching/Search Grounding/TTS — Gemini 전용, graceful degradation
- Sandbox: 브라우저 전용 (Pyodide WASM + iframe sandbox). 서버 코드 실행 금지
- Security: AES-256 BYOK 키 암호화, CORS 제한, PostgreSQL 인터넷 비노출, Cloudflare 앞단 WAF
- i18n: next-intl, default `en`, secondary `ko`. All UI strings in `messages/{locale}.json`
- Collab: Yjs + Hocuspocus (멀티디바이스 동시 편집, Plate Yjs plugin)

## LLM 참조 규칙

- **Gemini API 문서** → 항상 `references/Gemini_API_docs/` 로컬 문서 사용 (모델명 자주 변경)
- **그 외 라이브러리** → context7 MCP 사용
- **반복 실수 목록** → `docs/contributing/llm-antipatterns.md` 반드시 확인

## Workflow (기능 구현 후 매번)

> AI 어시스턴트 (Claude Code, Cursor 등)가 기능을 만들 때마다 이 순서를 **반드시** 따를 것. 기존 superpowers skills 활용.

1. **Verification** — `superpowers:verification-before-completion` skill 사용
   - 빌드 통과 확인 (`pnpm build` 또는 해당 앱 빌드)
   - 테스트 통과 확인 (`pnpm test` 또는 `pytest`)
   - 타입체크 (`pnpm typecheck`)
   - "작업 끝났다" 선언 전 반드시

2. **Code Review** — `feature-dev:code-reviewer` sub-agent 또는 `superpowers:requesting-code-review` skill
   - 현재 변경분에 대해 버그/보안/안티패턴/프로젝트 컨벤션 위반 체크
   - 리포트 받으면 `superpowers:receiving-code-review` skill로 피드백 반영

3. **Docs 업데이트** — 다음 중 해당되는 것 전부:
   - 관련 plan 파일의 `- [ ]` → `- [x]` 체크 표시
   - 새 아키텍처 결정이 있으면 → `docs/architecture/adr/` 에 ADR 추가
   - 새 프로젝트 컨벤션이 생기면 → **CLAUDE.md** 반영
   - 새 반복 실수 발견 시 → `docs/contributing/llm-antipatterns.md` 추가
   - API 변경 시 → `docs/architecture/api-contract.md` 업데이트

4. **Commit** — atomic, Conventional Commits 포맷 (아래 섹션 규칙 준수)

5. **Plan 또는 브랜치 마무리 시** — `superpowers:finishing-a-development-branch` skill
   - 전체 테스트 재실행
   - 브랜치 squash merge (PR 방식 사용 시)
   - 관련 plan 전체 체크 확인

**원칙**: "구현만 하고 넘어가기" 금지. 매 기능마다 검증 → 리뷰 → 문서 → 커밋 루프.

## Commits

포맷: `<type>(<scope>): <subject>`

- **type**: `feat` | `fix` | `chore` | `docs` | `refactor` | `test` | `perf` | `style`
- **scope**: `web` | `api` | `worker` | `db` | `shared` | `llm` | `infra` | `docs`
- **subject**: 명령형 현재시제, 소문자 시작, 마침표 없음

규칙:
- **1 커밋 = 1 논리적 변경**, 1 파일 수정이 아님
- 같은 세션의 관련된 변경은 **주제별로 묶어서** 1개 커밋 (13개 파일 → 13 커밋 금지)
- 각 커밋은 **빌드/테스트 통과**해야 함 (깨진 중간 상태 금지)
- WIP 작업은 브랜치에서, `main` 직커밋은 의미있는 단위로만
- 본문에 **"왜"**를 설명 — "무엇"은 diff로 보임
- 권장 빈도: 10-20 커밋/일 max (주 50-100). 더 많으면 "저장 습관" 의심
- 커뮤니티 기여 받으면 **PR + Squash merge** 전환

금지:
- `"update"` `"fix"` `"wip"` 같은 의미 없는 메시지
- 여러 주제 섞기 (`"feat: add graph + fix auth bug + update docs"`)
- 파일별 쪼개기 (`"update plan-1"` → `"update plan-2"` → ...)

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
| Architecture Decision Records (Hono/Temporal/LightRAG/Pyodide 등) | `docs/architecture/adr/` |
| Test strategy, CI pipeline | `docs/testing/strategy.md` |
| Dev setup, conventions, troubleshooting | `docs/contributing/dev-guide.md` |
| Claude 반복 실수, 하지 말 것 목록 | `docs/contributing/llm-antipatterns.md` |
| Multi-LLM provider 설계 (Gemini/OpenAI/Ollama) | `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md` |
| 스토리지/사이징 계산 (벡터 DB, 사용자별 용량) | `docs/architecture/storage-planning.md` |
| DB 백업/복구/데이터 포터빌리티 전략 | `docs/architecture/backup-strategy.md` |

### Implementation Plans

| Plan | Scope |
|------|-------|
| `docs/superpowers/plans/2026-04-09-plan-1-foundation.md` | Monorepo, DB schema, Better Auth, CRUD, Docker, Resend, Sentry, CI/CD, backup scripts |
| `docs/superpowers/plans/2026-04-09-plan-2-editor.md` | Plate v49 에디터, LaTeX, wiki-links, slash commands, Yjs + Hocuspocus 협업 |
| `docs/superpowers/plans/2026-04-09-plan-3-ingest-pipeline.md` | 파일 업로드, 파싱 (opendataloader-pdf/markitdown/unoserver/H2Orestart/faster-whisper), Temporal 워크플로우 |
| `docs/superpowers/plans/2026-04-09-plan-4-agent-core.md` | Compiler, Research, Librarian 에이전트 (Python LangGraph + Temporal) |
| `docs/superpowers/plans/2026-04-09-plan-5-knowledge-graph.md` | LightRAG 동기화, Cytoscape 5뷰 (Graph/Mindmap/Cards/Canvas/Timeline) + Backlinks, Visualization Agent (Task M1) |
| `docs/superpowers/plans/2026-04-09-plan-6-learning-system.md` | Socratic (Python worker), SM-2 플래시카드, Tool Templates, Cards 뷰 통합 |
| `docs/superpowers/plans/2026-04-09-plan-7-canvas-sandbox.md` | 브라우저 샌드박스 (Pyodide + iframe), Code Agent |
| `docs/superpowers/plans/2026-04-09-plan-8-remaining-agents.md` | Connector, Temporal, Synthesis, Curator, Narrator, Deep Research (Task A1) |
| `docs/superpowers/plans/2026-04-09-plan-9-billing-marketing.md` | Stripe, 랜딩 페이지, 블로그, BYOK, Export API (Task E1, GDPR) |
| `docs/superpowers/plans/2026-04-13-multi-llm-provider.md` | packages/llm, provider adapters, VECTOR_DIM, Docker Ollama |
