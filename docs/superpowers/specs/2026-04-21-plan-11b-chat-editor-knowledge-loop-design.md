# Plan 11B — Chat ↔ Editor Knowledge Loop Design Spec

**Status:** Draft (2026-04-21)
**Owner:** Sungbin
**Related:**
- [Plan 11A Chat Scope & Memory](2026-04-20-agent-chat-scope-design.md) (전제, 구현 의존)
- [Tab System](2026-04-20-tab-system-design.md) (Diff View, SSE ↔ 탭 이벤트 재사용)
- [Agent Runtime Standard](2026-04-20-agent-runtime-standard-design.md) (`DocEditorAgent` = `runtime.Agent`)
- [ADR-007 Embedding Switch](../../architecture/adr/007-embedding-model-switch.md) (`gemini-embedding-001`, 768d)
- Plan 4 Phase A/B (Compiler, Librarian, ResearchAgent)
- [api-contract.md](../../architecture/api-contract.md)
- [collaboration-model.md](../../architecture/collaboration-model.md)

## Dependencies

- **Plan 11A 구현 완료가 하드 전제** — chip UI, `conversations`/`conversation_messages`/`pinned_answers`, chat SSE 프레임워크, scope 체계를 재사용한다. Plan 11A가 merge 되기 전에는 Plan 11B 구현을 시작하지 않는다.
- **Plan 4 Compiler/Librarian** — save suggestion 수락 경로에서 기존 workflow 재사용 (새 컴파일러 없음).
- **Plan 12 Agent Runtime** — `DocEditorAgent`는 `apps/worker/src/runtime/`의 `Agent` 서브클래스.
- **Tab System Diff View (Task 23)** — slash commands 결과 반환 경로.
- **ADR-007 embedding** — 768d `gemini-embedding-001`을 중복 프리체크와 related pages 검색에 사용.

---

## 1. Problem

현재 OpenCairn은 에디터와 채팅이 병렬로 존재하지만, 채팅에서 생성된 지식이 위키로 흘러 들어가는 경로가 **명시적 핀(pin-to-page)**에만 의존한다. 사용자는 "이 대화 중요한데 어떻게 저장하지?"를 수동으로 판단하고 위치를 골라야 한다. 반대로 에디터에서 편집 중인 문서가 **이미 나눈 채팅·기존 노트**와 어떻게 연결되는지 추적할 수 있는 메커니즘도 없다.

이 spec은 채팅과 에디터 사이에 **의도 확인 루프**를 통해 지식이 자동으로 흐르는 네 가지 기능을 정의한다:

1. **Save Suggestion** — assistant 응답이 "저장 가치 있음"을 판단하면 메시지 하단에 칩을 띄우고, 서버가 임베딩 유사도로 기존 concept 중복을 프리체크해 "새 노트" 또는 "기존에 병합" 경로로 분기한다.
2. **페이지별 대화 히스토리 (Provenance)** — 에디터 문서 상단에 그 페이지가 실제로 유래한 / 참조된 대화를 노출하고, 새 페이지 생성 시 관련 대화로 초안을 제안한다.
3. **Slash Commands** — 에디터에서 `/improve`, `/translate`, `/summarize`, `/expand`, `/cite`, `/factcheck` 여섯 커맨드를 `DocEditorAgent`를 통해 실행한다. 결과는 Tab System Diff View(대부분) 또는 comment lane(`/factcheck`)으로 반환한다.
4. **Related Pages 자동 제안** — 채팅 메시지 제출 시 서버가 workspace 내 사용자 접근 가능 노트를 임베딩 검색해, 첫 토큰 스트리밍 전에 "관련 노트 N건" suggestion bar를 띄운다. 사용자가 클릭해야 chip으로 부착된다(비용 투명성).

## 2. Goals & Non-Goals

**Goals**
- 채팅에서 생성된 지식이 손실 없이, 그러나 **자동 저장 피로 없이** 위키로 흐르는 경로
- 한 페이지의 provenance(유래 대화)를 찾기 쉽게 노출
- 에디터에서 AI 편집 커맨드를 Cursor/Notion급 일관된 Diff UX로 제공
- 채팅 중 **기존 지식 재사용**을 방해 없이 제안

