# LLM Anti-Patterns

Claude가 반복적으로 틀리는 것들. 구현 전 반드시 확인.

---

## Gemini 모델 ID

| 틀린 것 | 올바른 것 |
|--------|---------|
| `gemini-2.0-flash` | `gemini-3-flash-preview` |
| `gemini-2.0-flash-exp` | `gemini-3-flash-preview` |
| `gemini-1.5-pro` | `gemini-3.1-pro-preview` |
| `gemini-3.0-flash` | `gemini-3-flash-preview` |
| `text-embedding-004` | `gemini-embedding-2-preview` |
| `gemini-2.5-flash-tts` | `gemini-2.5-flash-preview-tts` |
| `gemini-2.5-pro-tts` | `gemini-2.5-pro-preview-tts` |
| `gemini-2.5-flash-live` | `gemini-3.1-flash-live-preview` |

**Gemini 문서는 항상 로컬 참조:** `references/Gemini_API_docs/`

---

## Next.js 16

| 틀린 것 | 올바른 것 |
|--------|---------|
| `middleware.ts` | `proxy.ts` |

- Next.js 16에서 `middleware.ts`는 deprecated — `proxy.ts` 사용
- `NextRequest` → `NextResponse` 구조는 동일
- `config.matcher` 필수 (정적 에셋 포함 전체 실행 방지)

```ts
// proxy.ts (Next.js 16)
export function proxy(request: NextRequest) {
  // 기존 middleware 로직 그대로 사용 가능
}
export const config = { matcher: ["/api/:path*", "/(app)/:path*"] };
```

---

## Vector Dimension

| 틀린 것 | 올바른 것 |
|--------|---------|
| `VECTOR(3072)` 하드코딩 | `VECTOR_DIM` env 변수 |
| `vector3072` 커스텀 타입 | `const VECTOR_DIM = parseInt(process.env.VECTOR_DIM ?? "3072")` |

Provider별 기본값: Gemini=3072, OpenAI=1536, Ollama(nomic)=768

---

## LLM Provider

| 틀린 것 | 올바른 것 |
|--------|---------|
| `from worker.gemini.client import GeminiClient` | `from llm import get_provider` |
| `GeminiClient(api_key=...)` 직접 생성 | `get_provider()` 팩토리 사용 |
| `EMBED_MODEL = "gemini-embedding-2-preview"` 하드코딩 | `os.environ["EMBED_MODEL"]` |

---

## 라이브러리 참조

| 상황 | 참조 방법 |
|------|---------|
| Gemini API (google-genai) | `references/Gemini_API_docs/` 로컬 문서 |
| 그 외 모든 라이브러리 | context7 MCP 사용 |

**Gemini API는 절대 학습 데이터에 의존하지 말 것** — 모델명/메서드명이 자주 바뀜.

---

## Agent Runtime (spec: `2026-04-20-agent-runtime-standard-design.md`)

`apps/worker/src/worker/agents/**/*.py`에 적용되는 규칙. Plan 12 완료 후 runtime facade(`apps/worker/src/runtime/`)가 존재하면 **린트로 강제됨** (`apps/worker/scripts/check_import_boundaries.py`).

### 에이전트 파일에서 `langgraph` / `langchain_core` 직접 import 금지

| 틀린 것 | 올바른 것 |
|--------|---------|
| `from langgraph.graph import StateGraph` | `from runtime import Agent, tool` |
| `from langchain_core.messages import HumanMessage` | `from runtime import AgentEvent` |
| `from langgraph.checkpoint.postgres import PostgresSaver` | (runtime 내부에서만 사용) |

12 에이전트는 `runtime` facade로만 접근. LangGraph 교체 시 blast radius를 runtime 모듈 하나로 격리한다.

### LangGraph channel state mutation 금지

```python
# ❌ 금지 — state["messages"]는 mutable이라 다음 step에도 전염
def node(state):
    state["messages"].append(msg)
    return {}

# ✅ 리듀서에 병합 위임
def node(state):
    return {"messages": [msg]}
```

### `operator.add`로 무한 누적 리스트 금지

```python
# ❌ 금지 — messages가 unbounded 누적 → context 비대화
messages: Annotated[list, operator.add]

# ✅ 윈도우 리듀서 사용
from runtime import keep_last_n
messages: Annotated[list, keep_last_n(50)]
```

### `interrupt()` across Temporal activity 경계 금지

LangGraph `interrupt()`는 caller가 실시간 pause/resume 가능하다고 가정. Temporal activity 경계를 넘으면 resume context가 lost. HITL은 반드시:

1. Agent가 `AwaitingInput` 이벤트 yield
2. Activity가 `AgentAwaitingInputError` raise (Temporal RetryPolicy `non_retryable_error_types`에 포함)
3. Workflow가 catch → `wait_condition(signal)` → 재입력 받은 input으로 activity 재실행

### 동일 `thread_id`로 두 activity 동시 실행 금지

LangGraph checkpoint race 발생. `make_thread_id(workflow_id, agent_name, parent_run_id)`로 유일성 보장.

### 에이전트 코드에서 LangGraph callback 직접 등록 금지

```python
# ❌ 금지
graph.compile(checkpointer=saver, callbacks=[MyCallback()])

# ✅ HookRegistry로만 등록
from runtime import HookRegistry
reg.register(my_hook, scope="agent", agent_filter=["research"])
```

`LangGraphBridgeCallback`이 runtime 내부에서 **단 한 번** 그래프에 attach되어 모든 langchain-core 콜백을 HookChain으로 위임한다.

