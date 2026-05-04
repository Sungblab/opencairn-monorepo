# Context Budget Policy

LLM 호출 한 번에 주입할 컨텍스트 토큰을 **제품 수준에서** 박아두는 정책. RAG/wiki/BM25 하이브리드 구조는 유지하되, 경로마다 토큰 예산을 먼저 정하고 retrieval·wiki 주입 전략은 그 예산에 맞춰 튜닝한다.

**핵심 전제**: OpenCairn이 Notion 대체 + 팀 포지션이므로 "1M long-context에 전부 얹기" 전략은 조직 규모·권한 격리·감사·비용 측면에서 성립하지 않음. 단, 소규모 프로젝트 한정으로는 long-context 모드가 품질·구현 단순성 모두 우월 → **이중 모드**로 제공.

---

## 1. 예산 테이블 (기본값)

| 경로 | 입력 토큰 상한 | Retrieval top-k | Wiki concept 주입 | Body 주입 |
|------|---------------|-----------------|------------------|----------|
| Chat (기본)           | 8k   | 5 chunks           | title + 1-2줄 synopsis × 3개 | ❌ (agent tool call 시만) |
| Chat (power, 유료)     | 32k  | 10 chunks          | synopsis × 8개               | ❌ (agent tool call 시만) |
| Agent tool 호출        | +24k | on-demand          | on-demand                   | ✅ 명시 호출 시 |
| Project long-context   | 최대 200k | — | 전체 concept synopsis | ✅ 전체 원문 |
| Ingest / Compiler      | Plan 3/4 기준 | — | — | — |

- **상한을 넘기면 토큰 아끼는 게 아니라 리턴 품질이 깨짐** (lost-in-the-middle). 상한은 성능 상한이지 비용 상한이 아님.
- 유료 플랜이라고 기본값을 64k로 올리지 않는다. 더 큰 컨텍스트가 더 좋은 답을 보장하지 않음 — rerank 품질이 먼저.

---

## 2. 이중 모드 UX

프로젝트 단위로 자동 판별 (ingest 완료 시 누적 토큰 수 기준):

- **Small mode** (프로젝트 내 원문 합 < 200k 토큰)
  - 전체 원문 + concept를 Gemini long-context에 통째로 주입
  - Retrieval 생략, grounding은 소스 앵커로 처리
  - NotebookLM급 UX를 자체 제공하는 경로
- **Large mode** (그 이상)
  - 하이브리드 retrieval (vector + BM25) + wiki concept synopsis
  - 기본 예산표 적용

임계값 200k는 Gemini 2.5 Pro 컨텍스트 + 응답 예산 + 안전 마진 기준. 재튜닝 가능.

---

## 3. Wiki 주입 규율

**기본 원칙: concept는 summary-only 주입, body는 lazy.**

- `concepts` 테이블은 `title`, `synopsis` (1-2줄), `body` (full markdown) 필드 분리 유지
- Chat context builder가 기본적으로 주입하는 건 `title + synopsis`만
- Agent (Librarian/Research)가 `concept.get_body(concept_id)` tool call 할 때만 body 로드
- "Related pages" 같은 UX 힌트는 title만으로 표시

이 규율 하나로 전형적 대화의 토큰 사용량이 30-60% 줄어든다. ADR-007의 768d MRL 임베딩 결정과 같은 결의 "싸고 충분한 품질" 원칙.

---

## 4. Retrieval 품질 규율

- 하이브리드 search는 top-k=20으로 뽑되, **rerank 후 top-5~8**만 LLM에 전달
- Rerank: cross-encoder 또는 Gemini Flash 호출 (한 번에 20개 묶음 평가)
- top-k를 더 늘려서 해결하지 말 것 — recall 올리는 건 rerank 전, LLM에 넘기는 건 rerank 후
- Research agent는 반복 retrieval 가능 (budget 내에서), Chat 기본 경로는 single-shot

---

## 5. 안티패턴

- ❌ "컨텍스트 창이 1M이니까 다 넣자" — 권한·비용·lost-in-the-middle·감사 모두 깨짐
- ❌ Wiki concept body 전체를 프롬프트에 기본 주입 — 토큰 예산 파괴
- ❌ Retrieval top-k를 20~30으로 올려서 LLM에 직접 전달 — precision 무너짐
- ❌ NotebookLM MCP에 팀 데이터 올려서 조직용으로 쓰기 — 테넌트/감사/권한 없음
- ❌ 온톨로지 레이어 선제 구현 — wiki concept 레이어가 이미 그 자리. Plan 4 완료 이후 품질 튜닝 시점에 재평가

---

## 6. 실행 순서

1. **이 문서 자체** (정책 확정) — 2026-04-21
2. **Wiki summary-only 주입** — Plan 4 follow-up. Compiler가 synopsis 생성·저장하고, Chat/Agent context builder는 synopsis만 기본 주입
3. **이중 모드** — Plan 11A/11B 설계 단계에 흡수. 프로젝트 생성·ingest 완료 시 mode 판정
4. **Retrieval rerank** — Plan 5 범주. 하이브리드 search 튜닝 워크에 편입

---

## 참고

- ADR-007 (임베딩 768d MRL) — 같은 "싸고 충분" 원칙
- `docs/architecture/data-flow.md` — ingest → wiki → Q&A 흐름
- `../contributing/roadmap.md` — agent tool-call 계약
- `../contributing/roadmap.md` — provenance·save_suggestion는 본 예산 정책과 정합

---

## 7. Tool path token budgets (Agent Runtime v2 · Sub-A, 2026-04-22)

Sub-project A가 도입한 builtin tools는 각자 bounded response를 반환해 한 턴 안에서 input token budget이 터지지 않도록 설계됨:

| Tool | Mode | Max output chars | Approx tokens |
|------|------|-------------------|---------------|
| `list_project_topics` | — | ~2 KB | ~500 |
| `search_concepts` (k=5) | synopsis | ~4 KB | ~1k |
| `search_notes` (k=5) | synopsis (snippet ≤ 400 ch) | ~2 KB | ~500 |
| `search_notes` (k=5) | full | ~10 KB | ~2.5k |
| `read_note` | — | 50 KB (MAX_CONTENT_CHARS) | ~12k |
| `fetch_url` | — | 10 MB cap / text-only ≤ 50 KB | ~12k |
| `emit_structured_output` | — | ~1 KB | ~250 |

- `ToolLoopExecutor._truncate`는 tool 결과를 50 KB으로 잘라 re-injection. 초과 시 `[truncated: original N chars]` suffix 포함.
- `synopsis-only` 경로의 single-turn 입력은 user prompt + wiki root 제외 ~15k tokens 이하로 유지. 본 문서 §3의 "long-context <200k / hybrid" 정책과 일치.
- 루프 하드 가드: `LoopConfig.max_total_input_tokens = 200_000` (default). `max_turns 8`, `max_tool_calls 12`, per-tool 30s (`fetch_url` 60s)로 실패 시 bounded termination reason 반환.
