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

> **상태**: greenfield. 2026-04-20 기준 코드 0줄, 모노레포 스캐폴딩 미생성. 모든 plan 실행은 monorepo bootstrap (Plan 1 Task 1)부터 시작. 데이터 모델은 처음부터 workspace 3계층 — `projects.user_id` 같은 옛 컬럼은 존재한 적 없음 (2026-04-18 "breaking change" 표현은 spec 진화 의미, 마이그레이션 의미 아님).

> 2026-04-14 업데이트: `apps/sandbox` 폐기 (gVisor 제거). 코드 실행은 전부 브라우저 (Pyodide/iframe, [ADR-006](docs/architecture/adr/006-pyodide-iframe-sandbox.md)). 파싱 스택은 opendataloader-pdf + markitdown + unoserver + H2Orestart + faster-whisper. 시각화는 Cytoscape 5뷰 (Visualization Agent 추가로 12 에이전트). 결제는 Toss Payments (한국 원화). 상세는 세션 커밋 `7587347`.
>
> 2026-04-15 업데이트: OpenAI provider 제거. `packages/llm`은 Gemini + Ollama 2개만 지원.
>
> **2026-04-18 업데이트**: Notion급 팀 협업을 v0.1에 포함. Workspace 계층 + 역할 기반 권한 + Hocuspocus auth hook + 코멘트 + @mention + 알림 + 활동 피드 + 공개 링크 + 게스트. 페르소나 3단계 확장 (v0.1 대학원생 → v0.2 연구실 → v0.3 규제 산업 엔터프라이즈). 데이터 모델 breaking change: `projects.user_id` → `projects.workspace_id`. 상세: [collaboration-model.md](docs/architecture/collaboration-model.md).
>
> **2026-04-19 업데이트**: 가격 모델 전면 개편. Pro ₩29,000 flat → **Pro ₩4,900 구독료 + PAYG** (최소 ₩5,000 선불 크레딧, 만료 없음, `$1 = ₩1,650` 차감). BYOK ₩6,900 → **₩2,900 서버 임대비** (본인 Gemini 키, Pro 팀 기능 제외, 단일 사용자 호스팅). 상세: [billing-model.md](docs/architecture/billing-model.md).
>
> **2026-04-20 업데이트**: Agent Chat Scope 캐논 정의 — Page/Project/Workspace 3계층 스코프, Cursor-style 칩 UI, L1-L4 메모리, Strict/Expand RAG, 답변 핀 + 권한 경고, PDF 통일 뷰어. Plan 11A 추가 (Plan 11B/11C는 후속). **결제 레일은 사업자등록 후 결정으로 deferral** (현재 BLOCKED). 상세: [agent-chat-scope-design.md](docs/superpowers/specs/2026-04-20-agent-chat-scope-design.md), [billing-model.md](docs/architecture/billing-model.md).

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
| 호스팅 서비스 경계 (법적 문서/블로그 위치, repo 포함 범위) | `docs/contributing/hosted-service.md` |
| Multi-LLM provider 설계 (Gemini/Ollama) | `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md` |
| Document skills 설계 (문서 생성 → PDF/DOCX/PPTX) | `docs/superpowers/specs/2026-04-15-document-skills-design.md` |
| 스토리지/사이징 계산 (벡터 DB, 사용자별 용량) | `docs/architecture/storage-planning.md` |
| DB 백업/복구/데이터 포터빌리티 전략 | `docs/architecture/backup-strategy.md` |
| 보안 모델 (BYOK 키, 권한, CSP, rate limit, Hocuspocus auth) | `docs/architecture/security-model.md` |
| **과금 모델 (Free/BYOK/Pro/Self-host/Enterprise, PAYG 크레딧, 환율, 잔액 UX, 환불)** | `docs/architecture/billing-model.md` |
| 장애 대응 / 온콜 / 알럿 채널 | `docs/runbooks/incident-response.md` |
| 브라우저 샌드박스 E2E 테스트 (Pyodide/iframe) | `docs/testing/sandbox-testing.md` |
| **Agent Runtime Standard** (Tool/AgentEvent/Agent/Hook/Trajectory/Eval 계약) | `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md` |
| **탭 시스템 설계** (Multi-Mode Tab 11종, Split Pane, Diff View, Whiteboard, Presentation, Command Palette, AI↔탭 프로토콜) | `docs/superpowers/specs/2026-04-20-tab-system-design.md` |

### Implementation Plans

**Critical path** (Phase 0 → 1 → 2 → 3 순서. Phase 0 내부는 **직렬** (`Plan 1 → Plan 13 → Plan 12`). Phase 1은 Plan 12 완료 후 **Plan 2/3/4/9 병렬**, Phase 2는 Plan 4 완료 후 **Plan 5/6/7/8 병렬**.):

