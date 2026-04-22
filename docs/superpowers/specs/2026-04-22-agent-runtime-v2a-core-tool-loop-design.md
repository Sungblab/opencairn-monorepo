# Agent Runtime v2 · Sub-project A — Core Tool-Use Loop

**Status:** Draft (2026-04-22)
**Owner:** Sungbin
**Umbrella:** [`2026-04-22-agent-runtime-v2-umbrella.md`](./2026-04-22-agent-runtime-v2-umbrella.md)
**Related:**
- Plan 4 Phase B (`research/hybrid_search.py` 재사용)
- Plan 12 (runtime.Agent facade)
- `docs/architecture/context-budget.md` (synopsis-only 주입 원칙)
- `docs/architecture/collaboration-model.md` §3.5 (workspace isolation)
- `references/Gemini_API_docs/04-tools/Function calling with the Gemini API.md`
- `references/Gemini_API_docs/05-agents/Agents Overview.md`
- Claude Code 리버스 엔지니어링 (세션 내부 노트, umbrella §2)

---

## 1. 목적 & 성공 기준

### 1.1 목적

OpenCairn worker에 **provider-agnostic tool-calling loop**를 도입한다. Gemini Python SDK의 자동 function calling 대신 **런타임이 루프를 소유**하여, Temporal activity 경계 안에서 단일 instrumentation·제어·관측이 가능한 agentic 기반을 만든다. 이 기반 위에 B(agent retrofit), C(고급 루프), D(MCP), E(safety), F(UI), G(chat mode)가 쌓인다.

### 1.2 Out of Scope (A에 없음)

- Parallel tool execution, streaming tool execution → **C**
- Compaction (snip/microcompact/autocompact) → **C**
- MCP 연동 → **D**
- 기존 Compiler/Research/Librarian retrofit → **B**
- Telemetry 실구현 (hooks는 interface만, no-op) → **E**
- 비용 기반 사용자 보호 차단 → **Umbrella §3 제약상 금지**
- Chat Mode 매핑 로직 (PLAIN / REFERENCE / EXTERNAL / FULL) → **G** (A는 인터페이스 보장만)

### 1.3 성공 기준 (Definition of Done)

다음 5개의 관찰 가능한 결과가 모두 달성되면 A 완료:

1. **Provider 계약 확장** — `LLMProvider.generate_with_tools(...)`이 base에 정의되고, `GeminiProvider`가 완전 구현, `OllamaProvider`는 `ToolCallingNotSupported` raise하는 stub
2. **Runtime 기반** — `runtime.tool_loop.ToolLoopExecutor` 클래스 존재. `runtime.Agent.run_with_tools(...)` 편의 메서드 추가
3. **Tool family 6개 구현** — `search_pages`, `emit_structured_output`, `fetch_url`, `list_workspace_topics`, `search_concepts`, `read_page` (`get_concept_graph`는 concept relations 테이블 상태에 따라 완성 또는 tool 등록 skip)
4. **ToolDemoAgent** 신규 에이전트. 단독 integration test에서 4가지 모드(plain/reference/external/full) 전부 E2E 성공
5. **테스트 커버리지** — Unit + Integration(실 Gemini + 실 Postgres) + Security(SSRF, workspace isolation, schema 검증)

### 1.4 변하지 않는 것 (명시)

- `LLMProvider.generate()` 기존 시그니처 유지 (B/C에서도)
- 기존 Compiler/Research/Librarian 동작 불변 (B에서 수정)
- Temporal workflow 구조 불변 (activity 1개 그대로)

---

## 2. Non-negotiable Constraints

Umbrella §3 참조. A에 직접 영향:

- **C1. Provider env-only** — `LLM_PROVIDER=gemini|ollama`만. UI 노출 금지. env에 없는 provider 자동 비활성
- **C2. 비용 자동 차단 금지** — `max_cost_usd` 기본 None. 관리형(`LLM_MANAGED_MODE=1`) + 예치금 임박만 예외. BYOK/PAYG 선제 차단 금지
- **C3. Workspace isolation** — `workspace_id`는 runtime이 강제 주입, LLM이 조작 불가. `system_managed_args` 메타로 tool에 선언
- **C4. `generate()` API 불변** — 신규 메서드만 추가
- **C5. Temporal determinism** — tool 호출은 activity 안에서만
- **C6. Gemini SDK capability guard** — `google-genai>=1.0.0` 기능만 사용, provider가 `supports_*()` 선언
- **C7. Tool 정의는 서버 전용** — description/schema 클라이언트 미노출

---

## 3. 아키텍처 개요

### 3.1 레이어 & 책임

