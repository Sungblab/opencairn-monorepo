# OpenCairn Docs Index

필요할 때 읽기. 한 번에 다 로드하지 말 것.

## Core architecture & product

| Need                                                       | Read                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| System design, tech stack, full architecture               | `superpowers/specs/2026-04-09-opencairn-design.md`                   |
| User stories, personas, requirements                       | `superpowers/specs/2026-04-09-opencairn-prd.md`                      |
| API endpoints, request/response format                     | `architecture/api-contract.md`                                       |
| Data flow (ingest → wiki → Q&A)                            | `architecture/data-flow.md`                                          |
| **협업 모델** (Workspace/권한/Hocuspocus/코멘트/알림)       | `architecture/collaboration-model.md`                                |
| Architecture Decision Records                               | `architecture/adr/`                                                  |
| 보안 모델 (BYOK 키, 권한, CSP, rate limit, Hocuspocus auth) | `architecture/security-model.md`                                     |
| 스토리지/사이징 계산 (벡터 DB, 사용자별 용량)               | `architecture/storage-planning.md`                                   |
| DB 백업/복구/데이터 포터빌리티 전략                          | `architecture/backup-strategy.md`                                    |
| **과금 모델** (Free/BYOK/Pro/Self-host/PAYG 크레딧/환불)    | `architecture/billing-model.md`                                      |

## Agents & runtime

| Need                                                            | Read                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Agent guardrails, stop conditions, conflicts                    | `agents/agent-behavior-spec.md`                                      |
| Temporal workflows, retry policies                              | `agents/temporal-workflows.md`                                       |
| Gemini caching, embeddings, prompts, RAG                        | `agents/context-management.md`                                       |
| **Agent Runtime Standard** (Tool/Event/Agent/Hook/Trajectory)    | `superpowers/specs/2026-04-20-agent-runtime-standard-design.md`     |
| Multi-LLM provider 설계 (Gemini/Ollama)                         | `superpowers/specs/2026-04-13-multi-llm-provider-design.md`         |
| Document skills (PDF/DOCX/PPTX 생성)                            | `superpowers/specs/2026-04-15-document-skills-design.md`            |
| **탭 시스템** (Multi-Mode Tab, Split Pane, Diff, Command Palette) | `superpowers/specs/2026-04-20-tab-system-design.md`                 |
| **Ingest source expansion** (Drive + Notion one-shot import)     | `superpowers/specs/2026-04-22-ingest-source-expansion-design.md`    |

## Ops & contributing

| Need                                                    | Read                                   |
| ------------------------------------------------------- | -------------------------------------- |
| Dev setup, conventions, troubleshooting                 | `contributing/dev-guide.md`            |
| Test strategy, CI pipeline                              | `testing/strategy.md`                  |
| 브라우저 샌드박스 E2E (Pyodide/iframe)                   | `testing/sandbox-testing.md`           |
| Claude 반복 실수, 하지 말 것 목록                        | `contributing/llm-antipatterns.md`     |
| 호스팅 서비스 경계 (법적 문서/블로그 위치, repo 포함 범위) | `contributing/hosted-service.md`       |
| 장애 대응 / 온콜 / 알럿 채널                             | `runbooks/incident-response.md`        |
| **Super Admin 콘솔** (운영자 전용, 이상 사용자 대응 MVP)  | `superpowers/specs/2026-04-22-super-admin-console-design.md` |
| **Plan별 완료 상태 + 커밋**                              | `contributing/plans-status.md`         |
| **⚠️ 완료 표기 audit (2026-04-28)** — Phase 0/1/2 silent gap 박제 (`plans-status.md` ✅ 신뢰 금지) | `review/2026-04-28-completion-claims-audit.md` |