**Non-goals (v1)**
- Research agent 백그라운드 → Draft 문서 자동 생성 (Plan 11C 후보)
- CriticAgent가 comment lane에 자발적으로 참여 (Plan 11C 후보)
- 채팅 답변 → 에디터로 drag-drop (Plate drag API 별도 연구)
- LLM이 사용자 승인 없이 에디터를 직접 편집하는 "Agent 모드" — Tab System SSE `diff`/`tab_open` 이벤트는 이미 정의되어 있으나, Plan 11B는 **slash commands 경로만** 그것을 소비한다. 자발적 편집은 별도 스펙.
- Semantic 유사도 기반 페이지 히스토리 (§3.1, 역할 분리)
- 커스텀 커맨드 (`/my-style`) — workspace memory L4 연동이 필요, Plan 11C 후보

## 3. Scope Boundary & 역할 분리

| 기능 | 위치 | 기준 | 목적 |
|------|------|------|------|
| **§5 페이지 대화 히스토리** | 에디터 상단 | Provenance (origin/contributor/cited) — **실제 링크** | "이 노트 어디서 왔지?" 추적 |
| **§7 Related pages 제안** | 채팅 입력 위 suggestion bar | Semantic (title+summary embedding) | "전에 비슷한 거 쓴 적 있지?" 발견 |

에디터는 **확정된 과거**, 채팅은 **탐색 중인 현재**. 경로·정의·UX 모두 분리한다. semantic 유사도를 에디터 히스토리에 섞지 않는 이유는 provenance의 신뢰성을 지키기 위함.

---

## 4. Save Suggestion 플로우

### 4.1 응답 스키마 확장

Plan 11A chat SSE 스트림에 이벤트 하나 추가:

```
SSE events: delta, citation, cost, done, save_suggestion_ready
```

LLM은 매 assistant 응답의 structured output 일부로 `save_suggestion` 필드를 채우거나 null 반환한다:

```ts
{
  suggestion: {
    title: string,          // ≤80자, 위키 스타일 제목
    summary: string,        // 200-400자, hook/intro용
    reason: string,         // LLM 판단 근거, UI hover
    source_turns: string[], // 해당 Q+A 메시지 ID (보통 2개)
  } | null
}
```

시스템 프롬프트 규칙(요지): "**새로운 사실, 사용자 결론, 또는 재사용 가치 있는 정리**가 드러났을 때만 채워라. 인사, 확인, 단순 질답, 메타 대화엔 금지. 애매하면 null."

### 4.2 서버 중복 프리체크

`suggestion`이 null 아닐 때만 실행:

```
1. suggestion.title + suggestion.summary → embedding (768d, gemini-embedding-001)
2. 검색 스코프: 대화의 conversation.scope 기준 —
   - scope='project' → concepts WHERE project_id = conversation.project_id
   - scope='workspace' → concepts WHERE project_id IN
       (SELECT id FROM projects WHERE workspace_id = conversation.workspace_id
        AND canRead(viewer, project_id))
   - scope='page' → note의 project로 확장 (단일 page concepts는 없음)
3. pgvector cosine similarity (concepts.embedding vector(768), 0007 migration 이후)
4. Threshold:
   ≥ 0.85 → mode='merge', candidate_concept_id=X
   0.70–0.85 → mode='ambiguous', candidates=[top3]
   < 0.70 → mode='new'
5. SSE emit:
   { type: 'save_suggestion_ready', suggestion, mode, candidates }
```

`done` 직전에 emit한다. workspace 격리는 검색 쿼리에서 강제 (collaboration-model §3.5).

### 4.3 UI — 메시지 하단 인라인 칩

assistant 메시지 말풍선 직후, 얇은 칩:

```
┌ assistant message ────────────────────────────┐
│  ...답변 본문...                               │
└────────────────────────────────────────────────┘
  💡 "Transformer의 3가지 핵심" 노트 제안  [?] [저장] [x]
                                       hover→reason
```

- `mode='new'` → `[저장]` 버튼
- `mode='merge'` → `[“기존 노트 X”에 병합]` + small `[새로 만들기]` 분기
- `mode='ambiguous'` → 드롭다운 top3 + "새로 만들기"
- `[x]` → dismiss (로깅)

### 4.4 쿨다운 & 세션 예산

- 한 대화에서 칩 `[x]` 이후 **5턴은 클라이언트가 이벤트 무시**. 서버는 계속 보냄(재개 가능). 수락 한 번이면 reset.
- 한 대화당 최대 **3개** 칩만 표시. 초과 이벤트는 UI 드롭.
- `/settings/chat`에 영구 토글: `☑ 대화 중 노트 저장 제안 (default ON)`.

### 4.5 수락 시 백엔드 플로우