```
┌──────────────────────────────────────────────────────────────────┐
│ Workflow layer (Temporal)                                        │
│   - @workflow.defn가 ToolLoopExecutor 실행을 activity로 dispatch │
│   - Retry policy, timeout, cancel 신호                          │
└────────────────┬─────────────────────────────────────────────────┘
                 │ execute_activity("run_tool_loop", params)
┌────────────────▼─────────────────────────────────────────────────┐
│ Activity boundary (한 activity = 전체 루프)                     │
│   runtime.Agent.run_with_tools(...)                              │
│     └── ToolLoopExecutor.run()                                   │
└────────────────┬─────────────────────────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────────────────────────┐
│ ToolLoopExecutor (runtime/tool_loop.py)                          │
│   State: messages, turn_count, tool_call_count, call_history     │
│   Guards: max_turns, max_tool_calls, loop_detector,              │
│           per_tool_timeout, budget_policy                        │
│   Sequential turn loop:                                          │
│     1. provider.generate_with_tools(...) → AssistantTurn         │
│     2. if no tool_uses → done                                    │
│     3. for each tool_use: execute → ToolResult                   │
│     4. append assistant + tool_results to messages               │
│     5. check guards, else goto 1                                 │
└────┬──────────────────────────┬──────────────────────────────────┘
     │ provider contract        │ tool dispatch
┌────▼───────────────┐    ┌─────▼────────────────────────────────┐
│ LLMProvider        │    │ ToolRegistry (runtime/tools.py)      │
│  generate_with_    │    │   - @tool decorator (기존 재사용)    │
│  tools() →         │    │   - system_managed_args 강제         │
│  AssistantTurn     │    │   - 6 concrete tools                 │
│                    │    │                                      │
│  GeminiProvider ✅ │    │   list_workspace_topics              │
│  OllamaProvider 🟥 │    │   search_concepts                    │
│  (stub)            │    │   search_pages                       │
└────────────────────┘    │   read_page                          │
                          │   fetch_url                          │
                          │   emit_structured_output             │
                          │   get_concept_graph (조건부)         │
                          └──────────────────────────────────────┘
```

### 3.2 컴포넌트 3개와 책임 경계

**1. `LLMProvider.generate_with_tools()` — *한 턴만* 담당**
- 입력: messages, tool declarations, config(temperature, max_output_tokens, cached_content_id, mode, final_response_schema)
- 출력: `AssistantTurn` (중간 표현, §6)
- **루프 책임 없음**. 한 번의 API 호출 + 응답 파싱
- Gemini: `genai.Client.aio.models.generate_content` + parts 순회 → tool_use 추출
- Ollama: `ToolCallingNotSupported` raise

**2. `ToolLoopExecutor` — *루프* 담당**
- 상태 머신 (§5)
- Provider-agnostic. `AssistantTurn` 계약 위에서 동작
- Temporal activity 안에서 실행. cancel 신호는 `asyncio.CancelledError`로 변환
- Observability 훅 (no-op default, E가 구현 연결)

**3. `ToolRegistry` + 6개 tool — *실행 단위* 담당**
- 기존 `runtime/tools.py`의 `@tool` 데코레이터 재사용 (Plan 12)
- `system_managed_args`, `requires_workspace_scope` 메타 추가
- 각 tool은 `async def`

### 3.3 데이터 흐름 (한 에이전트 호출)

```
Workflow →
  Activity("run_tool_loop", {workspace_id, user_prompt, tool_names, agent_cfg}) →
    load_tools(tool_names) + inject system_managed_args ({"workspace_id": ...}) →
    ToolLoopExecutor.run(messages=[user_prompt], tools=...) →
      turn 1: provider.generate_with_tools → AssistantTurn(tool_uses=[search_concepts(...)])
        → ToolRegistry.execute(tool_use) → ToolResult(data=...)
        → append to messages
      turn 2: provider.generate_with_tools → AssistantTurn(tool_uses=[read_page(...)])
        ...
      turn N: provider.generate_with_tools → AssistantTurn(final_text="...")
        → return LoopResult
    ← ActivityResult(final_text, usage, trace)
  ← Workflow result
```

### 3.4 파일 배치

```
apps/worker/src/runtime/
├── tool_loop.py          ← NEW: ToolLoopExecutor, LoopConfig, LoopState, LoopResult
├── tools.py              ← 기존, ToolMeta 확장
├── tool_declarations.py  ← 기존, AssistantTurn 연동 추가
├── agent.py              ← 기존, run_with_tools() 편의 메서드 추가
└── tools_builtin/        ← NEW 디렉토리
    ├── __init__.py       (BUILTIN_TOOLS tuple + 조건부 get_concept_graph)
    ├── search_pages.py
    ├── search_concepts.py
    ├── read_page.py
    ├── list_workspace_topics.py
    ├── fetch_url.py
    ├── emit_structured_output.py
    └── get_concept_graph.py   (stub or full, 조건부)

apps/worker/src/agents/
└── tool_demo_agent.py    ← NEW: ToolDemoAgent.plain()/.reference()/.external()/.full()

packages/llm/src/llm/
├── base.py               ← generate_with_tools() 추상 + supports_*() 선언 추가
├── gemini.py             ← generate_with_tools() 구현
├── ollama.py             ← stub raise
├── tool_types.py         ← NEW: ToolUse/ToolResult/AssistantTurn/UsageCounts
└── errors.py             ← NEW: ProviderError/ProviderRetryableError/ProviderFatalError/ToolCallingNotSupported
```

---

## 4. Tool 정의 & Tool family 6개

### 4.1 `@tool` 데코레이터 확장

```python
# runtime/tools.py (기존 파일 확장)

@dataclass
class ToolMeta:
    name: str
    description: str
    input_schema: dict
    # ── A 신규 ────────────────────────────────
    system_managed_args: tuple[str, ...] = ()
    requires_workspace_scope: bool = False
    is_read_only: bool = True
    is_concurrency_safe: bool = True     # A에선 순차만 하지만 선언
    max_result_chars: int = 50_000
    category: str = "general"            # retrieval | io | emit | ...
```

