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

Hierarchy: **Workspace → Project → Page**. Workspace가 격리 경계, 하위는 상속 + override.

## Rules & Workflow

- **Project rules** (Frontend/Backend/DB/Worker/AI/Security) → `opencairn:rules` skill
- **Post-feature workflow** (Verification → Review → Docs → Commit) → `opencairn:post-feature` skill
- **Commit conventions** → `opencairn:commit` skill
- **i18n** (Plan 9a 이후): `apps/web`의 user-facing 문자열은 모두 `messages/{locale}/*.json` 키. ESLint `i18next/no-literal-string` + `pnpm --filter @opencairn/web i18n:parity` CI enforced. 카피: 존댓말 · 경쟁사 미언급 · 기술 스택 상세 최소화. 상세 + 예외: `docs/superpowers/specs/2026-04-20-web-foundation-design.md` § i18n 규율.

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

- ✅ Complete: Plan 1, 13, 12, 3, 4, 9a, 2A (editor core, solo).
- 🟡 Active / next: Plan 2B (Hocuspocus + comments + @mention), 2C (notifications + share), 2D (chat renderer + block extensions), 2E (tab shell), Plan 5/6/7/8.
- 🔴 Blocked: Plan 9b (사업자등록 필요).