```
User clicks [저장] / [병합]
  ↓
POST /api/chat/messages/:id/save-suggestion
  body: { mode, target_concept_id? }
  ↓
API → Temporal signal to Compiler workflow
  ↓ Compiler input:
    raw_source = source_turns 원문 (Q+A)
    hint = { title, summary }
    mode + target_concept_id
  ↓
  new   → Compiler.create_concept()
  merge → Compiler.merge_into(target_concept_id) (Librarian 경로 재사용)
  ↓
  - conversation_messages.created_concept_id 또는 merged_concept_id 세팅
  - concept에 연결된 note의 footer 블록에 "유래: [conversation.title]" 링크 추가
    (concept_notes 조인으로 연결, 기존 Plan 4 Compiler 경로)
  - concept_source_links(relation='origin'|'contributor') 삽입
  ↓
SSE: { type: 'save_suggestion_done', concept_id, mode_applied }
  → 칩이 `[📄 '제목' 열기]`로 변환 (클릭 시 에디터 새 탭)
```

### 4.6 오류 경로

- Compiler 실패 → 칩 `[⚠ 실패, 재시도]`, 3회 재시도 후 영구 실패. `activity_events: save_suggestion_failed`.
- Merge target concept 삭제됨 → 409, `[새로 만들기]` fallback.
- 프리체크 임베딩 실패 → `mode='new'` fallback, 사용자에겐 투명.

### 4.7 중복 병합 로직 재사용

Plan 4 Phase B의 Librarian은 이미 concept 중복 병합 능력을 가진다. `mode='merge'` 수락은:

1. 새 source 대화 내용을 타겟 concept에 연결된 note(들)에 `concept_notes`로 append, `concept_source_links(relation='contributor')` 삽입
2. Librarian이 다음 schedule run에서 concept 내용 통합 (비동기)
3. 즉시 반영이 필요하면 `?expedite=true` 플래그로 Compiler 동기 경로 선택 (토큰 추가)

---

## 5. 페이지별 대화 히스토리 (Provenance)

### 5.1 "관련 대화" 정의 (provenance only)

페이지 `P`에 대해 다음 셋 중 하나라도 해당하면 관련 대화:

1. **Origin** — `P`가 그 대화의 save suggestion 수락으로 생성됨 (`concepts.created_from_conversation_id`)
2. **Contributor** — `P`가 그 대화의 merge 수락으로 업데이트됨 (`concept_source_links.relation='contributor'`)
3. **Cited** — 그 대화의 assistant 메시지 `citations[]`가 `P`를 가리킴

정렬: origin > contributor > cited, 같은 레벨은 `updated_at DESC`.

**의도적 제외:** semantic 유사도, scope_id 매칭. 그건 §7 related pages가 담당.

### 5.2 데이터 모델

§9 Data Model 섹션 참조 — `concept_source_links` 테이블, `concepts.created_from_conversation_id` 컬럼, `conversation_messages.citations` GIN 인덱스.

### 5.3 API

```
GET /api/notes/:noteId/conversations
  → 200 {
    conversations: [{
      id, title, relation: 'origin'|'contributor'|'cited',
      updated_at, message_count, last_message_preview (60자)
    }],
    total
  }
```

권한: `canRead(noteId)` 통과 + `conversation.owner_user_id == viewer` 조건(대화는 private, Plan 11A §7.2). 타인이 같은 페이지에 기여한 대화는 **절대 안 보임** — 프라이버시 핵심.

### 5.4 UI — 에디터 상단 칩

```
┌─ note header ──────────────────────────────────┐
│  Transformer의 3가지 핵심                       │
│  updated 2h ago · [💬 3] · [🔗 12 backlinks]   │
└────────────────────────────────────────────────┘
```

`[💬 3]` 클릭 시 popover에 relation별 그룹핑:

```
Origin
  💬 "Attention 질문 정리" · 2d ago · "...3가지 핵심이..."  [채팅 열기]
Contributor (1)
  💬 "Multi-head 부연" · 5h ago  [채팅 열기]
Cited (1)
  💬 "논문 리뷰 대화" · 1w ago  [채팅 열기]
```

- 갯수 0이면 칩 자체 숨김
- `[채팅 열기]` → Tab System에서 chat 탭으로 `conversationId` 로딩

### 5.5 빈 페이지 Pull

새 페이지 제목 입력 후 커서가 본문으로 이동하면:

```
1. Debounce 600ms 후 POST /api/notes/suggest-from-conversations
2. 서버:
   a. title embedding
   b. viewer의 최근 30일 conversation_messages 유사도 top-5 (본인 대화만)
   c. 유사도 ≥ 0.75 필터
3. 결과 있으면 빈 본문 대신 카드:
   ┌─────────────────────────────────────────┐
   │  이 제목과 관련된 대화 2건              │
   │  💬 "Transformer 질문" (3일 전)         │
   │  💬 "Self-attention 정리" (1주 전)      │
   │  [대화 바탕으로 초안] [빈 페이지로 시작]│
   └─────────────────────────────────────────┘
```

