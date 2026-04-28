# Agent Humanizer — Streaming UX Design Spec

**Status:** Draft (2026-04-22) → Open questions resolved 2026-04-28 (see §13). Event-name reconciliation against Plan 12's actual `events.py` added in §5.2 / §9.1.
**Owner:** Sungbin
**Related:**
- [agent-runtime-standard-design.md](./2026-04-20-agent-runtime-standard-design.md) — `AgentEvent` 원천
- [agent-chat-scope-design.md](./2026-04-20-agent-chat-scope-design.md) — SSE 포워딩 포인트
- [2026-04-21-plan-11b-chat-editor-knowledge-loop-design.md](./2026-04-21-plan-11b-chat-editor-knowledge-loop-design.md) — 채팅 UI 통합 지점
- Plan 2D (chat renderer) — 렌더링 대상
- 레퍼런스: Claude Code CLI, Gemini Deep Research `thinking_summaries`, Perplexity Pro Search

## Dependencies

- **Plan 12 (Agent Runtime Standard)** — 이 spec은 Plan 12의 `AgentEvent` 스트림 위에서 동작한다. 새 이벤트 타입 (`thought_summary`, `phase_transition`, `status_line`, `route_decision`)을 Plan 12 enum에 **추가**하되 기존 9종은 건드리지 않는다.
- **Plan 13 (multi-LLM)** — Gemini provider에 `thinking_summaries: "auto"` 옵션 plumbing 필요. Ollama는 지원 모델(QwQ, DeepSeek-R1)에만 해당, 미지원 시 graceful skip.
- 본 spec 구현은 **Plan 2D (chat renderer)의 prerequisite**. 2D가 humanizer 출력을 렌더링한다.

---

## 1. Problem

Agent 실행 중 사용자에게 보이는 것이 현재 둘 중 하나다:

1. **무반응** — "처리 중..." 로딩 스피너만 돌고 최종 답변이 올 때까지 아무 정보 없음
2. **전문가용 raw 로그** — `tool_call hybrid_search args={...}` 같은 개발자향 덤프

둘 다 UX 낙제. 사용자는:
- 에이전트가 **뭘 하고 있는지** 알고 싶다 (신뢰)
- 잘못된 방향이면 **개입하고 싶다** (통제)
- 결과가 올 때까지 **지루하지 않기**를 바란다 (체류)
- 개발자 덤프에 **압도되지 않기**를 바란다 (접근성)

Claude Code CLI, Gemini Deep Research의 `thinking_summaries`, Perplexity의 "Pro Search 단계 표시"가 이 문제를 각자 해결한 방식이다. 이 spec은 OpenCairn 컨텍스트에 맞게 그 패턴을 이식한다.

## 2. Goals & Non-Goals

**Goals**
- AgentEvent raw 스트림을 **정직하고 간결한 사용자 언어**로 변환
- Gemini의 `thought_summary` 델타를 받아 중간 추론을 스트리밍
- 구현체가 에이전트마다 일관된 톤을 유지하면서 에이전트별 맥락 반영
- 이벤트 폭주 시 rate control로 UX 노이즈 방지
- 개발자/파워유저용 "raw 로그 보기" 토글 보존

**Non-goals (v0.1)**
- LLM-generated progress messages (fabrication 리스크 — §8 참조)
- 다국어 한영 자동 전환 — locale 고정 (ko-first, en 추후 parity)
- 웹 UI 렌더링 자체 — Plan 2D 범위
- 사용자 피드백 기반 자동 톤 튜닝

## 3. 4-Layer Architecture

```
┌─────────────────────────────────────────────────────┐
│ Layer 4 — Tone           시스템 프롬프트 (Agent 최종 답변에만) │
│ Layer 3 — Humanizer      AgentEvent → 한국어 status string  │
│ Layer 2 — Thought Stream Gemini thinking_summaries delta   │
│ Layer 1 — AgentEvent     Plan 12 표준 스트림 (이미 존재)     │
└─────────────────────────────────────────────────────┘
         ↓ SSE ↓
┌─────────────────────────────────────────────────────┐
│ Client — Renderer (Plan 2D)                          │
│  · 라이브 status line (debounced 300ms)              │
│  · thought bubble (접이식, 기본 펼침)                 │
│  · tool chip ("3건 검색 중...")                      │
│  · final answer (Layer 4 tone 적용)                  │
└─────────────────────────────────────────────────────┘
```

