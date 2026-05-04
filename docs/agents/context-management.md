# Context Management Strategy

에이전트별 컨텍스트 전략 — Gemini 캐싱, 임베딩, 컨텍스트 구성.

---

## 1. Gemini Context Caching

> **Implementation status:** `packages/llm` exposes Gemini context-cache
> plumbing, but OpenCairn does not currently ship a product flow that creates,
> invalidates, and reuses project-level caches for Research/Socratic queries.
> The policy below is the intended design boundary, not current default
> runtime behavior.

### 현재 상태

Gemini Context Caching은 두 층으로 나눠서 봐야 한다.

- **Implicit caching**: Gemini 2.5+ 및 Gemini 3 계열에서 provider가 자동 적용한다.
  OpenCairn은 기본 모델을 `gemini-3-flash-preview`로 두기 때문에 별도 API 없이도
  provider-side implicit cache hit 대상이다. 단, hit는 Google 측 prefix cache 정책에
  달려 있고 OpenCairn이 cache id를 소유하거나 TTL을 관리하지 않는다.
- **Explicit caching**: **제품 기능으로 shipped 상태가 아니다.** Python provider와
  worker runtime에는 배관이 있고 API TypeScript provider도 `cachedContent` pass-through를
  지원하지만, production call site가 캐시를 생성하거나 cache id lifecycle을 관리하지 않는다.

현재 확인된 배관:

- `packages/llm/src/llm/gemini.py`는 `cache_context()`를 구현하고
  `generate_with_tools()`에서 `cached_context_id`를 Gemini SDK의
  `cached_content`로 넘길 수 있다.
- `apps/worker/src/runtime/tool_loop.py`는 `LoopConfig.cached_context_id`를
  provider 호출까지 전달할 수 있다.
- `apps/api/src/lib/llm/gemini.ts`는 Gemini `cachedContent`를
  `streamGenerate()`/`groundSearch()` config로 전달할 수 있다.
- 이 배관만으로 Research, Socratic, chat, Deep Research가 context cache를
  사용한다고 문서화하거나 feature registry에서 `complete`로 표시하면 안 된다.

### 적용 조건

Context Caching을 실제 기능으로 켜기 전에는 아래 항목이 함께 설계되어야 한다.

| 항목 | 필요 조건 |
| --- | --- |
| 캐시 생성 기준 | Gemini 3 Flash Preview는 1024 tokens, Gemini 3 Pro Preview는 4096 tokens 이상일 때 explicit/implicit cache 효율 검토 |
| 소유권 | user, workspace, project, provider, model별 캐시 격리 |
| 수명 | TTL, 수동 삭제, provider-side cache id 보관 위치 |
| 무효화 | 노트, 위키, 프로젝트 knowledge source 변경 시 cache invalidation |
| 권한 | 캐시 생성 시점과 사용 시점 모두 workspace permission 재검증 |
| 비용/관측 | `cached_content_token_count`와 일반 input token을 분리 기록 |
| 제품 표면 | API route 또는 internal worker-only 정책 중 하나를 명시 |

### 적용 후보

| 에이전트/표면 | 현재 캐시 사용 | 비고 |
| --- | --- | --- |
| Research/chat RAG | implicit만 가능 | API provider는 `cachedContent` 전달을 지원하지만 chat call site는 explicit cache id를 생성/보관하지 않는다. |
| Socratic | 아니오 | worker runtime 배관만 있고 생성/전달 call site가 없다. |
| Compiler | 아니오 | 단발성 처리라 캐시 효율은 별도 근거가 필요하다. |
| Librarian | 아니오 | batch embedding/internal search 최적화와 CAG는 별개다. |
| Deep Research | 아니오 | Gemini Interactions API 기반이며 cache lifecycle을 별도로 관리하지 않는다. |

---

## 2. Embedding Strategy

### 모델: gemini-embedding-001 (MTEB multilingual #1, 2026-04-21 ADR-007)

```python
# 실제 호출은 packages/llm `get_provider().embed()`를 거침 — 아래는 동등한 SDK 표현.
result = client.models.embed_content(
    model="gemini-embedding-001",
    contents=text,
    config=EmbedContentConfig(
        output_dimensionality=768,  # Matryoshka truncate. VECTOR_DIM env와 일치시킴.
        task_type="RETRIEVAL_DOCUMENT",  # 문서 저장 시
        # task_type="RETRIEVAL_QUERY",  # 검색 쿼리 시
    ),
)
```

멀티모달(이미지/음성/영상) 임베딩이 필요하면 별도 모델로 env를
교체해야 한다. 현재 shipped default는 `gemini-embedding-001` 텍스트
임베딩이며, 멀티모달 Gemini Embedding 2를 기본 제품 경로로 제공하지
않는다. 저장 비용·품질 손실 tradeoff는 ADR-007 참조.

### 임베딩 시점

| 대상         | 임베딩 생성          | task_type          | 저장 컬럼           |
| ----------- | -------------------- | ------------------ | ------------------ |
| 노트 전체 | 노트 생성/수정 시 | RETRIEVAL_DOCUMENT | notes.embedding    |
| 개념      | 개념 생성 시      | RETRIEVAL_DOCUMENT | concepts.embedding |
| 검색 쿼리   | Q&A 시               | RETRIEVAL_QUERY    | 임시변수 (저장 안 함)  |