`[대화 바탕으로 초안]` → 선택 대화를 `raw_source`로 Compiler에 전달, 이 `note_id`를 타겟으로 초안 생성(새 concept 만들지 않음, 이 note에 채워 넣음). 완료 시 Plate 초안 렌더.

### 5.6 성능

- `/api/notes/:noteId/conversations`는 페이지 로드마다 호출. 쿼리 최적화 필수: `concept_source_links(concept_id)` + `citations` GIN + `LIMIT 20`.
- 클라이언트 React Query `staleTime: 60s`.
- 빈 페이지 pull 임베딩 호출은 §7 related_pages 핸들러와 백엔드 함수 공유.

---

## 6. Slash Commands

### 6.1 커맨드 세트 (v1)

| 커맨드 | 동작 | 결과 반환 | 내부 도구 |
|--------|------|-----------|----------|
| `/improve` | 문체·명료성 교정 | Diff View | LLM only |
| `/translate` | 번역 (언어 서브메뉴) | Diff View | LLM only |
| `/summarize` | 요약 (교체 / 아래 삽입 분기) | Diff View | LLM only |
| `/expand` | 짧은 단락 확장 | Diff View | LLM only |
| `/cite` | RAG citation 자동 부착 | Diff View (in-line `[^n]` + 참고문헌) | `ResearchAgent.hybrid_search` |
| `/factcheck` | 사실 확인, 근거/반박 | **comment lane 주석** + 🟢/🟡/🔴 배지 | `ResearchAgent.hybrid_search` |

**`/factcheck`만 Diff 아닌 이유:** 팩트체크는 수정 여부 판단을 사용자가 해야 한다. 자동 수정 시 잘못된 근거로 글이 망가질 수 있음. 협업 comment lane 재사용.

### 6.2 Plate 통합

기존 slash menu에 "AI" 섹션:

```
/
├─ Basic (기존)   Heading / List / Quote / ...
├─ Media (기존)   Image / Table / ...
└─ AI  (신규)
    /improve
    /translate  ▸  English / 한국어 / 日本語 / ...
    /summarize
    /expand
    /cite
    /factcheck
```

**선택 영역 규칙:**
- `/improve`, `/translate`, `/summarize`, `/expand` — 선택 **필수**, 없으면 현재 블록 전체
- `/cite` — 문장 단위 선택 필수
- `/factcheck` — 선택 없으면 현재 블록 전체

### 6.3 DocEditorAgent 아키텍처

단일 에이전트 + 커맨드별 system prompt 모듈:

```
apps/worker/src/agents/doc_editor/
├─ agent.py                  # runtime.Agent 서브클래스
├─ commands/
│   ├─ improve.py            # CommandSpec
│   ├─ translate.py
│   ├─ summarize.py
│   ├─ expand.py
│   ├─ cite.py               # ResearchAgent.hybrid_search tool
│   └─ factcheck.py          # ResearchAgent.hybrid_search tool
└─ tools/
    └─ cite_research.py
```

```python
@dataclass
class CommandSpec:
    name: str
    system_prompt: str
    tools: list[Tool]
    output_mode: Literal['diff', 'comment', 'insert']
    response_schema: type  # pydantic
```

`DocEditorAgent.run(command_name, selection, document_context)`은:
1. `CommandSpec` 로드
2. `runtime.Agent` 실행 (user turn = selection + 주변 ±200자)
3. structured output 파싱
4. SSE emit: `{ type: 'doc_editor_result', output_mode, payload }`

### 6.4 API

```
POST /api/notes/:noteId/doc-editor/commands/:commandName
  body: {
    selection: { blockId, start, end, text },
    language?: string,   // /translate 전용
    documentContextSnippet: string,
  }
  → SSE stream:
    { type: 'delta', text }
    { type: 'doc_editor_result', output_mode, payload }
    { type: 'cost', tokens_in, tokens_out, cost_krw }
    { type: 'done' }
```

권한: `canWrite(noteId)`. `/cite`, `/factcheck` RAG 검색은 호출자의 workspace scope 내.

### 6.5 Diff 경로 payload

```ts
{
  hunks: [{
    blockId, originalRange: {start, end},
    originalText, replacementText,
  }],
  summary: string,  // "3 sentences rewritten"
}
```