**핵심 원칙: Layer 1-3은 deterministic, Layer 4만 LLM.**

Layer 3가 LLM을 호출하면 progress message를 fabricate하기 시작한다 (Claude Code도 가끔 "Let me check the tests" 라 해놓고 안 읽는 함정). 반드시 순수 함수여야 한다.

## 4. Layer 2 — Thought Summaries Plumbing

### 4.1 Gemini 측 옵션

```python
# packages/llm/src/llm/gemini.py
agent_config = {
    "thinking_summaries": "auto",  # 또는 "off"
}
response = client.interactions.create(
    input=prompt,
    model=model_id,
    agent_config=agent_config,
    stream=True,
)

for chunk in response:
    if chunk.event_type == "content.delta":
        if chunk.delta.type == "thought_summary":
            yield AgentEvent(
                type="thought_summary",
                agent_run_id=run_id,
                text=chunk.delta.content.text,
            )
        elif chunk.delta.type == "text":
            yield AgentEvent(type="content_delta", text=chunk.delta.text)
```

### 4.2 기본값 정책

| 에이전트 | `thinking_summaries` 기본값 | 이유 |
|---|---|---|
| Research | `auto` | 사용자 직접 보는 결과, 신뢰 핵심 |
| Librarian | `auto` | 장시간 작업, 진행상황 절실 |
| Compiler | `off` | 단발 변환, 요약 노이즈 |
| Connector/Curator | `off` | 배치 백그라운드, 보여줄 UI 없음 |
| Narrator/Socratic | `off` | 대화 흐름 중요, 지연 최소화 |
| Deep Research | `auto` | 에이전트 자체가 요구 (레퍼런스 문서 §Streaming) |

### 4.3 Ollama fallback

`LLMProvider.thinking_summaries_supported(model_id: str) → bool` 추가. 지원 안 하면 silently skip. AgentEvent에 `thought_summary` 이벤트 없을 뿐 정상 동작.

## 5. Layer 3 — Humanizer (핵심)

### 5.1 시그니처

```python
# apps/worker/src/runtime/humanizer.py

def humanize(event: AgentEvent, agent_type: str) -> StatusLine | None:
    """Pure function. AgentEvent → short Korean sentence (or None to suppress)."""
```

반환 `None`이면 이 이벤트는 status line으로 보내지 않는다 (노이즈 억제).

### 5.2 이벤트 → 메시지 매핑 (예시)

> **Reconciliation note (2026-04-28):** Plan 12의 `apps/worker/src/runtime/events.py`는 9개 이벤트(`agent_start`, `agent_end`, `agent_error`, `model_end`, `tool_use`, `tool_result`, `handoff`, `awaiting_input`, `custom`)를 갖는다. 본 spec 초안에서 사용한 `tool_call` / `tool_end` / `tool_end_error` / `phase_transition` / `retry` / `model_start` / `content.delta` 명칭은 실제 enum과 일치하지 않는다. 매핑 키는 아래로 정정:
>
> | spec 초안          | 실제 source                                                                 |
> | ------------------ | --------------------------------------------------------------------------- |
> | `tool_call`        | `tool_use`                                                                  |
> | `tool_end`         | `tool_result` (`ok=True`)                                                   |
> | `tool_end_error`   | `tool_result` (`ok=False`)                                                  |
> | `phase_transition` | **신규 — `BaseEvent` 서브클래스로 추가** (§9.1) 또는 `custom(label="phase")` |
> | `retry`            | **신규 — 동일하게 추가** (Q1 하이브리드 정책 지원에 필요)                      |
> | `model_start`      | 미존재. SDK가 streaming chunk 시작 신호를 별도 이벤트로 내지 않음. 억제 X.  |
> | `content.delta`    | Gemini `thought_summary` 델타용 별도 신규 이벤트 (§4.1, §9.1)                |