| Phase | Plan | Scope |
|-------|------|-------|
| **0 — Foundation (직렬, 1단계)** ✅ | `plans/2026-04-09-plan-1-foundation.md` | **완료 (2026-04-20, HEAD `50eaf3b`)** — Monorepo, DB schema (**Workspace 3계층 + 권한**), Better Auth, workspace/member/invite CRUD, permissions helpers (`canRead`/`canWrite`/`requireWorkspaceRole`), Docker, Resend, CI/CD. Task B1 (백업 스크립트)은 배포 준비 단계에서 별도 진행. **Plan 13의 prerequisite — 이제 실행 가능.** |
| **0 — Foundation (직렬, 2단계)** ✅ | `plans/2026-04-13-multi-llm-provider.md` | **완료 (2026-04-20)** — packages/llm (Gemini/Ollama async providers + factory, 22/22 pytest), `user_preferences` 테이블, Ollama docker profile, LLM env block. **Plan 12의 prerequisite — 이제 실행 가능.** |
| **0 — Foundation (직렬, 3단계)** ✅ | `plans/2026-04-20-plan-12-agent-runtime.md` | **완료 (2026-04-20)** — `apps/worker/src/runtime/` facade (60/60 pytest): `@tool` 데코레이터, `AgentEvent` 9종 + Zod mirror, `Agent` ABC + LangGraph stream adapter, 3계층 훅 (Agent/Model/Tool) + HookChain, NDJSON trajectory (LocalFS) + `agent_runs` DB 테이블 (migration 0004), Gemini/Ollama tool declaration builders, `keep_last_n` reducer, Temporal 헬퍼 (`make_thread_id`/`AgentAwaitingInputError`), default hooks (TrajectoryWriter/TokenCounter/Sentry/Latency), eval 프레임워크, import boundary checker. **Phase 1/2 에이전트 plan(Plan 4/5/6/7/8)의 prerequisite — 이제 실행 가능.** Spec: `2026-04-20-agent-runtime-standard-design.md` |
| **1 — Core (Plan 12 완료, Plan 2/3/4/9 병렬 실행 가능)** | `plans/2026-04-09-plan-2-editor.md` | Plate v49 에디터 + **Notion급 협업**: Hocuspocus auth hook, 실시간 공동 편집 + Presence, block-anchor 코멘트 + 스레드, @mention, 알림 (SSE+이메일), activity feed, 공개 공유 링크, guest 초대. **Task 18~20(2026-04-20 추가)**: Claude급 채팅 렌더러(Mermaid/SVG/KaTeX/syntax highlighting), Notion 이상급 에디터 블록(Mermaid/SVG/Embed/Callout/Toggle/Table/Column), Chat→Editor 자동 블록 변환. **Task 21~24(2026-04-20 추가)**: Multi-Mode Tab Shell(plate\|artifact\|data\|source\|canvas\|reading\|spreadsheet\|whiteboard\|presentation\|mindmap\|flashcard) + Split Pane(`⌘\`) + Diff View(AI hunk accept/reject) + Reading/Spreadsheet/Whiteboard/Presentation/Command Palette. 상세: `2026-04-20-tab-system-design.md` |
| **1** | `plans/2026-04-09-plan-3-ingest-pipeline.md` | 파일 업로드, 파싱 (opendataloader-pdf/markitdown/unoserver/H2Orestart/faster-whisper), Temporal 워크플로우 |
| **1** | `plans/2026-04-09-plan-4-agent-core.md` | Compiler, Research, Librarian 에이전트 (Python LangGraph + Temporal, **`runtime.Agent` 서브클래스 패턴**). **Task 0에서 Plan 1·13·12·3 완료 검증** |
| **1** | `plans/2026-04-20-plan-9a-web-foundation-and-landing.md` | **테마(4팔레트) + i18n 인프라(next-intl, ko-first) + 랜딩 포트(landing.html → Next.js 섹션 10개)**. Plan 1 독립. 본 Plan 후 모든 user-facing 문자열은 i18n 키 강제. |
| **1** | `plans/2026-04-09-plan-9b-billing-engine.md` | **BLOCKED (사업자등록 후)** PAYG 크레딧 엔진, Toss 연동, 결제 UI, 환불, Export(GDPR), 블로그, 법적 문서 본문. Plan 9a의 Pricing 섹션 숫자를 API로 교체. |
| **2 — Scale (Plan 4 후)** | `plans/2026-04-09-plan-5-knowledge-graph.md` | LightRAG 동기화, Cytoscape 5뷰 (Graph/Mindmap/Cards/Canvas/Timeline) + Backlinks, Visualization Agent (Task M1) |
| **2** | `plans/2026-04-09-plan-6-learning-system.md` | Socratic (Python worker), SM-2 플래시카드, Tool Templates, Cards 뷰 통합 |
| **2** | `plans/2026-04-09-plan-7-canvas-sandbox.md` | 브라우저 샌드박스 (Pyodide + iframe, ADR-006), Code Agent |
| **2** | `plans/2026-04-09-plan-8-remaining-agents.md` | Connector, Temporal, Synthesis, Curator, Narrator, Deep Research (Python + LangGraph) |
| **3 — Add-ons** | `plans/2026-04-15-plan-10-document-skills.md` | Document skills (LaTeX/DOCX/PPTX/PDF 생성) — 2026-04-15 spec |
| **3** | `plans/2026-04-20-plan-11a-chat-scope-foundation.md` | **Chat scope 캐논**: Conversation 테이블, Cursor-style 칩 UI, Strict/Expand RAG, Pin + 권한 경고, 비용 추적. Plan 11B(메모리)/11C(뷰어)는 후속 brainstorm-plan 사이클 |