Tab System Diff View가 수신 → hunk별 accept/reject → Plate transform으로 range 교체.

### 6.6 Comment lane 경로 (`/factcheck`)

```ts
{
  claims: [{
    blockId, range: {start, end},
    verdict: 'supported' | 'unclear' | 'contradicted',
    evidence: [{ source_id, snippet, url_or_ref, confidence }],
    note: string,  // ≤150자
  }]
}
```

Plate 인라인 마커 + 우측 comment lane에 코멘트 생성 (`comments` 테이블, Plan 4 기존). 작성자: `user_id='agent:doc_editor'`, 실제 호출자는 `triggered_by` 메타.

### 6.7 Insert 경로 (`/summarize` 분기)

Diff View 상단 토글: `( ● 선택 교체   ○ 아래에 삽입 )`. Insert 모드 시 hunks 대신 `{ afterBlockId, newBlock: PlateBlock }`.

### 6.8 비용 / 레이턴시

- `/improve` `/translate` `/summarize` `/expand`: <1k in/out, 1~3s
- `/cite` `/factcheck`: RAG 추가, 2~5k in, 1~2k out, 3~8s (스트리밍 필수)
- 모든 call은 별도 테이블 `doc_editor_calls`에 기록, `billing_usage` 집계는 `source='doc_editor'`

### 6.9 오류 경로

- LLM 실패 → Diff View `[⚠ 실패, 재시도]`
- 선택 영역 race (사용자가 그 사이 편집) → apply 시 409, 모달 "문서 변경됨, 재실행?"
- `/cite` 근거 못 찾음 → `evidence: []`, 토스트 "적절한 인용 못 찾음"
- `/factcheck` 전체 `unclear` → 그대로 표시 (정직함 우선)

### 6.10 Out of v1

- `/outline` — Plan 10 Document Skills와 중복 위험
- `/image` — 비용 구조 별도 plan
- 커스텀 커맨드 (`/my-style`) — Plan 11C 후보 (L4 workspace memory)
- Multi-block 트랜잭션 (`/refactor whole section`) — 위험도 높음, 별도 스펙

---

## 7. Related Pages 자동 제안

### 7.1 트리거

```
User clicks Send
  ↓
API enters handler
  ├─ [parallel A] LLM generation (기존 경로)
  └─ [parallel B] Related pages search
      ↓
  → SSE emit: { type: 'related_pages', pages: [...] }  (먼저)
  → 이어서 LLM delta stream
```

병렬 실행. 임베딩 100–300ms, LLM 첫 토큰 400–800ms라 related_pages가 거의 항상 먼저 도착.

### 7.2 검색 로직

```python
async def find_related_pages(workspace_id, user_id, query_text):
    q_emb = await embed(query_text, model='gemini-embedding-001', dim=768)
    # 권한 체크는 readable_note_ids(user_id, workspace_id) 헬퍼로 선계산
    # (page_permissions → project_permissions → workspace_members 순 inherit,
    #  apps/api 의 기존 canRead 경로 재사용).
    readable_ids = await readable_note_ids(user_id, workspace_id)
    if not readable_ids:
        return []
    results = await db.query("""
        SELECT n.id, n.title, n.updated_at,
               1 - (n.title_summary_embedding <=> $1) AS score
        FROM notes n
        WHERE n.workspace_id = $2
          AND n.id = ANY($3::uuid[])
          AND n.title_summary_embedding IS NOT NULL
          AND n.deleted_at IS NULL
        ORDER BY n.title_summary_embedding <=> $1
        LIMIT 10
    """, q_emb, workspace_id, readable_ids)
    return [r for r in results if r['score'] >= 0.70][:3]
```

**임베딩 대상**: `notes.title_summary_embedding` (title + 본문 앞 500자). 전체 본문 아님 — 비용·정확도 balance.

### 7.3 UI — Suggestion Bar

채팅 입력창 **위쪽**, assistant delta 도착 전 페이드 인:

```
┌ chat panel ─────────────────────────────────────┐
│  [user] Transformer의 multi-head 왜 쓰는지...    │
│  ┌ related bar ─────────────────────────────┐   │
│  │ 📎 관련 노트 3건:                          │   │
│  │ [📄 Transformer 구조] [📄 Attention 기초] │   │
│  │ [📄 Self-attention 정리]         [모두×]   │   │
│  └──────────────────────────────────────────┘   │
│  [assistant] ...스트리밍...                      │
└─────────────────────────────────────────────────┘
```

