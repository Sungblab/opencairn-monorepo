# OpenCairn

AI-powered personal + team knowledge OS. **Notion 대체 포지션**, 12 에이전트, multi-LLM (Gemini/Ollama), Docker self-hosted, AGPLv3.

## Architecture

```
apps/web        — Next.js 16. UI + 브라우저 샌드박스 (Pyodide + iframe).
apps/api        — Hono 4. ALL business logic + 권한 헬퍼.
apps/worker     — Python. LangGraph + Temporal. 12 AI 에이전트.
apps/hocuspocus — Yjs 협업 서버 (Better Auth + page-level 권한 hook).
packages/db     — Drizzle ORM + pgvector + workspace 3계층 권한.
packages/llm    — Python. LLM provider 추상화 (Gemini/Ollama).
packages/shared — Zod 스키마 (API 계약).
```

Data hierarchy: **Workspace → Project → Page** (Notion 스타일 3계층). Workspace가 격리 경계, 하위는 상속 + override. 상세: [collaboration-model.md](docs/architecture/collaboration-model.md).

> 2026-04-14 업데이트: `apps/sandbox` 폐기 (gVisor 제거). 코드 실행은 전부 브라우저 (Pyodide/iframe, [ADR-006](docs/architecture/adr/006-pyodide-iframe-sandbox.md)). 파싱 스택은 opendataloader-pdf + markitdown + unoserver + H2Orestart + faster-whisper. 시각화는 Cytoscape 5뷰 (Visualization Agent 추가로 12 에이전트). 결제는 Toss Payments (한국 원화). 상세는 세션 커밋 `7587347`.
>
> 2026-04-15 업데이트: OpenAI provider 제거. `packages/llm`은 Gemini + Ollama 2개만 지원.
>
> **2026-04-18 업데이트**: Notion급 팀 협업을 v0.1에 포함. Workspace 계층 + 역할 기반 권한 + Hocuspocus auth hook + 코멘트 + @mention + 알림 + 활동 피드 + 공개 링크 + 게스트. 페르소나 3단계 확장 (v0.1 대학원생 → v0.2 연구실 → v0.3 규제 산업 엔터프라이즈). 데이터 모델 breaking change: `projects.user_id` → `projects.workspace_id`. 상세: [collaboration-model.md](docs/architecture/collaboration-model.md).

## Rules & Workflow

- **Project rules** (Frontend/Backend/DB/Worker/AI/Security) → `opencairn:rules` skill
- **Post-feature workflow** (Verification → Review → Docs → Commit) → `opencairn:post-feature` skill
- **Commit conventions** → `opencairn:commit` skill

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
| **협업 모델 (Workspace/권한/Hocuspocus/코멘트/알림/공개링크)** | `docs/architecture/collaboration-model.md` |
| Test strategy, CI pipeline | `docs/testing/strategy.md` |
| Dev setup, conventions, troubleshooting | `docs/contributing/dev-guide.md` |
| Claude 반복 실수, 하지 말 것 목록 | `docs/contributing/llm-antipatterns.md` |
| Multi-LLM provider 설계 (Gemini/Ollama) | `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md` |
| Document skills 설계 (문서 생성 → PDF/DOCX/PPTX) | `docs/superpowers/specs/2026-04-15-document-skills-design.md` |
| 스토리지/사이징 계산 (벡터 DB, 사용자별 용량) | `docs/architecture/storage-planning.md` |
| DB 백업/복구/데이터 포터빌리티 전략 | `docs/architecture/backup-strategy.md` |
| 보안 모델 (BYOK 키, 권한, CSP, rate limit, Hocuspocus auth) | `docs/architecture/security-model.md` |
| 장애 대응 / 온콜 / 알럿 채널 | `docs/runbooks/incident-response.md` |
| 브라우저 샌드박스 E2E 테스트 (Pyodide/iframe) | `docs/testing/sandbox-testing.md` |

### Implementation Plans

| Plan | Scope |
|------|-------|
| `docs/superpowers/plans/2026-04-09-plan-1-foundation.md` | Monorepo, DB schema (**Workspace 3계층 + 권한**), Better Auth, workspace/member/invite CRUD, permissions helpers (`canRead`/`canWrite`/`requireWorkspaceRole`), Docker, Resend, Sentry, CI/CD, backup scripts |
| `docs/superpowers/plans/2026-04-09-plan-2-editor.md` | Plate v49 에디터 + **Notion급 협업**: Hocuspocus auth hook, 실시간 공동 편집 + Presence, block-anchor 코멘트 + 스레드, @mention, 알림 (SSE+이메일), activity feed, 공개 공유 링크, guest 초대 |
| `docs/superpowers/plans/2026-04-09-plan-3-ingest-pipeline.md` | 파일 업로드, 파싱 (opendataloader-pdf/markitdown/unoserver/H2Orestart/faster-whisper), Temporal 워크플로우 |
| `docs/superpowers/plans/2026-04-09-plan-4-agent-core.md` | Compiler, Research, Librarian 에이전트 (Python LangGraph + Temporal) |
| `docs/superpowers/plans/2026-04-09-plan-5-knowledge-graph.md` | LightRAG 동기화, Cytoscape 5뷰 (Graph/Mindmap/Cards/Canvas/Timeline) + Backlinks, Visualization Agent (Task M1) |
| `docs/superpowers/plans/2026-04-09-plan-6-learning-system.md` | Socratic (Python worker), SM-2 플래시카드, Tool Templates, Cards 뷰 통합 |
| `docs/superpowers/plans/2026-04-09-plan-7-canvas-sandbox.md` | 브라우저 샌드박스 (Pyodide + iframe, ADR-006), Code Agent |
| `docs/superpowers/plans/2026-04-09-plan-8-remaining-agents.md` | Connector, Temporal, Synthesis, Curator, Narrator, Deep Research (Python + LangGraph) |
| `docs/superpowers/plans/2026-04-09-plan-9-billing-marketing.md` | Toss Payments (한국 원화), 랜딩 페이지, 블로그, BYOK, 환불 정책, Export API (GDPR) |
| `docs/superpowers/plans/2026-04-13-multi-llm-provider.md` | packages/llm, provider adapters (Gemini/Ollama), VECTOR_DIM, Docker Ollama |
| `docs/superpowers/plans/2026-04-15-plan-10-document-skills.md` | Document skills (PDF/DOCX/PPTX 생성) — 2026-04-15 spec 기반 실행 플랜 |