### 분할 전략

- 노트가 짧으면 (< 8192 토큰) 전체를 하나의 임베딩으로
- 노트가 길면 헤드라인 기준으로 분할 (heading 기준), 각 분할로 임베딩
- 개념은 항상 단일 임베딩 (description이 짧으므로)

---

## 3. Hybrid Search (Graph RAG)

### RAG Mode (2026-04-20 agent-chat-scope 통합)

- **Strict mode (기본)**: 사용자가 chat에서 붙인 scope 칩(Page/Project/Workspace + 추가 corpus)에만 검색 제한. 칩 외부 데이터는 참조 안 함.
- **Expand mode**: 칩 내부에서 top-k가 희박(예: 3개 미만)일 때 workspace 범위로 fallback. UI에 "Expand" 배지 표시.
- **구현**: `search.hybrid(query, scope_chips, mode='strict'|'expand')` — Plan 11A에서 도구 시그니처 확정.
- **권한**: 모든 모드에서 `canRead(user, resource)` 통과한 문서만 검색 대상.

### 3단계 검색 파이프라인

```
유저 질문: "Transformer의 attention mechanism이 어떻게 작동하나요?"

[1] Vector Search (pgvector)
    → 질문 임베딩 생성 (RETRIEVAL_QUERY)
    → SELECT * FROM notes WHERE embedding <=> query_embedding ORDER BY ... LIMIT 20
    → 유사도 기준으로 관련 노트 20개
[2] BM25 Search (tsvector)
    → SELECT * FROM notes WHERE content_tsv @@ plainto_tsquery('transformer attention mechanism')
    → 키워드 정확 일치 노트

[3] Graph Traversal
    → "Transformer" 개념 탐색
    → 2-hop 순회: Transformer → attention → multi-head, self-attention, cross-attention
    → 연관 개념의 위키 페이지 포함

[4] RRF Fusion (Reciprocal Rank Fusion)
    → 세 검색 결과의 순위를 가중 합산
    → score = Σ 1/(k + rank_i) for each retriever
    → k = 60 (standard)
    → 최종 상위 10개 노트를 LLM 컨텍스트에 주입
```

### RRF 구현

```python
def reciprocal_rank_fusion(
    results: list[list[str]],  # 각 검색기의 결과 (note_id 목록)
    k: int = 60,
) -> list[tuple[str, float]]:
    scores: dict[str, float] = {}
    for result_list in results:
        for rank, note_id in enumerate(result_list):
            scores[note_id] = scores.get(note_id, 0) + 1 / (k + rank + 1)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
```

---

## 4. Prompt Structure

### System Prompt 구성

모든 에이전트가 공유하는 기본 구성:

```
[System Identity]
You are {agent_name}, an AI agent in the OpenCairn knowledge base system.

[Role Description]
{agent_specific_role}

[Rules]
- Always cite sources with [[wiki_page_title]] syntax
- Never fabricate information not present in the provided context
- If unsure, say "I don't have enough information"
- {agent_specific_rules}

[Output Format]
{pydantic_schema_description}

[Context]
## User's Wiki Pages
{cached_or_injected_wiki_content}

## Knowledge Graph (relevant concepts)
{concept_names_and_relations}

[Task]
{user_query_or_agent_task}
```

### 에이전트별 컨텍스트 차이

| 에이전트 | Context에 포함되는 것        | 추가 지시                                         |
| ---------- | ----------------------------- | -------------------------------------------------- |
| Compiler   | 원본 문서 텍스트 + 기존 위키 | "기존 위키와 겹치면 병합하여 중복 제거하라" |
| Research   | 캐시된 위키 + 검색 결과    | "출처가 없는 내용은 말하지 마라"                          |
| Librarian  | 전체 위키 메타데이터          | "삭제된 항목은 자동 실행 하라"                 |
| Socratic   | 지정 위키 페이지           | "위키에 없는 내용으로 문제 출제 하라"      |
| Synthesis  | 프로젝트의 개념 목록     | "구성에 관련된 노드 수"                        |

---

## 5. Token Budget Management

### 프로젝트 크기별 전략

| 위키 크기     | 전략                                     | 예상 비용/쿼리 |
| -------------- | ----------------------------------------- | ------------------ |
| < 50 페이지   | 전체 위키를 컨텍스트에 주입          | $0.002             |
| 50-500 페이지 | Context Caching + 검색 결과만 주입     | $0.001 (캐시)    |
| 500+ 페이지   | 검색 결과 상위 10개만 주입 + 캐시 | $0.001 (캐시)    |

### Thinking Mode 사용 기준

비용을 의식하면서 선택적 사용:

| 상황                             | Thinking Mode    | 비고                       |
| --------------------------------- | ---------------- | --------------------------- |
| 단순 Q&A                          | OFF              | 검색 결과 충분하면 불필요 |
| 복잡한 질문 (쿼리 재해석 필요) | ON (budget=1024) | 멀티 단계 필요           |
| 위키 분석 (복잡한 판단)      | ON (budget=2048) | 병합/충돌 관계 파악   |
| 플래시카드 문제 생성                 | OFF              | 구성에 충실하면 불필요     |
| Synthesis (요약 생성)           | ON (budget=4096) | 전체의 멀티 단계 필요        |