- 노트 칩 클릭 → Plan 11A chip row에 `📄` 칩 추가 (`source='suggested'`). **다음 턴부터** 컨텍스트 포함 (현재 응답은 영향 없음 — 이미 생성 중).
- `[모두×]` → bar 숨김 + 이 대화 세션 flag로 이후 이벤트 무시.
- 칩 hover → 제목·updated·유사도 (`94% match`).
- 무시하고 다음 메시지 보내면 자동 교체.

### 7.4 다음 턴 컨텍스트 주입

Plan 11A `conversations.attached_chips`에 append:

```json
{
  "type": "page",
  "id": "<noteId>",
  "label": "Transformer 구조",
  "manual": false,
  "source": "suggested",
  "suggested_at_turn": 5
}
```

Plan 11A RAG 파이프라인이 다음 메시지부터 이 page를 scope에 포함. 사용자는 `X`로 제거 가능.

### 7.5 성능 / 비용

- 메시지당 임베딩 1회 (768d), 몇 원 미만
- pgvector HNSW 검색 수 ms
- **PAYG 집계에 포함하지 않음** — "쓰지도 않은 기능에 과금" 인식 방지. workspace admin 대시보드에만 집계 (v2).
- `/settings/chat` 토글: `☑ 관련 노트 자동 제안 (default ON)`. OFF 시 서버에서 skip.

### 7.6 권한

- 스코프: `conversation.workspace_id` 고정 — 다른 workspace 섞임 금지
- `canRead(noteId, user_id)` 통과 페이지만 surface
- 칩으로 추가 후 다음 턴 RAG 시 재확인 (TOCTOU 방지)

### 7.7 오류 경로

- 임베딩 API 실패 → `related_pages: []` (빈 이벤트) 보내고 진행
- pgvector 타임아웃 (>500ms) → abort, 빈 결과
- 결과 0건 → 이벤트 자체 미전송 (UI bar 안 뜸)

---

## 8. 역할 분리 재확인

§3 표 참고. 에디터 상단 `[💬 N]`은 **provenance**, 채팅 suggestion bar는 **semantic**. 각각의 데이터 출처와 UX 위치가 완전히 다르며 섞지 않는다.

---

## 9. Data Model

Plan 11A 위에 얹히는 **additive** 변경만. 파괴적 수정 없음.

### 9.1 신규 테이블

```sql
CREATE TABLE concept_source_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id        uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id        uuid REFERENCES conversation_messages(id) ON DELETE SET NULL,
  relation          text NOT NULL CHECK (relation IN ('origin', 'contributor')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON concept_source_links(concept_id, relation);
CREATE INDEX ON concept_source_links(conversation_id);

CREATE TABLE doc_editor_calls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  command       text NOT NULL,
  tokens_in     integer NOT NULL DEFAULT 0,
  tokens_out    integer NOT NULL DEFAULT 0,
  cost_krw      numeric(12,4) NOT NULL DEFAULT 0,
  status        text NOT NULL CHECK (status IN ('ok', 'failed')),
  error_code    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON doc_editor_calls(user_id, created_at DESC);
CREATE INDEX ON doc_editor_calls(note_id, created_at DESC);
```

### 9.2 기존 테이블 확장

```sql
-- concepts: origin 링크 denormalized (§5.4 popover 쿼리 최적화)
ALTER TABLE concepts
  ADD COLUMN created_from_conversation_id uuid
    REFERENCES conversations(id) ON DELETE SET NULL;
CREATE INDEX ON concepts(created_from_conversation_id)
  WHERE created_from_conversation_id IS NOT NULL;

-- notes: title+summary 임베딩 (§7.2)
ALTER TABLE notes ADD COLUMN title_summary_embedding vector(768);
CREATE INDEX notes_title_summary_embedding_hnsw
  ON notes USING hnsw (title_summary_embedding vector_cosine_ops);

-- conversation_messages.citations는 이미 jsonb. GIN 추가:
CREATE INDEX conversation_messages_citations_gin
  ON conversation_messages USING gin (citations jsonb_path_ops);

-- save suggestion 결과 링크
ALTER TABLE conversation_messages
  ADD COLUMN created_concept_id uuid REFERENCES concepts(id) ON DELETE SET NULL,
  ADD COLUMN merged_concept_id  uuid REFERENCES concepts(id) ON DELETE SET NULL;
-- 같은 row에 둘 다 set 되지 않음. 한 쪽만.
```

Plan 11A `attached_chips` jsonb에는 스키마 변경 없음. 애플리케이션 레벨에서 `source?: 'manual'|'auto'|'suggested'` 필드를 추가.