Tool 작성:
```python
@tool(
    name="search_pages",
    description="...",
    input_schema={...},
    system_managed_args=("workspace_id",),
    requires_workspace_scope=True,
    category="retrieval",
)
async def search_pages(query: str, workspace_id: str, k: int = 5) -> list[dict]:
    ...
```

### 4.2 Tool family 6개 (+1 조건부)

각 tool의 **목적 / input / output / 부작용 / 내부 호출**만 명시. 세부 구현은 plan 단계.

#### 4.2.1 `list_workspace_topics` — 탐색 진입점
- **목적**: Workspace의 최상위 topic 트리 (~10-30개)
- **Input**: `workspace_id` (system_managed)
- **Output**: `list[{topic_id, name, concept_count}]` (~500 tokens)
- **내부**: `concept` 테이블 topic 레벨 aggregation
- **설명 (LLM용)**: "Start here to see what domains this workspace covers. Use search_concepts next to drill into one."
- **category**: `retrieval`, read-only, concurrency-safe

#### 4.2.2 `search_concepts` — Wiki 레벨 검색 (synopsis)
- **목적**: Concept 레벨 hybrid search, synopsis만 반환
- **Input**: `query: str`, `workspace_id` (system_managed), `k: int = 5`, `topic_id: str | None = None`
- **Output**: `list[{concept_id, name, synopsis, score}]` (~1-2k tokens)
- **내부**: `apps/worker/.../research/hybrid_search.py` (Plan 4 Phase B) 래핑. Scope를 concept synopsis로 한정
- **설명**: "Hybrid BM25+vector search at concept level. Returns summaries, not full page content. Use read_page to drill into specific source pages."
- **category**: `retrieval`, read-only, concurrency-safe

#### 4.2.3 `search_pages` — Chunk 레벨 검색 (raw)
- **목적**: Raw chunk hybrid search (Layer 1 RAG, context-budget.md 정책 준수)
- **Input**: `query: str`, `workspace_id` (system_managed), `k: int = 5`, `mode: "synopsis" | "full" = "synopsis"`
- **Output**: `list[{page_id, chunk_id, content, score}]` (~2-5k tokens, mode에 따라)
- **내부**: `hybrid_search` 직접 래핑. `synopsis` 모드는 chunk 요약, `full`은 원문
- **설명**: "Chunk-level search when concept-level doesn't give enough detail. Prefer synopsis mode; full only for deep dives."
- **category**: `retrieval`, read-only, concurrency-safe

#### 4.2.4 `read_page` — 특정 페이지 전문
- **목적**: page_id로 전체 페이지 내용 (max_result_chars 적용)
- **Input**: `page_id: str`, `workspace_id` (system_managed)
- **Output**: `{page_id, title, content, created_at, ...}` (truncation 적용)
- **내부**: `page` 테이블 조회 + workspace_id 검증 (isolation)
- **설명**: "Fetch full content of a specific page. Use after search_concepts/search_pages identified something worth reading."
- **category**: `retrieval`, read-only, concurrency-safe

#### 4.2.5 `fetch_url` — 외부 URL 컨텍스트
- **목적**: 공개 HTTP(S) URL 내용 가져오기. Gemini built-in URL context 대신 자체 구현
- **Input**: `url: str` (workspace scope 없음 — 외부 리소스)
- **Output**: `{url, content, content_type}` (truncation 적용)
- **내부**: `httpx.AsyncClient.get(url, timeout=60)` + HTML → readability 텍스트 추출. Non-text는 `[binary content omitted]`
- **Security (필수)**:
  - **SSRF 방어**: RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8), link-local (169.254/16, AWS metadata 포함), IPv6 link-local (fe80::/10) **전부 거부**
  - URL scheme은 `http` / `https`만 허용. `file://`, `gopher://`, `ftp://` 등 거부
  - 응답 크기 10MB 초과 시 abort
  - DNS resolution 결과도 검증 (domain → private IP rebinding 방어)
- **설명**: "Fetch text content from a public URL. Fails for private/internal addresses."
- **category**: `io`, read-only, concurrency-safe, `max_result_chars=50000`

#### 4.2.6 `emit_structured_output` — 구조화 응답 제출
- **목적**: 모델이 최종 답을 구조화 객체로 "제출"하는 action tool. 호출 성공 시 loop 종료
- **Input**: `schema_name: str`, `data: dict` (schema_name은 미리 등록된 Pydantic 모델)
- **Output**: `{accepted: bool, validated: dict}` 또는 `{accepted: False, errors: [...]}`
- **내부**: `SCHEMA_REGISTRY[schema_name].model_validate(data)` 시도. 성공 시 결과를 loop의 `final_structured_output`에 저장 후 즉시 종료 플래그
- **설명**: "Submit your final answer as a structured object. The loop ends when a valid schema is accepted. If validation fails, fix the errors and retry."
- **category**: `emit`, NOT read-only, NOT concurrency-safe (종료 효과)
- **Schema registry**: `runtime/tools_builtin/schema_registry.py` — A는 데모용 2-3 schema만 (`ConceptSummary`, `ResearchAnswer`). B에서 확장

