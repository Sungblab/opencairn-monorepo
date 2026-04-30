# OpenCairn

AI-powered personal + team knowledge OS. **Notion 대체 포지션**, 12 에이전트, multi-LLM (Gemini/Ollama), Docker self-hosted, **dual-licensed (AGPL-3.0-or-later + commercial)**.

> ⚠️ **완료 표기 신뢰도** — `plans-status.md` ✅ 다수가 silent stub/placeholder/cron 미스케줄 상태로 마감된 적이 있어, 박제된 audit로 추적: **`docs/review/2026-04-28-completion-claims-audit.md`**. 2026-04-29 시점 Tier 1 #1·#2·#3 (chat real LLM, PR #116), Tier 2 #2.1 (인증 이메일 실송신), Tier 3 #3.1 (Plan 8 cron + UI hooks, PR #141·#143), Tier 4 (Phase 5 라우트 기본 ON, PR #144), Tier 5 §5.1 (research transactions) **모두 closed**. 남은 갭: BYOK key rotation (Tier 5 §5.2), CI/CD (`.github/`), Ralph audit Critical S3-020 + High 23 (S3-006 + S3-052 closed on `fix/ralph-reliability-compose`; `docs/review/2026-04-28-ralph-audit/CONSOLIDATED.md`).

## Architecture