### 9.3 백필 전략

- `concept_source_links` — 신규, 백필 없음. 과거 concept에 provenance는 없음 (수용).
- `notes.title_summary_embedding` — 마이그레이션 직후 백그라운드 Temporal activity로 배치 임베딩. Batch API(ADR-007)로 50% 할인. **런칭 전 완료 필수** — 빈 상태면 related pages 결과가 빈약.
- `conversation_messages.created_concept_id/merged_concept_id` — 신규, 백필 없음.

### 9.4 마이그레이션

Drizzle가 `pnpm db:generate` 실행 시 `packages/db/drizzle/` 디렉토리에 자동 번호(`0008_*.sql`)로 생성. Plan 13의 `0007_natural_proemial_gods.sql`(embedding 768d 전환) 뒤에 붙음.

**배포 순서:**
1. `pnpm db:migrate` (ALTER들은 모두 `ADD COLUMN IF NOT EXISTS`, 5초 이내)
2. 별도 worker job: `notes.title_summary_embedding` 배치 백필 (수시간)
3. 백필 완료 확인 → feature flag `FEATURE_RELATED_PAGES=on`

---

## 10. API Surface

Plan 11A 경로 재사용 + 신규 엔드포인트 5개.

### 10.1 신규

```
# Save Suggestion (§4)
POST /api/chat/messages/:id/save-suggestion
  body: { mode: 'new' | 'merge', target_concept_id?: string }
  → 202 { workflow_id }
  SSE: { type: 'save_suggestion_done', concept_id, mode_applied }

# Page provenance (§5)
GET /api/notes/:noteId/conversations
  → 200 { conversations: [...], total }

POST /api/notes/suggest-from-conversations
  body: { workspaceId, title }
  → 200 { suggestions: [{ conversationId, title, similarity, preview }] }

POST /api/notes/:noteId/compile-from-conversation
  body: { conversationId, messageIds?: string[] }
  → 202 { workflow_id }

# Slash commands (§6)
POST /api/notes/:noteId/doc-editor/commands/:commandName
  body: { selection, language?, documentContextSnippet }
  → SSE: delta / doc_editor_result / cost / done
```

### 10.2 Plan 11A SSE 스트림 확장

`POST /api/chat/message` 응답에 이벤트 2종 추가:

```
{ type: 'related_pages', pages: [...] }              # §7, assistant delta 시작 전
{ type: 'save_suggestion_ready', suggestion, mode, candidates }  # §4, done 직전
```

### 10.3 권한 체크 매트릭스

| Endpoint | 체크 |
|----------|------|
| `POST /save-suggestion` | `msg.conversation.owner_user_id == user` (Plan 11A §7.2) |
| `GET /notes/:id/conversations` | `canRead(noteId)` + 결과는 `conversation.owner_user_id == user` 필터 |
| `POST /suggest-from-conversations` | `canWrite(workspaceId)` + 본인 대화만 |
| `POST /compile-from-conversation` | `canWrite(noteId)` + 지정 대화 `owner_user_id == user` |
| `POST /doc-editor/commands/*` | `canWrite(noteId)` |
| SSE `related_pages` | 채팅 소유자 기준 `canRead` 헬퍼 (page_permissions ← project_permissions ← workspace_members) |

---

## 11. 테스트 전략 & 관측

### 11.1 단위 테스트 (pytest)

**DocEditorAgent (`apps/worker`)**
- 커맨드 모듈당 최소 3 케이스: happy / 빈 선택 / 긴 선택 (>2000자)
- `/cite`, `/factcheck`의 RAG 도구 mock (Plan 4 `ResearchAgent.hybrid_search` stub)
- Structured output pydantic 검증

**Save suggestion 프리체크 (`apps/api`)**
- 0.70 / 0.85 threshold 주변 → `new/ambiguous/merge` 분기
- 임베딩 API 실패 → `new` fallback
- 쿨다운 로직 (5턴 skip, 최대 3개)

**Provenance 쿼리**
- origin/contributor/cited 정렬
- 타인 대화 제외 필터 (프라이버시 핵심)
- `canRead` 실패 → 빈 목록

### 11.2 통합 테스트

**Save suggestion E2E**
- 대화 → 수락 → Compiler workflow → concept 생성 → `created_concept_id` 업데이트 → `save_suggestion_done` SSE
- Merge 경로: `concept_source_links(relation='contributor')` append + Librarian queue 진입

**Slash command E2E**
- `/improve` → Diff hunks → accept 시 Plate value 교체
- `/factcheck` → comment lane 생성 + 본문 불변
- 선택 range race → 409