```python
TEMPLATES = {
    # 명시적으로 사용자에게 보이는 이벤트
    ("research", "tool_use", "hybrid_search"):
        lambda e: f"‘{e.input_args['query']}’ 관련 문서 훑는 중…",
    ("research", "tool_result", "hybrid_search"):
        lambda e: f"{len(e.output)}건 찾음" if e.ok else None,
    ("research", "tool_use", "fetch_page"):
        lambda e: f"노트 열어보는 중: ‘{e.input_args['page_title']}’",
    ("compiler", "tool_use", "extract_concepts"):
        lambda e: "개념 추출 중…",
    ("compiler", "phase_transition", "validate"):
        lambda e: "스키마 검증 중…",
    ("librarian", "phase_transition", "rebuild_links"):
        lambda e: "위키 링크 재구축 중 (길어질 수 있어요)…",

    # 오류 / 방향 전환 (Q1 하이브리드)
    # 같은 도구 동일 args 재시도 → status_line, 도구를 바꾼 시도 → phase_transition.
    # 판별은 emit 측이 책임 (humanizer는 event.kind만 본다).
    ("*", "tool_result", "*"):
        lambda e: None if e.ok else f"{e.tool_name} 실패 → 다른 방법 시도",
    ("*", "retry", "*"):
        lambda e: "API가 잠깐 느리네요, 재시도 중…",

    # 억제 (None 반환)
    ("*", "model_end", "*"): None,
    ("*", "agent_start", "*"): None,
    ("*", "agent_end", "*"): None,
}
```

phrase 길이는 humanizer가 출력 직전 60자로 truncate한다 (모바일 overflow 방지, §11.3).

### 5.3 스타일 가이드

| 원칙 | 예 | 반례 |
|---|---|---|
| 존댓말 | "찾는 중…" | "찾는중ㅋ" |
| 현재진행형 (ing) | "훑는 중" | "훑었어요" |
| 주어 생략 (에이전트 = 당연한 주어) | "3건 찾음" | "에이전트가 3건 찾았어요" |
| 정직함 (기술적) | "hybrid_search 호출 중" → ❌ 너무 raw → ✅ "관련 문서 검색 중" | "지혜의 두루마리를 펼치는 중..." |
| 고유명사 인용 | `‘CNN이란?’` | `CNN이란?` (따옴표 없음) |
| 토큰 수 절대 노출 X | — | "input 12,384 tokens…" |
| 이모지 금지 (v0.1) | — | "🔍 검색 중 ✨" |

### 5.4 Phase Transition 이벤트

Plan 12의 9개 이벤트엔 "phase 바뀜"이 없다. 에이전트가 명시적으로 yield한다:

```python
yield AgentEvent(type="phase_transition", phase="search")
yield AgentEvent(type="phase_transition", phase="read")
yield AgentEvent(type="phase_transition", phase="synthesize")
yield AgentEvent(type="phase_transition", phase="write")
```

Humanizer가 이것들을 pick up해서 구분선 있는 status line을 생성한다 ("이제 읽어볼게요…"). Claude Code의 "Let me now..." 패턴.

## 6. Rate Control

### 6.1 Debounce

```
status_line_debounce_ms = 300
```

같은 에이전트에서 300ms 내에 2개 이상 status line이 발생하면 마지막 것만 클라이언트로 전송.

### 6.2 즉시 플러시 예외

다음은 debounce 무시 즉시 전송:
- `phase_transition`
- `tool_end_error`
- `route_decision` (§ model-router-spec 참조)
- `run_end`
- 사용자가 호출한 명시적 툴 (예: KG 검색 버튼)

### 6.3 Thought summary는 throttle 없음

Gemini가 내는 자연 속도 그대로 스트림. 문자 단위라 UX 자연스러움. Debounce하면 오히려 끊겨 보인다.

## 7. Layer 4 — Tone (Agent 최종 답변)

