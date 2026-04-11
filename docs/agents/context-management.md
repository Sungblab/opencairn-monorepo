# Context Management Strategy

에이전트별 컨텍스트 전략 — Gemini 캐싱, 임베딩, 컨텍스트 구성.

---

## 1. Gemini Context Caching

### 사용 이유

Research Agent가 대규모 프로젝트의 위키 문서를 반복 참조할 때, 매번 위키 전체를 컨텍스트에 넣으면 비용 낭비가 크다.

```
기본 토큰: 100만 토큰당 $2.00
캐시 토큰: 100만 토큰당 $0.20  → 90% 절감
```

### 캐시 정책

```python
# 프로젝트별 위키 캐시 생성
cache = client.caches.create(
    model="gemini-3.1-flash-lite-preview",
    system_instruction="You are a knowledge base assistant...",
    contents=[
        # 프로젝트의 모든 위키 페이지 (최대 1M 토큰)
        {"role": "user", "parts": [wiki_page.content for wiki_page in pages]}
    ],
    config=CreateCachedContentConfig(
        display_name=f"project:{project_id}",
        ttl="3600s",  # 1시간
    ),
)
```

### 캐시 갱신 정책

| 이벤트                        | 정책                               |
| ------------------------------ | ---------------------------------- |
| 위키 페이지 생성/수정/삭제 | 해당 프로젝트 캐시 삭제       |
| Compiler Agent 완료           | 캐시 재생성 (다음 Research에서) |
| TTL 만료 (1시간)            | 자동 삭제                         |

### 캐시 적용 에이전트

| 에이전트    | 캐시 사용 | 비고                                 |
| ------------- | ----------- | ------------------------------------- |
| Research      | O           | 대규모 위키를 반복 참조             |
| Socratic      | O           | 대규모 위키에서 문제 생성          |
| Compiler      | X           | 단일 완료 처리, 캐시 비효율 없음     |
| Librarian     | X           | 전체 위키 탐색, 캐시 비효율 있음 |
| Deep Research | X           | Gemini API가 직접 검색              |

---

## 2. Embedding Strategy

### 모델: gemini-embedding-2-preview

```python
result = client.models.embed_content(
    model="gemini-embedding-2-preview",
    contents=text,
    config=EmbedContentConfig(
        output_dimensionality=3072,  # 최대 차원수
        task_type="RETRIEVAL_DOCUMENT",  # 문서 저장 시
        # task_type="RETRIEVAL_QUERY",  # 검색 쿼리 시
    ),
)
```

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