**Related pages E2E**
- `related_pages` 이벤트가 첫 `delta`보다 먼저 도착
- 임베딩 타임아웃 시 이벤트 누락되어도 LLM 응답 정상

### 11.3 부하/비용 스모크

- workspace 10k 노트 시드 → `GET /notes/:id/conversations` p95 <200ms
- `title_summary_embedding` HNSW 검색 p95 <100ms
- 동시 100 slash commands → worker 세마포(Plan 4 Phase B) 재사용

### 11.4 관측

`activity_events` 신규 verb:

```
save_suggestion_shown          save_suggestion_dismissed
save_suggestion_accepted_new   save_suggestion_accepted_merge
save_suggestion_failed
doc_editor_invoked             doc_editor_diff_accepted
doc_editor_diff_rejected_all
related_pages_shown            related_pages_clicked
```

Grafana 대시보드:
- save_suggestion 수락률 (accepted / (accepted + dismissed))
- slash command diff accept ratio
- related_pages click-through
- doc_editor p50/p95 레이턴시, 에러율
- workspace별 doc_editor 월 사용량 / 비용

이 지표가 §4.1 system prompt 튜닝의 기준.

### 11.5 LLM prompt 리그레션

Save suggestion 품질은 모델·프롬프트 변경에 민감.

- 픽스처: 30개 대화 샘플, `should_save=true/false` 라벨
- CI에서 프롬프트 변경 시 precision/recall 스냅샷 갱신
- precision -10%p 이상 하락 시 PR block
- 위치: `apps/worker/tests/fixtures/save_suggestion/*.yaml`
- 초기 샘플은 내부 dogfooding 수집

---

## 12. 롤아웃 & Feature Flags

### 12.1 Phase 순서

**Phase A — 데이터 모델 & API 셸** (Plan 11A 구현 완료 직후)
- 마이그레이션 0008 배포
- 5개 신규 엔드포인트 노출 (스켈레톤, 플래그 뒤)
- `title_summary_embedding` 백필 시작
- UI 노출 없음

**Phase B — Slash commands**
- `FEATURE_DOC_EDITOR_SLASH=on`
- Plate slash menu에 AI 섹션
- 6개 커맨드 동시 출시

**Phase C — Save suggestion** (가장 위험)
- `FEATURE_SAVE_SUGGESTION=on`
- 내부 Alpha 2주 → 10% beta 2주 → GA
- 수락률 <20%면 프롬프트 재조정

**Phase D — Page provenance & Related pages**
- `FEATURE_PAGE_PROVENANCE=on`
- `FEATURE_RELATED_PAGES=on`
- Phase C 안정화 후. 두 기능 동시 on 가능.

### 12.2 킬 스위치 (3단)

1. 환경변수 OFF → 전체 차단
2. workspace 설정 OFF → workspace 전체 차단
3. `/settings/chat` 토글 OFF → 본인만 차단

비용 폭주/프라이버시 인시던트 시 1단계로 즉시 차단.

### 12.3 점진 출시 원칙

- **Save suggestion만** Alpha → Beta → GA (precision 튜닝 필요)
- Slash / related pages / provenance는 Alpha → GA (리스크 낮음)

---

## 13. Out of Scope (Plan 11C+ 후보)

- Research agent 백그라운드 → Draft 문서 자동 생성
- CriticAgent 자발적 comment lane 참여
- 채팅 답변 → 에디터 drag-drop (Plate drag API 연구 필요)
- LLM 자발적 에디터 편집 모드 (사용자 승인 없이)
- 커스텀 slash 커맨드 (L4 workspace memory 기반)
- Multi-block 트랜잭션 슬래시 커맨드 (`/refactor section`)
- Semantic 페이지 히스토리 (provenance와 분리 유지)
- 크로스 workspace provenance federation (의도적 영구 금지, collaboration-model §3.5)

---

## 14. Open Questions (구현 plan 단계에서 해결)

1. Save suggestion structured output 방식: Gemini structured output vs tool-use emulation — Plan 13 multi-provider 호환 고려
2. 토큰 에스티메이터 — Plan 11A §14.1과 동일
3. 백필 배치 크기·토큰 예산 (Batch API 사용) — `title_summary_embedding` 전체 workspace 대상
4. Comment lane `/factcheck` 배지 UI 구현 — Plate decoration API
5. Diff View race 감지 간격 (현재 Plan은 409 fallback만)
6. `suggest-from-conversations` 유사도 threshold 0.75의 검증 — 초기 값, 데이터 확보 후 튜닝
