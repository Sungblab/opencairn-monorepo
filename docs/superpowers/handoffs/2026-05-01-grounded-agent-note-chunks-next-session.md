# Next Session Prompt: Grounded Agent Note Chunks + LLM Wiki Direction

Copy this into a fresh Codex session.

```text
Respond in Korean.

OpenCairn repo에서 다음 구현으로 Grounded Agent Note Chunks를 진행해줘.

먼저 중요한 방향:
이 작업은 단순 RAG 고도화가 아니라 OpenCairn의 "LLM Wiki" 제품 방향을 받치는 하부 인프라다.
목표는 raw source를 매번 query-time에 재발견하는 RAG가 아니라, LLM이 유지하는 persistent, compounding wiki를 더 정확히 검색/인용/갱신할 수 있게 만드는 것이다.

LLM Wiki 제품 원칙:
- Raw sources는 immutable source of truth다.
- Raw source는 PDF만 의미하지 않는다. 현재 ingest/import 표면은 PDF, Office(DOC/DOCX/PPT/PPTX/XLS/XLSX), HWP/HWPX, TXT/Markdown, image/audio/video, web URL, YouTube, Notion/Drive import, literature paper import까지 포함한다.
- note_chunks / wiki / RAG 구현은 PDF parser에 종속되면 안 된다. ingest 결과로 생성된 source note의 `contentText`, `sourceType`, source metadata 위에서 MIME-agnostic 하게 동작해야 한다.
- Wiki notes는 LLM이 생성/갱신하는 persistent artifact다.
- Query 결과 중 가치 있는 synthesis/comparison/analysis는 다시 wiki page로 저장될 수 있어야 한다.
- Index/log에 해당하는 탐색 catalog와 chronological audit 개념은 이후 상위 spec으로 승격해야 한다.
- 이번 note_chunks 구현은 이 철학의 "paragraph-level evidence retrieval" 기반이다.

시작 전에:
1. AGENTS.md를 읽고 repo rules를 적용해.
2. docs/README.md, docs/contributing/plans-status.md, 그리고 아래 plan/spec을 읽어.
3. git status, git branch, git worktree list를 확인해.
4. 현재 열린 PR/브랜치 작업은 건드리지 마.
5. 새 구현은 반드시 worktree로 분리해.

현재 참고:
- 기존 grounded reliability/spec PR은 merge된 상태일 수 있다. 반드시 origin/main을 fetch해서 최신 main 기준으로 확인해.
- 이전 cleanup 중 .worktrees 안에 물리 폴더 찌꺼기가 일부 남아있을 수 있다. git worktree list에 등록된 worktree만 신뢰해.
- 새 worktree 이름은 충돌 없게 잡아라. 추천:
  - branch: codex/grounded-agent-note-chunks-impl
  - path: .worktrees/grounded-agent-note-chunks-impl
  이미 폴더가 남아 있으면 다른 suffix를 붙여라.

구현 대상 plan:
docs/superpowers/plans/2026-05-01-grounded-agent-note-chunks.md

관련 spec:
docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md

구현 목표:
- note_chunks DB schema 추가
- deterministic note chunker 추가
- note chunk indexer 추가
- chunk-level hybrid search 추가
- chat-retrieval이 chunk search를 먼저 쓰고 기존 note-level retrieval은 fallback으로 유지
- deleted_at denormalization 포함
- source_offsets / heading_path / content_hash / token_count 포함
- chunk search 결과가 citation에 chunk-level 근거를 줄 수 있게 설계

중요 제약:
- apps/web 쪽은 건드리지 마.
- docs/contributing/plans-status.md는 구현 PR merge 전에는 업데이트하지 마.
- DB migration 번호는 직접 추정하지 마. repo의 pnpm db:generate / Drizzle 방식으로 생성해.
- application code에서 raw SQL은 피하고 Drizzle/기존 helper 패턴을 우선해. raw SQL은 migration에만 둬.
- VECTOR_DIM 동작은 기존 vector3072 helper를 유지해. 새 custom vector helper를 만들지 마.
- workspace/project scope와 deleted_at filtering은 retrieval hot path에서 반드시 지켜.
- 기존 note-level retrieval을 깨지 마. chunk index가 없거나 비어 있으면 fallback해야 한다.

작업 방식:
- superpowers:using-git-worktrees, executing-plans, test-driven-development, opencairn-rules 흐름을 따라.
- plan 순서대로 진행하되, 실제 schema/export 이름은 코드에서 확인하고 맞춰.
- 테스트를 먼저 추가하고 RED를 확인해. 단, Windows worktree에서 Vitest가 ERR_PACKAGE_IMPORT_NOT_DEFINED #module-evaluator로 startup 실패할 수 있다. 이 경우 테스트 본문 실행 전 환경 blocker로 기록하고, build/tsc/diff check로 보완 검증해.

검증:
- 가능한 focused tests:
  - packages/db/tests/note-chunks.test.ts
  - apps/api/tests/lib/note-chunker.test.ts
  - apps/api/tests/lib/chunk-hybrid-search.test.ts
  - apps/api/tests/lib/chat-retrieval.test.ts
- build:
  - pnpm --filter @opencairn/db build 또는 해당 package 검증 명령 확인
  - pnpm --filter @opencairn/api build
- git diff --check

완료 조건:
- 변경 파일 요약
- 실행한 검증과 결과
- Vitest blocker가 있으면 정확한 에러 기록
- 남은 리스크
- commit/push/draft PR 생성

후속으로 별도 문서/spec가 필요하면:
LLM Wiki Maintenance Spec을 작성해라. 이건 note_chunks 구현과 별도다.
다룰 내용:
- Raw source / generated wiki / schema 계층 분리
- ingest 시 summary/entity/concept/synthesis page 갱신 workflow
- index/log 역할을 OpenCairn DB/notes 모델에 매핑
- query 결과를 wiki page로 저장하는 flow
- lint/health-check UX: orphan pages, stale claims, contradictions, missing concept pages, weak citations
```

