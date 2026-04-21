# Plans Status

Critical path (Phase 0 → 1 → 2 → 3 순서. Phase 0 내부는 **직렬** (`Plan 1 → Plan 13 → Plan 12`). Phase 1은 Plan 12 완료 후 **Plan 2/3/4/9 병렬**, Phase 2는 Plan 4 완료 후 **Plan 5/6/7/8 병렬**.).

Plan 파일 위치: `docs/superpowers/plans/`.

## Phase 0 — Foundation (직렬) ✅

| Plan                                 | Status                            | Summary                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2026-04-09-plan-1-foundation.md`    | ✅ 2026-04-20, HEAD `50eaf3b`    | Monorepo, DB schema (Workspace 3계층 + 권한), Better Auth, workspace/member/invite CRUD, permissions helpers, Docker, Resend, CI/CD. Task B1 (백업 스크립트)은 배포 준비 단계에서 별도.                |
| `2026-04-13-multi-llm-provider.md`   | ✅ 2026-04-20                     | `packages/llm` (Gemini/Ollama async providers + factory, 22/22 pytest), `user_preferences` 테이블, Ollama docker profile, LLM env block.                                                                     |
| `2026-04-20-plan-12-agent-runtime.md` | ✅ 2026-04-20                     | `apps/worker/src/runtime/` facade (60/60 pytest): `@tool`, `AgentEvent` 9종 + Zod mirror, `Agent` ABC + LangGraph stream adapter, 3계층 훅, NDJSON trajectory + `agent_runs` 테이블, default hooks, eval. |

## Phase 1 — Core

| Plan                                                   | Status                            | Summary                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-04-21-plan-2a-editor-core.md`                    | ✅ 2026-04-21, HEAD `aa49113`   | Plate v49 기반 솔로 에디터: basic nodes + LaTeX(KaTeX) + wiki-link(Cmd+K combobox) + slash menu(9 commands) + debounced save/load + 사이드바(folder tree + note list). Hocuspocus/코멘트/@mention 없음. 기존 Plan 2 Task 1~7 범위 대체. |
| `2026-04-09-plan-2-editor.md` (Task 8~21)              | 🟡 2B/2C/2D/2E 로 분해 예정       | 남은 범위: Hocuspocus 동시편집, 코멘트, @mention, 알림, 공개 링크, guest 초대, chat 렌더러, 에디터 블록(Mermaid/SVG/Toggle/Table/Column), Chat→Editor 변환, Multi-Mode Tab Shell + Split Pane + Diff View + Command Palette. **워크스페이스 admin 설정 UI**(일반 설정 / 멤버 관리 / 초대 관리; 백엔드 API는 Plan 1에서 완료, `api-contract.md` §Workspaces)도 Plan 2C(공유/권한)에 흡수. 각 단계별 brainstorm → spec → plan 사이클. 상세 specs: `tab-system-design.md`. |
| `2026-04-09-plan-3-ingest-pipeline.md`                 | ✅ 2026-04-20, merge `c859a29`   | `/api/ingest` (bodyLimit + MIME 허용리스트 + `canWrite`) + MinIO + Temporal 스캐폴드. 8 activities (PDF/STT/Image/YouTube/Web/Enhance/Note/Quarantine). `generate_multimodal` 확장, quarantine. 60+29 pytest. Follow-up: markitdown/unoserver, scan PDF OCR, streaming upload.                                    |
| `2026-04-21-plan-3b-batch-embeddings.md`               | 🟡 Planned (2026-04-21)           | Gemini `asyncBatchEmbedContent` 전환으로 embed 단가 50% 추가 절감 (ADR-007 후속). `packages/llm` 배치 서피스 + `embedding_batches` 테이블 + `BatchEmbedWorkflow` child + Compiler/Librarian 통합. feature flag + sync fallback. Research(query-time)는 제외. |
| `2026-04-09-plan-4-agent-core.md`                      | ✅ 2026-04-21, merge `7947f9c`   | Phase A (Compiler, merge `3a9ef42`) + Phase B: `/internal/notes/hybrid-search` (pgvector + BM25 + RRF, migration 0006), Librarian 보조 엔드포인트, row-count `project_semaphore_slots`, Research/Librarian `runtime.Agent`, Librarian Temporal Schedule, worker `--profile worker`. 95+29 pytest. Follow-up: Task 8 E2E 스모크, `notes.embedding` 백필. |
| `2026-04-20-plan-9a-web-foundation-and-landing.md`     | ✅ 2026-04-20, HEAD `415d668`    | 테마(4팔레트) + i18n(next-intl, ko/en, ESLint no-literal-string, parity CI) + 랜딩 10섹션 포트 SSG + sitemap/robots + Playwright smoke. Lighthouse는 프로덕션 배포 시 수동. 본 Plan 후 모든 user-facing 문자열은 i18n 키 강제.                                                                                         |
| `2026-04-09-plan-9b-billing-engine.md`                 | 🔴 BLOCKED (사업자등록)          | PAYG 크레딧 엔진, Toss 연동, 결제 UI, 환불, Export(GDPR), 블로그, 법적 문서 본문. Plan 9a의 Pricing 섹션 숫자를 API로 교체.                                                                                                                                                                                         |

## Phase 2 — Scale (Plan 4 후, 병렬 가능)

| Plan                                           | Summary                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `2026-04-09-plan-5-knowledge-graph.md`         | LightRAG 동기화, Cytoscape 5뷰 (Graph/Mindmap/Cards/Canvas/Timeline) + Backlinks, Visualization Agent. |
| `2026-04-09-plan-6-learning-system.md`         | Socratic (Python worker), SM-2 플래시카드, Tool Templates, Cards 뷰 통합.                         |
| `2026-04-09-plan-7-canvas-sandbox.md`          | 브라우저 샌드박스 (Pyodide + iframe, ADR-006), Code Agent.                                        |
| `2026-04-09-plan-8-remaining-agents.md`        | Connector, Temporal, Synthesis, Curator, Narrator, Deep Research (Python + LangGraph).            |

## Phase 3 — Add-ons

| Plan                                                 | Summary                                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-04-15-plan-10-document-skills.md`              | Document skills (LaTeX/DOCX/PPTX/PDF 생성).                                                                                            |
| `2026-04-20-plan-11a-chat-scope-foundation.md`       | Chat scope 캐논: Conversation 테이블, Cursor-style 칩 UI, Strict/Expand RAG, Pin + 권한 경고, 비용 추적. Plan 11B(메모리)/11C(뷰어)는 후속 brainstorm-plan 사이클. |