#### 4.2.7 `get_concept_graph` — 조건부 등록
- **목적**: 특정 concept의 N-hop 이웃과 관계
- **결정 규칙**: `packages/db/src/schema/`의 concept relations 테이블 존재 여부 체크
  - **있으면**: 전체 구현
  - **없으면**: `BUILTIN_TOOLS`에 등록 **안 함**. `ToolDemoAgent.full()` 도 이 tool 없이 동작 가능해야 함
- **Input (full version)**: `concept_id: str`, `workspace_id` (system_managed), `depth: int = 1`
- **Output**: `{concept, neighbors: [{concept_id, name, relation_type, distance}]}`
- **Spec에 명시**: "Concept relations 테이블이 없으면 이 tool은 B에서 concept relations schema 추가 시 활성화"

### 4.3 Tool result 크기 제한 & truncation

Claude Code 패턴 차용, A에선 단순 버전:
- Tool이 반환한 JSON 직렬화 결과가 `max_result_chars` 초과 시
- `str[:max_result_chars - 200]` + `"\n\n[truncated: original N chars]"` 주석
- Blob store (MinIO) 경유는 **C로 연기** (spec 주석)

### 4.4 Tool 등록 & discovery

```python
# runtime/tools_builtin/__init__.py
from .list_workspace_topics import list_workspace_topics
from .search_concepts import search_concepts
from .search_pages import search_pages
from .read_page import read_page
from .fetch_url import fetch_url
from .emit_structured_output import emit_structured_output

_base: tuple = (
    list_workspace_topics,
    search_concepts,
    search_pages,
    read_page,
    fetch_url,
    emit_structured_output,
)

if _concept_relations_table_exists():  # DB schema introspection
    from .get_concept_graph import get_concept_graph
    BUILTIN_TOOLS = (*_base, get_concept_graph)
else:
    BUILTIN_TOOLS = _base
```

### 4.5 ToolDemoAgent의 4가지 preset

```python
class ToolDemoAgent(runtime.Agent):
    @classmethod
    def plain(cls) -> "ToolDemoAgent":
        """Pure chat — no tools. G sub-project의 PLAIN 모드 검증용."""
        return cls(tool_names=())

    @classmethod
    def reference(cls) -> "ToolDemoAgent":
        """NotebookLM-style — retrieval only."""
        return cls(tool_names=(
            "list_workspace_topics", "search_concepts",
            "search_pages", "read_page",
        ))

    @classmethod
    def external(cls) -> "ToolDemoAgent":
        """Web agent — external tools only, no workspace data."""
        return cls(tool_names=("fetch_url", "emit_structured_output"))

    @classmethod
    def full(cls) -> "ToolDemoAgent":
        """Full agent — all available tools."""
        return cls(tool_names=tuple(t.meta.name for t in BUILTIN_TOOLS))
```

---

## 5. `ToolLoopExecutor` — 상태 머신 · 가드 · 종료

### 5.1 상태 타입

```python
# runtime/tool_loop.py

@dataclass
class LoopConfig:
    max_turns: int = 8
    max_tool_calls: int = 12
    max_total_input_tokens: int = 200_000
    per_tool_timeout_sec: float = 30.0
    per_tool_timeout_overrides: dict[str, float] = field(
        default_factory=lambda: {"fetch_url": 60.0}
    )
    loop_detection_threshold: int = 3        # 3번째부터 artificial warning 주입
    loop_detection_stop_threshold: int = 5   # 5번째 hard stop
    mode: Literal["auto", "any", "none"] = "auto"
    allowed_tool_names: Sequence[str] | None = None
    final_response_schema: type[BaseModel] | None = None
    cached_context_id: str | None = None
    budget_policy: BudgetPolicy = field(default_factory=NullBudgetPolicy)

@dataclass(frozen=True)
class CallKey:
    tool_name: str
    args_hash: str  # json canonical + sha256[:16]

@dataclass
class LoopState:
    messages: list[Any]    # provider-opaque
    turn_count: int = 0
    tool_call_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    call_history: list[CallKey] = field(default_factory=list)
    final_structured_output: dict | None = None
    termination_reason: str | None = None

@dataclass
class LoopResult:
    final_text: str | None
    final_structured_output: dict | None
    termination_reason: Literal[
        "model_stopped",
        "structured_submitted",
        "max_turns",
        "max_tool_calls",
        "max_input_tokens",
        "budget_exceeded",
        "loop_detected_hard",
        "cancelled",
        "provider_error",
    ]
    usage: UsageSummary
    trace: list[TurnTrace]  # opt-out 가능
```

### 5.2 루프 의사코드

