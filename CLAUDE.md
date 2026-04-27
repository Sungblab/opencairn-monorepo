# OpenCairn

AI-powered personal + team knowledge OS. **Notion 대체 포지션**, 12 에이전트, multi-LLM (Gemini/Ollama), Docker self-hosted, AGPLv3.

## Architecture

```
apps/web        — Next.js 16. UI + 브라우저 샌드박스 (Pyodide + iframe).
apps/api        — Hono 4. ALL business logic + 권한 헬퍼.
apps/worker     — Python. LangGraph + Temporal. 12 AI 에이전트.
apps/hocuspocus — Yjs 협업 서버 (Better Auth + page-level 권한 hook).
packages/db     — Drizzle ORM + pgvector + workspace 3계층 권한.
packages/emails — react-email v6 템플릿 + Resend. Layout/Button/InviteEmail.
packages/llm    — Python. LLM provider 추상화 (Gemini/Ollama).
packages/shared — Zod 스키마 (API 계약).
```

Hierarchy: **Workspace → Project → Page**. Workspace가 격리 경계, 하위는 상속 + override.

## Rules & Workflow

- **Project rules** (Frontend/Backend/DB/Worker/AI/Security) → `opencairn:rules` skill
- **Post-feature workflow** (Verification → Review → Docs → Commit) → `opencairn:post-feature` skill
- **Commit conventions** → `opencairn:commit` skill
- **병렬 세션 = 워크트리 필수** → Phase 1/2처럼 병렬 가능한 플랜을 동시에 진행하거나, 다른 세션과 별개 작업을 돌릴 때는 `git worktree`로 분리 (`superpowers:using-git-worktrees` skill). 같은 워킹트리에서 두 플랜을 섞으면 빌드/테스트/i18n parity가 서로 깨짐. 사례: `.worktrees/plan-5-kg-impl`, `opencairn-v2a`, `feat/plan-3b-prod-gates` (App Shell 3-B와 병렬).
- **i18n** (Plan 9a 이후): `apps/web`의 user-facing 문자열은 모두 `messages/{locale}/*.json` 키. ESLint `i18next/no-literal-string` + `pnpm --filter @opencairn/web i18n:parity` CI enforced. 카피: 존댓말 · 경쟁사 미언급 · 기술 스택 상세 최소화. 상세 + 예외: `docs/superpowers/specs/2026-04-20-web-foundation-design.md` § i18n 규율.
- **OSS/호스팅 분리**: 브랜드·도메인·연락처·SEO 메타는 하드코딩 금지, env + 디폴트 패턴. 시크릿만 `.gitignore`. 상세: `docs/contributing/hosted-service.md` § Branding & SEO. 실제 sweep은 Plan 9b.

## Commands

```bash
pnpm dev                           # all services
pnpm --filter @opencairn/<pkg> dev # 개별 패키지 (api/web/worker)
pnpm db:generate / db:migrate      # Drizzle
docker-compose up -d               # infra
```

## Docs

Full index: **`docs/README.md`**. 고빈도:

| Need                             | Read                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| System design, architecture      | `docs/superpowers/specs/2026-04-09-opencairn-design.md`        |
| API contract                     | `docs/architecture/api-contract.md`                            |
| Data flow (ingest → wiki → Q&A)  | `docs/architecture/data-flow.md`                               |
| 협업 모델 (권한/Hocuspocus/코멘트) | `docs/architecture/collaboration-model.md`                     |
| Agent Runtime Standard           | `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md` |
| 탭 시스템 설계                    | `docs/superpowers/specs/2026-04-20-tab-system-design.md`       |
| 컨텍스트 예산 정책 (RAG/wiki 주입) | `docs/architecture/context-budget.md`                          |
| Claude 반복 실수 목록             | `docs/contributing/llm-antipatterns.md`                        |

## Plans

Critical path: **0 (1 → 13 → 12) → 1 (2/3/4/9 병렬) → 2 (5/6/7/8 병렬) → 3**. 완료 커밋 + 상세 상태는 `docs/contributing/plans-status.md`.

- ✅ Complete: Plan 1, 13, 12, 3, 3b, 4, 9a, 2A (editor core, solo), 2B (Hocuspocus + comments + @mention), 2C (share links + per-note permissions + comment_reply/share_invite/research_complete notification wiring), 2D (chat renderer + 5 editor blocks + save_suggestion), 5 (KG Phase 1 + Phase 2: Cytoscape 5-view + Backlinks + Visualization Agent), 6 (Learning System: SM-2 flashcards + Socratic Agent + Tool Templates + Review UI), 8 (Synthesis + Curator + Connector + Staleness + Narrator agents), Ingest Source Expansion, Onboarding, Agent Runtime v2 Sub-A, React Email, Deep Research Phase A/B/C/D/E (features), App Shell Phase 1 (shell frame) + Phase 2 (sidebar) + Phase 3-A (tab bar chrome) + Phase 3-B (mode router + viewers) + Phase 4 (agent panel) + Phase 5 (routes + palette + notifications), Plan 7 Phase 1 (Canvas web runtime + Tab Mode Router) + Phase 2 (Code Agent + /api/code/run + Monaco), Plan 11A (Chat Scope Foundation: conversations table + chip UI + RAG modes + pin permission warning + cost tracking), Tech Debt Sprint 1 (Phase 5 a/c/f + Plan 7 Tier-S).
- 🟡 Active / next: Live Ingest Visualization (백엔드 4 commits, branch `feat/live-ingest-visualization` 미머지), Synthesis Export (plan only, branch `feat/plan-synthesis-export` 미실행), Deep Research prod release (manual env flip).
- 🔴 Blocked: Plan 9b (사업자등록 필요).
- ⚠️ Superseded: Plan 10 (document-skills) → Synthesis Export.