Agent가 생성하는 *본답변* 자체의 스타일은 시스템 프롬프트로 제어:

```
너는 OpenCairn의 Research 에이전트다. 답변 스타일:
- 한국어 존댓말
- 짧게, 불필요한 수사 제거
- 인용 필수 (출처 없는 주장 금지)
- 때로 재치 있게, 단 과한 이모지 / 느낌표 남발 금지
- 모르는 것은 모른다고 명시
```

**중요:** 이 톤 지침을 Layer 3 humanizer 템플릿에는 넣지 않는다. Progress message는 정직한 기술 언어. 재치는 최종 답변에만.

## 8. Anti-patterns (반드시 회피)

| 하지 말 것 | 왜 |
|---|---|
| LLM이 progress 메시지 생성 | Fabrication 리스크. `humanize()`는 순수 함수. |
| 이모지로 상태 표시 (🔍✨🎯) | 2분이면 피곤함. 정보 밀도 낮음. |
| "완료!" 같은 일괄 긍정어 | 실패해도 긍정어 → 신뢰 훼손 |
| 한영 혼용 ("Analyzing 노트") | 스타일 일관성 X. locale 고정. |
| 토큰 수 / raw tool name 노출 | 개발자 토글로만 |
| 에이전트 내부 plan 전체 노출 | 정보 과잉, "왜 이걸 검색하지?" 같은 의심 유발 |
| `run_end` 때 긴 요약 | 최종 답변 자체가 요약. 별도 요약은 중복. |

## 9. Data Model Additions

### 9.1 새 AgentEvent 타입

Plan 12의 `events.py`는 enum이 아니라 **discriminated union of `BaseEvent` 서브클래스**다. 신규 이벤트도 같은 패턴으로 추가하고 `AgentEvent` Annotated Union 멤버에 끼운다 — enum 추가가 아니다.

```python
# apps/worker/src/runtime/events.py 에 추가

class ThoughtSummary(BaseEvent):
    """Gemini thinking_summaries 델타. 문자 단위 streaming."""
    type: Literal["thought_summary"] = "thought_summary"
    text: str
    delta_index: int   # 같은 turn 내 누적 인덱스 (재정렬 방지)

class PhaseTransition(BaseEvent):
    """에이전트가 명시적으로 yield하는 단계 경계."""
    type: Literal["phase_transition"] = "phase_transition"
    phase: str             # "search" | "read" | "synthesize" | "write" | (자유)
    reason: str | None = None

class StatusLine(BaseEvent):
    """Humanizer가 derive한 한 줄 — runtime hook 안에서 emit."""
    type: Literal["status_line"] = "status_line"
    text: str
    kind: Literal["info", "progress", "error", "phase"]
    phase: str | None = None
    debounced: bool = False

class Retry(BaseEvent):
    """동일 도구 + 동일 args 재시도. 도구를 *바꾼* 시도는 PhaseTransition으로 emit."""
    type: Literal["retry"] = "retry"
    tool_name: str
    attempt: int
    reason: str

class RouteDecision(BaseEvent):
    """별도 spec (model-router-spec) 소유. 본 spec에선 wire-format만 예약."""
    type: Literal["route_decision"] = "route_decision"
    chosen_model: str
    reason: str

# 기존 Annotated Union에 5개 추가
AgentEvent = Annotated[
    Union[
        AgentStart, AgentEnd, AgentError, ModelEnd, ToolUse, ToolResult,
        Handoff, AwaitingInput, CustomEvent,
        ThoughtSummary, PhaseTransition, StatusLine, Retry, RouteDecision,
    ],
    Field(discriminator="type"),
]
```

**호환성:** 기존 9개 이벤트의 시그니처는 변경 없음. 추가만. `langgraph_bridge.py` / `temporal.py` / `default_hooks.py`는 새 타입을 통과시키되 *이해하지 않는다* (humanizer hook만 새 5개를 본다).

### 9.2 `StatusLine` 구조