```python
class ToolLoopExecutor:
    def __init__(
        self,
        provider: LLMProvider,
        tool_registry: ToolRegistry,
        config: LoopConfig,
        system_managed_values: dict[str, Any],   # {"workspace_id": "..."}
        hooks: LoopHooks | None = None,
    ): ...

    async def run(
        self,
        initial_messages: list[Any],
        tool_names: Sequence[str],
    ) -> LoopResult:
        state = LoopState(messages=list(initial_messages))
        await self._hooks.on_run_start(state)
        try:
            # Degenerate case: tool_names 비었어도 정상 동작
            # (G의 PLAIN 모드 지원)
            while True:
                if (r := self._check_hard_guards(state)):
                    return self._finalize(state, r)

                await self._hooks.on_turn_start(state)

                try:
                    turn = await self._provider.generate_with_tools(
                        messages=state.messages,
                        tools=self._declarations(tool_names),
                        mode=self._config.mode,
                        allowed_tool_names=self._config.allowed_tool_names,
                        final_response_schema=self._config.final_response_schema,
                        cached_context_id=self._config.cached_context_id,
                    )
                except ProviderRetryableError:
                    raise  # Temporal activity retry에 위임
                except ProviderFatalError as e:
                    return self._finalize(state, "provider_error", error=str(e))

                state.total_input_tokens += turn.usage.input_tokens
                state.total_output_tokens += turn.usage.output_tokens
                state.messages.append(turn.assistant_message)

                if not turn.tool_uses:
                    return self._finalize(
                        state, "model_stopped",
                        final_text=turn.final_text,
                        structured=turn.structured_output,
                    )

                # A: 순차 실행. C에서 isConcurrencySafe 분기 추가
                for tu in turn.tool_uses:
                    if (r := self._check_soft_guards(state, tu)):
                        return self._finalize(state, r)

                    tool_result = await self._execute_tool_with_timeout(tu)
                    state.messages.append(
                        self._provider.tool_result_to_message(tool_result)
                    )
                    state.tool_call_count += 1
                    state.call_history.append(CallKey(tu.name, tu.args_hash()))
                    await self._hooks.on_tool_end(state, tu, tool_result)

                    # emit_structured_output 성공 시 조기 종료
                    if (
                        tu.name == "emit_structured_output"
                        and isinstance(tool_result.data, dict)
                        and tool_result.data.get("accepted") is True
                    ):
                        state.final_structured_output = tool_result.data["validated"]
                        return self._finalize(state, "structured_submitted")

                state.turn_count += 1
        except asyncio.CancelledError:
            return self._finalize(state, "cancelled")
        finally:
            await self._hooks.on_run_end(state)
```

### 5.3 가드 체크

```python
def _check_hard_guards(self, state: LoopState) -> str | None:
    if state.turn_count >= self._config.max_turns:
        return "max_turns"
    if state.tool_call_count >= self._config.max_tool_calls:
        return "max_tool_calls"
    if state.total_input_tokens >= self._config.max_total_input_tokens:
        return "max_input_tokens"
    if self._config.budget_policy.should_stop(state):
        return "budget_exceeded"
    return None

def _check_soft_guards(self, state: LoopState, tool_use: ToolUse) -> str | None:
    key = CallKey(tool_use.name, tool_use.args_hash())
    repeat = state.call_history.count(key)
    if repeat >= self._config.loop_detection_stop_threshold - 1:
        return "loop_detected_hard"
    if repeat >= self._config.loop_detection_threshold - 1:
        self._inject_loop_warning(state, tool_use)
    return None
```

### 5.4 Tool 실행 (timeout + error mapping)

```python
async def _execute_tool_with_timeout(self, tool_use: ToolUse) -> ToolResult:
    timeout = self._config.per_tool_timeout_overrides.get(
        tool_use.name, self._config.per_tool_timeout_sec
    )
    # system_managed_args 강제 덮어쓰기 (C3 준수)
    args = {**tool_use.args, **self._system_managed_for(tool_use.name)}

    try:
        async with asyncio.timeout(timeout):
            raw = await self._tool_registry.execute(tool_use.name, args)
        data = self._truncate_if_needed(raw, tool_use.name)
        return ToolResult(
            tool_use_id=tool_use.id, name=tool_use.name,
            data=data, is_error=False,
        )
    except asyncio.TimeoutError:
        return ToolResult(
            tool_use_id=tool_use.id, name=tool_use.name,
            data={"error": f"Tool timed out after {timeout}s"},
            is_error=True,
        )
    except ToolValidationError as e:
        return ToolResult(
            tool_use_id=tool_use.id, name=tool_use.name,
            data={"error": f"Invalid input: {e}"},
            is_error=True,
        )
    except Exception as e:
        return ToolResult(
            tool_use_id=tool_use.id, name=tool_use.name,
            data={"error": f"{type(e).__name__}: {e}"},
            is_error=True,
        )
```

### 5.5 Observability hooks (A는 no-op)

```python
class LoopHooks(Protocol):
    async def on_run_start(self, state: LoopState) -> None: ...
    async def on_turn_start(self, state: LoopState) -> None: ...
    async def on_tool_start(self, state, tool_use: ToolUse) -> None: ...
    async def on_tool_end(self, state, tool_use: ToolUse, result: ToolResult) -> None: ...
    async def on_run_end(self, state: LoopState) -> None: ...

class NoopHooks: ...  # A default
```

E에서 `TelemetryHooks` 붙여 AI Usage Visibility spec과 연결.

### 5.6 Temporal 연동

- `run_tool_loop` activity가 `ToolLoopExecutor.run()` 호출
- Activity `start_to_close_timeout`: 10분 (configurable)
- Retry policy:
  - `ProviderRetryableError` (rate limit, 5xx, network) → 3회, 지수 백오프
  - `ProviderFatalError` (401, invalid input) → 재시도 X
  - Tool 내부 예외 → 재시도 X (이미 is_error=true로 모델에 전달)
- Workflow cancel → activity cancel → `asyncio.CancelledError` → `LoopResult(termination_reason="cancelled")` 정상 반환

---

## 6. `LLMProvider` 확장 — `generate_with_tools` 계약

### 6.1 중간 표현 (provider-neutral)