## Next Session After PR #188: Grounded Knowledge Surfaces

Use this once the note chunk PR is merged, or explicitly base a follow-up worktree on
`codex/grounded-agent-note-chunks-impl` if PR #188 is still open.

```text
Respond in Korean.

OpenCairn repo에서 Grounded Knowledge Surfaces 다음 작업을 진행해줘.

목표:
note_chunks로 paragraph-level evidence retrieval 기반이 생겼다는 전제에서,
LLM Wiki / ingest / RAG / knowledge graph / mindmap / card view가 같은 근거 모델을 공유하도록
다음 spec+plan을 작성하고, 구현 가능한 첫 slice를 제안해.

시작 전에:
1. AGENTS.md를 읽고 repo rules를 적용해.
2. docs/README.md, docs/contributing/plans-status.md를 읽어.
3. docs/superpowers/specs/2026-04-30-grounded-agent-retrieval-architecture-design.md를 읽어.
4. docs/superpowers/plans/2026-05-01-grounded-agent-note-chunks.md와 PR #188 상태를 확인해.
5. Plan 5 KG / visualization 관련 파일을 찾아 현재 graph/mindmap/card surface가 어떤 데이터에 묶여 있는지 확인해.
6. git status, git branch, git worktree list를 확인하고 현재 열린 PR/브랜치를 건드리지 마.

아키텍처 방향:
- note_chunks는 raw/source/wiki note에서 공통으로 쓰는 evidence unit이다.
- Knowledge graph edge는 단순히 note-to-note 링크가 아니라 chunk evidence를 가져야 한다.
- Graph/mindmap/card view는 "예쁜 시각화"가 아니라 질문/인제스트/위키 갱신에서 나온 근거를 탐색하고 검증하는 surface다.
- RAG answer, wiki page update, KG edge, card summary는 같은 citation/evidence bundle을 공유해야 한다.
- generated wiki page는 LLM이 유지하는 persistent artifact이고, raw source는 immutable source of truth다.

설계에 반드시 포함할 것:
- EvidenceBundle 모델: note chunk ids, note ids, source offsets, heading path, score, quote/citation metadata.
- Concept/entity extraction 결과가 어떤 chunk evidence에서 왔는지 저장하는 schema.
- KG edge/source claim이 어떤 chunk evidence로 뒷받침되는지 저장하는 schema.
- ingest workflow:
  1. raw source import
  2. contentText/source note 생성
  3. note_chunks indexing
  4. summary/entity/concept/synthesis wiki page update 제안
  5. KG/card/mindmap evidence update
  6. log/audit append
- query workflow:
  1. chunk hybrid search
  2. graph neighborhood expansion
  3. rerank/context budget
  4. answer with citations
  5. valuable answer를 wiki note/card로 저장
- lint workflow:
  stale claims, contradiction candidates, orphan concepts, weakly cited graph edges, missing concept pages.
- UI surface는 apps/web 구현을 바로 하지 말고 API/data contract 중심으로 먼저 잡아라.
  단, graph/mindmap/card view가 최종적으로 어떤 API를 소비해야 하는지는 명확히 써라.

주의:
- apps/web 구현은 하지 마.
- docs/contributing/plans-status.md는 구현 PR merge 전에는 업데이트하지 마.
- DB migration이 필요한 구현을 시작한다면 migration 번호를 수동 추정하지 말고 pnpm db:generate/repo 방식으로 생성해.
- raw SQL은 migration에만 두고 application code는 Drizzle/기존 helper 패턴을 따라.
- VECTOR_DIM/vector3072 helper 동작은 유지해.

결과물:
- spec 문서 1개
- implementation plan 문서 1개
- 다음 구현 slice 추천:
  A. evidence bundle + KG edge evidence schema/API
  B. ingest wiki maintenance worker slice
  C. graph/mindmap/card retrieval API slice
  이 셋 중 dependency가 가장 적고 제품 가치가 큰 순서를 추천해.
- 마지막에 다음 구현 세션용 copy-paste prompt를 문서에 포함해.
```