```python
class StatusLine(BaseModel):
    text: str            # "‘CNN’ 관련 문서 훑는 중…"
    kind: Literal["info", "progress", "error", "phase"]
    phase: str | None    # phase_transition 에서 유래 시
    debounced: bool      # true면 클라이언트가 이전 것 교체
```

### 9.3 SSE wire format

기존 AgentEvent SSE 포워딩 경로에 그대로 태운다. 새 필드만 추가:

```
event: agent_event
data: {"type":"status_line","text":"‘CNN’ 관련 문서 훑는 중…","kind":"progress","debounced":true}
```

## 10. Integration Points

| 파일 (신규) | 책임 |
|---|---|
| `apps/worker/src/runtime/humanizer.py` | `humanize()` 순수 함수 + 템플릿 레지스트리 |
| `apps/worker/src/runtime/hooks/humanizer_hook.py` | `AgentEvent` 스트림에 middleware로 끼우기 |
| `apps/worker/src/runtime/hooks/debounce.py` | 300ms debounce 유틸 |
| `packages/shared/src/schemas/agent-status.ts` | Zod `StatusLine` 타입 (FE 공유) |
| `docs/agents/humanizer-templates.md` | 모든 템플릿 매핑 표 (review-able document) |

| 파일 (수정) | 변경 |
|---|---|
| `apps/worker/src/runtime/*.py` | AgentEvent enum에 4개 타입 추가 |
| `packages/llm/src/llm/gemini.py` | `thinking_summaries` 파라미터 plumbing |
| `packages/llm/src/llm/base.py` | `thinking_summaries_supported()` 추가 |
| `apps/api/src/routes/agents/stream.ts` | 새 이벤트 타입 pass-through |

## 11. Testing Strategy

### 11.1 Humanizer 단위 테스트

```python
def test_humanize_research_hybrid_search():
    event = AgentEvent(type="tool_call", tool_name="hybrid_search",
                      args={"query": "CNN"})
    result = humanize(event, agent_type="research")
    assert result.text == "‘CNN’ 관련 문서 훑는 중…"
    assert result.kind == "progress"
```

모든 템플릿에 대해 표준 케이스 + 에지(빈 args, 긴 query truncate, 특수문자) 커버.

### 11.2 E2E

`apps/worker/tests/e2e/test_humanizer_stream.py`:
- Mock AgentEvent 스트림 → SSE 생성 → 클라이언트 수신 순서 검증
- Debounce: 100ms 간격 3개 이벤트 → 마지막 하나만 수신
- Thought summary: Gemini mock으로 `thought_summary` 델타 주입 → 클라이언트에 순서대로 도착

### 11.3 수동 QA 체크리스트

- [ ] Research 1개 질문 → status line 5-10개 자연스러운 한국어로 흐름
- [ ] Compiler 긴 파일 → phase transition 명시 ("분석 → 추출 → 검증")
- [ ] 에러 케이스 → "실패 → 재시도" 정직 표시
- [ ] Deep Research → thought bubble 접이식 렌더링
- [ ] 모바일에서 status line 길이 overflow 처리

## 12. Rollout

| Phase | 범위 |
|---|---|
| v0.1 | Research / Compiler / Librarian에만 humanizer 적용 |
| v0.2 | Narrator / Socratic — 대화 흐름 안 깨는 선에서 최소 적용 |
| v0.3 | Connector / Curator — 백그라운드 표시 (optional notification) |
| v1.0 | 모든 12 에이전트 coverage, 템플릿 리뷰 루프, a11y 검증 |

## 13. Resolved Decisions (2026-04-28)

초안 §13의 4개 Open Question을 결정했다. 이후 plan은 아래 결정 위에서 작성한다.

### 13.1 재시도 표현 — **하이브리드 (도구 동일 vs 도구 변경)**

- **같은 도구 + 동일 args 재시도** → `Retry` 이벤트 → humanizer는 `status_line(kind="progress")` 한 줄. 예: `"API가 잠깐 느리네요, 재시도 중…"`
- **다른 도구로 우회 / 새 경로 탐색** → `PhaseTransition` 이벤트 → humanizer는 `status_line(kind="phase")` + 구분선. 예: `"이제 다른 방법으로…"`
- 판별은 **emit 측 책임**: 에이전트 코드가 어느 이벤트를 yield할지 결정. `tool_result(ok=False)` 자체는 humanizer에서 단순 status_line으로만 변환 (실패 표시).