```python
# packages/llm/src/llm/tool_types.py (신규)

@dataclass(frozen=True)
class ToolUse:
    id: str                    # Gemini 3 function_call.id, 없으면 UUID 생성
    name: str
    args: dict[str, Any]
    thought_signature: bytes | None = None  # Gemini 3 전용

    def args_hash(self) -> str:
        return hashlib.sha256(
            json.dumps(self.args, sort_keys=True).encode()
        ).hexdigest()[:16]

@dataclass(frozen=True)
class ToolResult:
    tool_use_id: str
    name: str
    data: dict[str, Any] | str
    is_error: bool = False

@dataclass(frozen=True)
class UsageCounts:
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int = 0

@dataclass(frozen=True)
class AssistantTurn:
    final_text: str | None
    tool_uses: tuple[ToolUse, ...]
    assistant_message: Any  # provider-opaque, 다음 turn에 그대로 재주입
    structured_output: dict | None = None
    usage: UsageCounts
    stop_reason: str
```

**핵심 설계**: `assistant_message`는 **provider-opaque**. ToolLoopExecutor는 그대로 messages에 append. 이 원칙이 Gemini 3 thought signature 보존을 자동 보장 (docs 497-504 규칙).

### 6.2 Base class 계약

```python
# packages/llm/src/llm/base.py (확장)

class LLMProvider(ABC):
    # ... 기존 ...

    def supports_tool_calling(self) -> bool:
        return False

    def supports_parallel_tool_calling(self) -> bool:
        return False  # A 기본, C에서 Gemini → True

    async def generate_with_tools(
        self,
        messages: list[Any],
        tools: list[ToolDeclaration],
        *,
        mode: Literal["auto", "any", "none"] = "auto",
        allowed_tool_names: Sequence[str] | None = None,
        final_response_schema: type[BaseModel] | None = None,
        cached_context_id: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
    ) -> AssistantTurn:
        raise NotImplementedError(
            f"{type(self).__name__} does not implement generate_with_tools"
        )

    def tool_result_to_message(self, result: ToolResult) -> Any:
        raise NotImplementedError
```

### 6.3 GeminiProvider 구현 (핵심 스켈레톤)

```python
def supports_tool_calling(self) -> bool:
    return True

async def generate_with_tools(
    self,
    messages: list[types.Content],
    tools: list[ToolDeclaration],
    *,
    mode="auto",
    allowed_tool_names=None,
    final_response_schema=None,
    cached_context_id=None,
    temperature=None,
    max_output_tokens=None,
) -> AssistantTurn:
    fn_decls = build_gemini_declarations_from(tools)

    tool_config = types.ToolConfig(
        function_calling_config=types.FunctionCallingConfig(
            mode={"auto": "AUTO", "any": "ANY", "none": "NONE"}[mode],
            allowed_function_names=(
                list(allowed_tool_names) if allowed_tool_names else None
            ),
        )
    )

    config_kwargs = {
        "tools": [types.Tool(function_declarations=fn_decls)],
        "tool_config": tool_config,
        # CRITICAL: runtime이 루프 주인 → SDK auto loop 비활성
        "automatic_function_calling": types.AutomaticFunctionCallingConfig(disable=True),
    }
    if temperature is not None:
        config_kwargs["temperature"] = temperature
    if max_output_tokens is not None:
        config_kwargs["max_output_tokens"] = max_output_tokens
    if cached_context_id:
        config_kwargs["cached_content"] = cached_context_id
    if final_response_schema is not None:
        # Gemini 3 Preview: structured output + function calling
        config_kwargs["response_mime_type"] = "application/json"
        config_kwargs["response_schema"] = final_response_schema

    config = types.GenerateContentConfig(**config_kwargs)

    try:
        response = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=messages,
            config=config,
        )
    except google.api_core.exceptions.ResourceExhausted as e:
        raise ProviderRetryableError(str(e)) from e
    except google.api_core.exceptions.ServiceUnavailable as e:
        raise ProviderRetryableError(str(e)) from e
    except google.api_core.exceptions.InvalidArgument as e:
        raise ProviderFatalError(str(e)) from e

    candidate = response.candidates[0]
    assistant_content = candidate.content
    text_parts: list[str] = []
    tool_uses: list[ToolUse] = []

    # parts를 순회 (docs 1822-1825: "don't assume position")
    for part in assistant_content.parts:
        if fc := getattr(part, "function_call", None):
            tool_uses.append(ToolUse(
                id=fc.id or uuid.uuid4().hex,
                name=fc.name,
                args=dict(fc.args),
                thought_signature=getattr(part, "thought_signature", None),
            ))
        elif getattr(part, "text", None):
            text_parts.append(part.text)

    final_text = "\n".join(text_parts) if text_parts else None
    structured = None
    if final_response_schema is not None and final_text:
        try:
            structured = json.loads(final_text)
        except json.JSONDecodeError:
            pass  # 모델이 어긴 경우 — 다음 turn에서 복구 기회

    return AssistantTurn(
        final_text=final_text,
        tool_uses=tuple(tool_uses),
        assistant_message=assistant_content,  # opaque re-inject
        structured_output=structured,
        usage=UsageCounts(
            input_tokens=response.usage_metadata.prompt_token_count or 0,
            output_tokens=response.usage_metadata.candidates_token_count or 0,
            cached_input_tokens=getattr(
                response.usage_metadata, "cached_content_token_count", 0
            ) or 0,
        ),
        stop_reason=str(candidate.finish_reason or "STOP"),
    )

def tool_result_to_message(self, result: ToolResult) -> types.Content:
    return types.Content(
        role="user",
        parts=[types.Part(
            function_response=types.FunctionResponse(
                id=result.tool_use_id,   # Gemini 3 id 매핑 (docs 207-210)
                name=result.name,
                response=(
                    {"result": result.data} if not result.is_error
                    else {"error": result.data}
                ),
            )
        )]
    )
```