```
apps/web        — Next.js 16. UI + 브라우저 샌드박스 (Pyodide + iframe).
apps/api        — Hono 4. ALL business logic + 권한 헬퍼.
apps/worker     — Python. Temporal + 자체 `runtime.Agent` (`apps/worker/src/runtime/`). 12 AI 에이전트.
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
- **Windows/PowerShell 로그 인코딩**: GitHub Actions 로그, `gh run view`, Python subprocess 출력처럼 UTF-8 문자가 섞일 수 있는 출력을 PowerShell/Windows Python에서 읽을 때는 CP949 기본 디코딩을 믿지 말 것. `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8` 또는 PowerShell `$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()`를 먼저 설정하고, 스크립트가 `text=True`/기본 locale로 `gh` 출력을 읽으면 UTF-8 명시 옵션으로 수정한다.

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
| **완료 표기 audit (2026-04-28)** — silent gap 박제 | `docs/review/2026-04-28-completion-claims-audit.md` |

## Plans

Critical path: **0 (1 → 13 → 12) → 1 (2/3/4/9 병렬) → 2 (5/6/7/8 병렬) → 3**. 완료 커밋 + 상세 상태는 `docs/contributing/plans-status.md`.

- ✅ Complete: Plan 1, 13, 12, 3, 3b, 4, 9a, 2A (editor core, solo), 2B (Hocuspocus + comments + @mention), 2C (share links + per-note permissions + comment_reply/share_invite/research_complete notification wiring), 2D (chat renderer + 5 editor blocks + save_suggestion), 2E Phase A (mermaid theme reactivity + paste-norm + table row/col context menu + escape-norm helper, PR #171), 2E Phase B (image block + embed block + column drag-resize + inline-math UX triggers + KaTeX edit popover + static math renderers, PR #178 [B-0~B-3] + PR #179 [B-4 math UX + B-5 polish]), 5 (KG Phase 1 + Phase 2: Cytoscape 5-view + Backlinks + Visualization Agent), 6 (Learning System: SM-2 flashcards + Socratic Agent + Tool Templates + Review UI), 8 (Synthesis + Curator + Connector + Staleness + Narrator agents + cron schedules PR #141 + UI entrypoints PR #143), Synthesis Export (Plan 2026-04-27, Phases A–F on `feat/plan-synthesis-export`: LaTeX/DOCX/PDF/MD pipeline + `apps/tectonic` MSA Pro tier + `/synthesis-export` web route, flag-gated `FEATURE_SYNTHESIS_EXPORT`/`FEATURE_TECTONIC_COMPILE` default OFF, supersedes Plan 10), Live Ingest Visualization (Redis pub/sub + SSE + spotlight/dock UI, PR #56), Literature Search & Auto-Import (arXiv+SS+Crossref+Unpaywall federation + LitImportWorkflow + DOI dedupe, PR #57+#59), Content-Aware Enrichment Spec B (note_enrichments + 3 worker activities + IngestWorkflow splice, PR #58), Ingest Source Expansion, Onboarding, Agent Runtime v2 Sub-A, React Email, Deep Research Phase A/B/C/D/E (features), App Shell Phase 1 (shell frame) + Phase 2 (sidebar) + Phase 3-A (tab bar chrome) + Phase 3-B (mode router + viewers) + Phase 4 (agent panel, real LLM via PR #116) + Phase 5 (routes + palette + notifications, defaults ON via PR #144), Plan 7 Phase 1 (Canvas web runtime + Tab Mode Router) + Phase 2 (Code Agent + /api/code/run + Monaco), Plan 11A (Chat Scope Foundation + real LLM via PR #116), Plan 11B Phase A (DocEditorAgent + 4 LLM-only slash commands + InlineDiffSheet + `doc_editor_calls` audit, PR #61) + Chat Real LLM Wiring (audit Tier 1 #1·#2·#3 마감, PR #116) + RAG slash commands (PR #153), Plan 3 Office/HWP parser (markitdown + unoserver + H2Orestart, audit Tier 1 #4 마감), self-hosted compose path (audit Tier 2 #2.2 마감, PR #138), MCP Client Phase 1 (per-user MCP server registry + SSRF guard, main `1a36177`), Tech Debt Sprint 1 (Phase 5 a/c/f + Plan 7 Tier-S).
- 🟡 Active / next: Deep Research prod release (manual env flip), Plan 11B Phase B (`/cite` + `/factcheck` RAG slash commands — plan-only on `docs/plan-11b-phase-b` worktree, depends on Phase A merge + ResearchAgent.hybrid_search builtin tool), BYOK key rotation (audit Tier 5 §5.2), CI/CD 복원 (`.github/` 미존재), Synthesis Export production rollout (manual flag flip + Tectonic profile bring-up).
- ✅ Complete: Plan 1, 13, 12, 3, 3b, 4, 9a, 2A (editor core, solo), 2B (Hocuspocus + comments + @mention), 2C (share links + per-note permissions + comment_reply/share_invite/research_complete notification wiring), 2D (chat renderer + 5 editor blocks + save_suggestion), 2 Task 14 (email notification dispatcher — Resend/SMTP/console transport + 5 per-kind templates + DigestEmail + per-user×per-kind preferences with instant/15-min/daily-digest frequencies, advisory-locked 60s setInterval inside apps/api, migration 0039), 2E Phase B (image block + embed block + column drag-resize + inline-math UX triggers + KaTeX edit popover + static math renderers, PR #178 [B-0~B-3] + PR #179 [B-4 math UX + B-5 polish]), 5 (KG Phase 1 + Phase 2: Cytoscape 5-view + Backlinks + Visualization Agent), 6 (Learning System: SM-2 flashcards + Socratic Agent + Tool Templates + Review UI), 8 (Synthesis + Curator + Connector + Staleness + Narrator agents + cron schedules PR #141 + UI entrypoints PR #143), Synthesis Export (Plan 2026-04-27, Phases A–F on `feat/plan-synthesis-export`: LaTeX/DOCX/PDF/MD pipeline + `apps/tectonic` MSA Pro tier + `/synthesis-export` web route, flag-gated `FEATURE_SYNTHESIS_EXPORT`/`FEATURE_TECTONIC_COMPILE` default OFF, supersedes Plan 10), Live Ingest Visualization (Redis pub/sub + SSE + spotlight/dock UI, PR #56), Literature Search & Auto-Import (arXiv+SS+Crossref+Unpaywall federation + LitImportWorkflow + DOI dedupe, PR #57+#59), Content-Aware Enrichment Spec B (note_enrichments + 3 worker activities + IngestWorkflow splice, PR #58), Ingest Source Expansion, Onboarding, Agent Runtime v2 Sub-A, React Email, Deep Research Phase A/B/C/D/E (features), App Shell Phase 1 (shell frame) + Phase 2 (sidebar) + Phase 3-A (tab bar chrome) + Phase 3-B (mode router + viewers) + Phase 4 (agent panel, real LLM via PR #116) + Phase 5 (routes + palette + notifications, defaults ON via PR #144), Plan 7 Phase 1 (Canvas web runtime + Tab Mode Router) + Phase 2 (Code Agent + /api/code/run + Monaco), Plan 11A (Chat Scope Foundation + real LLM via PR #116), Plan 11B Phase A (DocEditorAgent + 4 LLM-only slash commands + InlineDiffSheet + `doc_editor_calls` audit, PR #61) + Chat Real LLM Wiring (audit Tier 1 #1·#2·#3 마감, PR #116) + RAG slash commands (PR #153), Plan 3 Office/HWP parser (markitdown + unoserver + H2Orestart, audit Tier 1 #4 마감), self-hosted compose path (audit Tier 2 #2.2 마감, PR #138), MCP Client Phase 1 (per-user MCP server registry + SSRF guard, main `1a36177`), Tech Debt Sprint 1 (Phase 5 a/c/f + Plan 7 Tier-S).
- 🟡 Active / next: Deep Research prod release (manual env flip), Plan 11B Phase B (`/cite` + `/factcheck` RAG slash commands — plan-only on `docs/plan-11b-phase-b` worktree, depends on Phase A merge + ResearchAgent.hybrid_search builtin tool), CI/CD 복원 (`.github/` 미존재), Synthesis Export production rollout (manual flag flip + Tectonic profile bring-up).
- 🔴 Blocked: Plan 9b (사업자등록 필요).
- ⚠️ Superseded: Plan 10 (document-skills) → Synthesis Export.