### 13.2 모바일 / 데스크톱 status line 정책 — **한 줄 롤링 교체 (분기 없음)**

Claude Code `AgentProgressLine` 구조를 차용하되 웹 컴포넌트로:

- **단일 슬롯**: live status line은 항상 1줄, 새 status_line 이벤트 도착 시 phrase **교체** (이전 phrase는 사라짐). 현재 `apps/web/src/components/agent-panel/conversation.tsx`의 `live.status?.phrase` 모델이 이미 이 형태 — 보존.
- **첫 이벤트 전 디폴트**: phrase 없을 때 `"Initializing…"` 키 사용 (i18n: `agentPanel.status.initializing`).
- **resolve 시**: turn 종료(`agent_end` 또는 SSE `done`) 즉시 status line 숨김. 별도 "완료" 토스트 없음 — 메시지 버블 자체가 완료 시그널.
- **모바일 별도 분기 없음**: 동일 컴포넌트, 동일 정책. phrase 길이는 humanizer가 60자로 truncate (§5.2 끝줄).
- **tool count / token count suffix는 v0.2 이후로 deferred**: v0.1 범위에서는 phrase 단일 string만. spec의 `StatusLine.text` 1개 필드로 충분.

### 13.3 취소 / 사용자 개입 — **composer 토글 (상시 노출)**

이건 터미널이 아니다. Claude.ai / Cursor / ChatGPT 공통 패턴:

- **composer의 send 버튼이 streaming 중엔 stop 버튼으로 토글** — 아이콘 swap만, 추가 floating UI 없음.
- **상시 노출**: N초 지연 / 키바인딩 의존 없음. Esc 단축키도 v0.1엔 미도입.
- **모바일/데스크톱 동일**.
- **클릭 동작**: 진행 중 SSE 연결 abort + 부분 결과 보존(이미 받은 텍스트는 그대로 메시지 row에 저장, status는 `"failed"` 대신 `"cancelled"` 신규 상태). DB schema는 `chat_messages.status` enum에 `"cancelled"` 추가.
- **API**: `DELETE /api/chat/conversations/:id/active` 또는 SSE 측에서 클라이언트 abort 만으로도 `finalizeAgentMessage(..., "cancelled")` 트리거. 단순한 후자 채택.

### 13.4 Status line 히스토리 저장 — **NDJSON trajectory만 (DB / LocalStorage X)**

- **DB sidecar 저장 안 함**: humanizer 템플릿이 바뀌면 과거 메시지의 status가 옛 텍스트로 박제되어 오히려 나쁨. `chat_messages.content`는 최종 답변 텍스트 + 인용 + thought summary만.
- **NDJSON trajectory가 source of truth**: Plan 12 runtime이 이미 모든 `AgentEvent`를 `runtime/trajectory.py`로 NDJSON에 저장. 새 5개 이벤트도 자동으로 기록됨. 디버깅 / 리플레이는 trajectory 위에서 humanize() 재실행.
- **새로고침 후 지난 turn의 status line 표시 X**: §13.2의 "한 줄 롤링" 정책상 turn 종료 즉시 사라지는 게 정합. 사용자 기대와 일치.
- **LocalStorage 캐시 안 함**: 동일 이유 + privacy.

## 14. Success Metrics

- **체감 응답성 (subjective)**: "에이전트가 뭐 하는지 알 수 있다" 사용자 설문 > 4/5
- **이탈률**: 에이전트 실행 중 탭 이탈 비율 v0.1 대비 30% 감소
- **취소율**: 사용자 취소 비율 — 증가해도 OK (개입 가능해진 증거)
- **오해 리포트**: "에이전트가 A 한다더니 B 했다" — 0건 유지 (humanizer deterministic이라 fabricate 없어야)