### 6.4 OllamaProvider stub

```python
def supports_tool_calling(self) -> bool:
    return False  # A: False. 추후 구현 시 True로

async def generate_with_tools(self, *args, **kwargs) -> AssistantTurn:
    raise ToolCallingNotSupported(
        "OllamaProvider.generate_with_tools is not implemented yet. "
        "Set LLM_PROVIDER=gemini or implement this method."
    )

def tool_result_to_message(self, result: ToolResult) -> Any:
    raise ToolCallingNotSupported(...)
```

`runtime.Agent.run_with_tools()`는 `provider.supports_tool_calling()` 체크 후 False면 즉시 명시적 에러.

### 6.5 Gemini 3 thought signature — 자동 보존

- Docs 497-504 규칙:
  - signature는 part 안에 두고 분리/병합 금지
  - function_response에는 원래 `function_call.id`를 **정확히** 매핑
  - signature 포함 part와 미포함 part를 merge 금지
- 본 설계는 `assistant_content`를 통째 opaque로 재주입 → 자동 보존
- 수동 manipulation은 C(compaction)에서 별도 설계

### 6.6 오류 매핑

```python
# packages/llm/src/llm/errors.py (신규)

class ProviderError(Exception): ...
class ProviderRetryableError(ProviderError): ...   # 429, 5xx, timeout
class ProviderFatalError(ProviderError): ...       # 401, 400, 413
class ToolCallingNotSupported(ProviderFatalError): ...
```

---

## 7. 테스트 · 관측 · 롤아웃

### 7.1 Unit tests

**`packages/llm/tests/test_gemini_tool_calling.py` (신규)**
- `build_gemini_declarations_from` — 6 tool schema 변환
- `generate_with_tools` (respx mock):
  - 순수 텍스트 응답 → `tool_uses=()`, `final_text` 채워짐
  - 단일 function_call → `tool_uses` 1개, id/name/args 정확
  - text + function_call 혼합 → 둘 다 반환
  - `MAX_TOKENS` stop_reason → 정상 반환
  - 429 → `ProviderRetryableError`
  - 401 → `ProviderFatalError`
  - `mode="any"` + `allowed_tool_names` → `tool_config` 정확 전달
  - `final_response_schema` 지정 → `response_mime_type`/`response_schema` 전달, JSON 파싱
  - `cached_context_id` → `cached_content` 필드 전달
- `tool_result_to_message` — `FunctionResponse.id` 매핑

**`apps/worker/tests/runtime/test_tool_loop.py` (신규)**
- 상태 머신 (fake provider):
  - Turn 1 tool_uses 없음 → `model_stopped`
  - Tool 실행 → 다음 turn에 재주입
  - `max_turns` / `max_tool_calls` / `max_input_tokens` 각각 경계
  - Loop detection: 3회 warning, 5회 hard stop
  - `per_tool_timeout` → `is_error=True`, 루프 계속
  - Tool 예외 → `is_error=True`, 루프 계속
  - `asyncio.CancelledError` → `cancelled`, partial state
  - `emit_structured_output` 성공 → `structured_submitted` 즉시 종료
  - `system_managed_args` 강제 덮어쓰기 (LLM이 가짜 workspace_id 반환 시)
- `args_hash`: dict 순서 불문 동일 hash

**`apps/worker/tests/runtime/test_tools_builtin.py` (신규)**
- 각 tool 단위:
  - `search_concepts` — hybrid_search mock, k/topic_id 필터
  - `search_pages` — synopsis/full 분기
  - `read_page` — truncation
  - `fetch_url` — SSRF (10.0.0.1, localhost, file://, 169.254.169.254, fe80::), 10MB 초과, DNS rebinding
  - `list_workspace_topics` — workspace_id 필수
  - `emit_structured_output` — schema 미등록 → error, 통과 → accepted
  - `get_concept_graph` — concept relations 테이블 없을 때 등록 안 됨 검증

### 7.2 Integration tests

**`apps/worker/tests/integration/test_tool_demo_agent.py` (신규)**
- Postgres + pgvector (`testcontainers`, Plan 4 Phase B에서 셋업 재사용)
- Gemini API 실호출 (`GEMINI_API_KEY_CI` CI secret 있을 때만 활성)
- 4 모드 시나리오:
  1. **Reference** (`.reference()`): 5 샘플 페이지 ingest 후 "주요 주제 요약?" → search_concepts 1-2회 → 답변. 평가: 실제 concept 이름 포함
  2. **Full** (`.full()`): "ROPE 찾아서 JSON 정리" → search_concepts → read_page → emit_structured_output → 종료. 평가: structured_output schema valid
  3. **Plain** (`.plain()`): "안녕하세요?" → 1 turn, tool 0
  4. **External** (`.external()`): "example.com 내용 요약" → fetch_url → emit_structured_output
- 비용 가드: 테스트당 $0.05 초과 시 fail

### 7.3 Security tests

**`apps/worker/tests/security/test_tool_isolation.py` (신규)**
- Workspace A agent가 Workspace B page_id 주입 → 결과 없음 (WHERE 필터)
- LLM이 `workspace_id: "other"` 반환 → caller 값으로 강제 덮어쓰기 확인 (DB 쿼리 관찰)
- `fetch_url` SSRF 완전성:
  - RFC1918 전 범위 (10/8, 172.16/12, 192.168/16)
  - Loopback (127/8)
  - AWS metadata (169.254.169.254)
  - IPv6 link-local (fe80::)
  - `file://`, `gopher://`, `ftp://`
  - DNS rebinding (domain → private IP)
- `emit_structured_output` schema 미등록 이름 거부

### 7.4 관측

- `NoopHooks` 기본. 5개 훅 전부 no-op async
- Structured logging 한 줄씩:
  - `turn.start` / `turn.end`
  - `tool.start` / `tool.end`
  - `loop.end`
- E가 이 log + hook에 telemetry pipeline 부착 (A는 손대지 않음)
- AI Usage Visibility spec 연동 지점은 hook 시그니처 TODO 주석

### 7.5 Failure modes

| 상황 | 경로 | 운영 결과 | 복구 |
|---|---|---|---|
| Gemini 429 / 5xx | Provider | `ProviderRetryableError` → Temporal retry 3회 | 자동 |
| 잘못된 API key (401) | Provider | `ProviderFatalError` → `provider_error` 종료 | env 수정 |
| Tool 내부 예외 | Tool | `is_error=True` tool_result, 루프 계속 | 모델이 회복 시도 |
| Tool timeout | Executor | 동일 | 동일 |
| SSRF URL | `fetch_url` | `is_error=True`, "blocked private address" | 모델이 다른 URL |
| Loop detection | Executor | 3회 warning, 5회 hard stop | 모델이 다른 tool |
| Context 초과 | Executor | `max_input_tokens` 종료 | caller 분할 |
| Cancel signal | Workflow | `cancelled`, partial state | 재시작 시 새 대화 |
| schema 미등록 | `emit_*` tool | `is_error=True` | 모델이 올바른 이름 재호출 |

### 7.6 문서 업데이트 (A 병합 시)

- `docs/architecture/api-contract.md` — Agent activity signature에 tool loop 경로 1문단 추가
- `docs/architecture/context-budget.md` — `search_pages`/`search_concepts` 경로별 토큰 예산 주석
- `docs/contributing/llm-antipatterns.md` — **Gemini tool calling § 신규**:
  - `response.text`만 읽고 function_call 버림
  - `automatic_function_calling` 기본 활성 — runtime 루프면 반드시 `disable=True`
  - `function_call.id` 누락 → Gemini 3 context 매핑 깨짐
  - messages part 단위 split → thought_signature 손실
  - Ollama tool calling 현재 미지원 — 체크 후 명시적 실패
- `CLAUDE.md` — 변경 없음

### 7.7 롤아웃

- **Phase 0**: Merge, feature flag 없음. 기존 `generate()`/`runtime.Agent` 불변
- **Phase 1** (A 완료 시점): `ToolDemoAgent`만 tool loop 사용
- **Phase 2** (B에서): Compiler → Research → Librarian 순차 retrofit
- **Breaking change 없음**

### 7.8 성능 기준선 (측정만, 최적화 금지)

- 한 turn Gemini 호출: flash < 5s, pro < 15s 목표
- Tool 실행: `search_concepts` < 500ms, `read_page` < 200ms, `fetch_url` < 60s
- Demo e2e: full-agent 3-turn < 30s
- A에선 베이스라인 기록, 임계치 초과 fail 없음 (E에서 SLO 제정)

### 7.9 코드 라인 예산

- `packages/llm` 확장: ~350 LOC
- `apps/worker/runtime/tool_loop.py`: ~450 LOC
- `apps/worker/runtime/tools_builtin/*`: ~500 LOC
- `apps/worker/agents/tool_demo_agent.py`: ~100 LOC
- 테스트: ~1000 LOC
- **총 신규 ~2400 LOC** (Plan 단계 ±20% 허용)

---

## 8. Open Questions for Plan Phase

Plan 단계(`writing-plans`)에서 구체화할 detail:

1. `ToolDeclaration` 타입 구조 — 기존 `runtime.tools.Tool` 직접 사용 vs 얇은 adapter
2. `SCHEMA_REGISTRY` 초기화 시점 (module import vs lazy)
3. `fetch_url` readability 라이브러리 선택 (`trafilatura` vs `readability-lxml`)
4. Concept relations 테이블 스키마 확정 (B 범위이나 `get_concept_graph`에 영향)
5. `LoopResult.trace` 포맷 — 디버깅 UI / E의 AI Usage Visibility와 schema align
6. Activity timeout 10분 값의 정당성 (실측 기반 조정)
7. DNS rebinding 방어 구현 방식 (custom transport vs pre-resolve)
8. Integration test의 Gemini 모델 선택 (`flash` vs `flash-lite`)
9. `_finalize()` 내부 시그니처 — `model_stopped` 경로에서 `final_response_schema` 기반 structured와 `emit_structured_output` 기반 structured를 구분하는 필드 이름 확정

---
