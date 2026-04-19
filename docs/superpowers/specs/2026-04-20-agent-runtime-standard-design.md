# Agent Runtime Standard — Design Spec

> **생성일**: 2026-04-20
> **상태**: Draft (brainstorm 완료, 사용자 리뷰 대기)
> **근거**: google/adk-python · anthropic/claude-code · langchain-ai/langgraph · pyturboquant 4개 레포 리버스엔지니어링 종합 (2026-04-20)
> **전제**: OpenCairn greenfield, 코드 0줄. 본 spec은 Plan 4 / Plan 7 / Plan 8 / Plan 4-Task0 구현 **이전에** 확정되어야 12 에이전트 전부 동일 계약으로 작성됨.

## Overview

OpenCairn 워커(`apps/worker`)가 호스팅하는 12개 AI 에이전트(Compiler, Research, Librarian, Socratic, Visualization, Code, Connector, Temporal, Synthesis, Curator, Narrator, Deep Research)가 공통으로 따르는 **런타임 표준**을 정의한다. 대상 범위:

1. Tool 인터페이스 (`@tool` 데코레이터, `supports_parallel`, provider별 schema 자동 생성)
2. Agent 출력 계약 (`AsyncGenerator[AgentEvent]`)
3. `AgentEvent` 9종 + payload 필드
4. Hook 3계층 (agent / model / tool) + 스코프 기반 등록
5. Token/비용 추적 훅 (PAYG 차감 연결)
6. Trajectory 저장 (Postgres 요약 + NDJSON 풀 로그)
7. Eval 프레임워크 (trajectory 매칭 메트릭 + pytest 러너)
8. Temporal 통합 규칙

**out-of-scope**:
- 개별 12 에이전트의 노드 로직 (Plan 4/5/6/7/8에서 각자)
- LLM provider 추가 (`docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md`)
- Agent chat scope UI (Plan 11A)

**추상화 철학**: **Thin facade over LangGraph / langchain-core**. 자체 클래스(`Agent`, `Tool`, `AgentHook`, `AgentEvent`)를 정의하되 내부는 LangGraph primitive를 감싼 수준. 12 에이전트가 LangGraph/langchain-core를 **직접 import 금지** (린트 강제), 오직 `from runtime import ...`.

**왜 facade?**
- Convention-only는 12 에이전트 12가지 변종으로 갈라짐 (팀 규율 강제 어려움)
- Parallel abstraction은 greenfield에서 오버엔지니어링. LangGraph 교체 현재 없음
- Facade가 균일성을 강제하면서도 LangGraph 기능을 잃지 않음

---

## § 1. 코드 위치

```
apps/worker/src/runtime/
  __init__.py                     # 공개 API
  tools.py                        # @tool 데코레이터, Tool 베이스, schema builder
  events.py                       # AgentEvent Pydantic 모델 (9종)
  hooks.py                        # AgentHook/ModelHook/ToolHook ABC + HookRegistry
  agent.py                        # Agent 베이스 (AsyncGenerator 계약)
  reducers.py                     # keep_last_n 등 커스텀 LangGraph 리듀서
  trajectory.py                   # TrajectoryWriter + 백엔드 어댑터
  temporal/
    __init__.py                   # make_thread_id, AgentAwaitingInputError
  eval/
    __init__.py
    case.py                       # EvalCase, ExpectedToolCall
    metrics.py                    # trajectory/handoff/cost 점수 계산
    runner.py                     # AgentEvaluator, pytest 통합

packages/shared/src/agent-events.ts   # 동일 스키마 Zod (API→웹 SSE용)
packages/db/src/schema/agent-runs.ts  # agent_runs 테이블
```

**패키지 분리 안 하는 이유**: 소비자는 `apps/worker` 단독. API/웹은 wire 포맷(Zod)만 필요. Python 패키지 분리 시 빌드/버전 관리 비용만 추가. 복수 Python 소비자가 생기면 그때 `packages/agent-runtime/`으로 뽑는다.

---

## § 2. Tool 인터페이스

### 정의

```python
# apps/worker/src/runtime/tools.py
from typing import Protocol, Callable, Any, Literal, Awaitable
from pydantic import BaseModel

class ToolContext(BaseModel):
    """런타임이 자동 주입. 툴 스키마에서 자동 제외됨 (타입 어노테이션으로 탐지)."""
    workspace_id: str
    project_id: str | None
    page_id: str | None
    user_id: str
    run_id: str
    scope: Literal["page", "project", "workspace"]
    emit: Callable[["AgentEvent"], Awaitable[None]]   # 커스텀 이벤트 발행용

class Tool(Protocol):
    name: str
    description: str
    supports_parallel: Callable[[dict], bool]
    async def run(self, args: dict, ctx: ToolContext) -> Any: ...
```

### `@tool` 데코레이터

```python
def tool(
    *,
    name: str | None = None,
    parallel: bool | Callable[[dict], bool] = False,
    redact_fields: tuple[str, ...] = (),
) -> Callable:
    """
    함수 시그니처 + docstring → Tool 자동 생성.
    - 파라미터 타입 → Pydantic input schema
    - ToolContext 타입 파라미터는 스키마에서 제외 (런타임 주입)
    - docstring 첫 문단 → description
    - redact_fields: trajectory 저장 시 [REDACTED] 처리
    - parallel: bool이면 정적, callable이면 (input_args) → bool
    """
```

**사용 예시**:

```python
from runtime import tool, ToolContext

@tool(parallel=lambda args: args.get("read_only", True))
async def search_pages(query: str, limit: int, ctx: ToolContext) -> list[dict]:
    """워크스페이스 내 페이지를 하이브리드 검색한다 (pgvector + BM25 + graph-hop RRF)."""
    return await rag.query(query, scope=ctx.scope, limit=limit)

@tool(redact_fields=("api_key",))
async def fetch_url(url: str, api_key: str, ctx: ToolContext) -> str:
    """외부 URL 내용을 가져온다."""
    ...
```

### Provider별 schema builder

```python
# runtime/tools.py 내부
def _build_gemini_declaration(tool: Tool) -> dict: ...
def _build_ollama_declaration(tool: Tool) -> dict: ...
```

단일 Tool 정의에서 Gemini FunctionDeclaration과 Ollama tool 포맷을 각각 생성. Provider는 `packages/llm`의 `LLMProvider`가 자기 포맷을 요청.

### 툴 레지스트리

```python
_REGISTRY: dict[str, Tool] = {}

def register(tool: Tool) -> None: ...   # @tool 데코레이터가 자동 호출

def get_tools_for_agent(
    agent_name: str,
    scope: Literal["page", "project", "workspace"],
) -> list[Tool]:
    """에이전트별 + 스코프별 필터링된 툴 목록. Coordinator system prompt 주입용."""
```

**Coordinator system prompt 주입** (claude-code 참조): `CompilerAgent`의 프롬프트 빌더가 `get_tools_for_agent("compiler", scope)`로 현재 사용 가능한 서브 에이전트/툴 카탈로그를 동적으로 구성해 system prompt에 삽입.

---

## § 3. AgentEvent 스키마

총 9종. `model_chunk`는 일부러 제외 — 스트리밍 토큰은 Hono SSE 채널로 별도 전달, trajectory에는 consolidated `ModelEnd`만 저장 (claude-code 패턴).

### BaseEvent

```python
class BaseEvent(BaseModel):
    run_id: str
    workspace_id: str
    agent_name: str
    seq: int                        # 0부터 증가, 전역 순서 보장
    ts: float                       # unix epoch (ms)
    parent_seq: int | None = None   # handoff 체인 추적용
```

### 타입별 payload

| 이벤트 | 발생 시점 | 주요 payload |
|---|---|---|
| `AgentStart` | 에이전트 실행 시작 | `scope`, `input`(redacted), `parent_run_id` |
| `AgentEnd` | 정상 종료 | `output`(redacted), `duration_ms` |
| `AgentError` | 예외 중단 | `error_class`, `message`(user-safe), `retryable` |
| `ModelEnd` | LLM 호출 완료 | `model_id`, `prompt_tokens`, `completion_tokens`, `cached_tokens`, `cost_krw`, `finish_reason`, `latency_ms` |
| `ToolUse` | 툴 호출 결정 | `tool_call_id`, `tool_name`, `input_args`, `input_hash`, `concurrency_safe` |
| `ToolResult` | 툴 실행 결과 | `tool_call_id`, `ok`, `output`, `duration_ms`, `cached` |
| `Handoff` | 서브에이전트 위임 | `from_agent`, `to_agent`, `child_run_id`, `scope`, `reason` |
| `AwaitingInput` | HITL 대기 | `interrupt_id`, `prompt`, `schema`(optional) |
| `CustomEvent` | 에이전트 임의 발행 | `label`, `payload` |

전체 정의는 `apps/worker/src/runtime/events.py` 구현 시 확정. `AgentEvent = Union[...]` 디스크리미네이터는 `type` 필드.

### 설계 포인트

- `seq`로 전역 순서 보장 → NDJSON 후처리 정렬 불필요
- `parent_seq` + `child_run_id`로 **handoff 트리 복원 가능** (eval에서 "Compiler → Research → Librarian" 체인 검증)
- `tool_call_id`로 `ToolUse` ↔ `ToolResult` 매칭 (병렬 실행 시 순서 보장 못해도 OK)
- `cost_krw` 필드는 **Plan 9 PAYG 차감의 단일 소스**. Ollama 호출은 0
- `input_hash`는 xxhash64. 동일 input 반복 호출 탐지 (runtime cache 적용 근거)

### Wire format

`packages/shared/src/agent-events.ts`에 동일 스키마 Zod. Python Pydantic ↔ TS Zod 일치 검증은 eval에서 round-trip 테스트 (Python에서 NDJSON 생성 → TS에서 파싱 성공 여부).

---

## § 4. Agent 베이스

```python
# apps/worker/src/runtime/agent.py
from abc import ABC, abstractmethod
from typing import AsyncGenerator

class Agent(ABC):
    name: str
    description: str

    @abstractmethod
    def run(
        self,
        input: dict,
        ctx: ToolContext,
    ) -> AsyncGenerator[AgentEvent, dict | None]:
        """
        에이전트 본체. AgentEvent를 yield.
        AwaitingInput을 yield한 경우 generator.send(response)로 재개.
        """
```

**모든 12 에이전트는 `Agent` 서브클래스**. 내부 구현은 LangGraph StateGraph지만 외부에는 숨긴다.

```python
class ResearchAgent(Agent):
    name = "research"
    description = "워크스페이스 내 페이지를 스코프 기반으로 검색/요약한다."

    async def run(self, input, ctx):
        graph = build_research_graph(ctx)
        async for ev in stream_graph_as_events(graph, input, ctx):
            yield ev
```

`stream_graph_as_events()`는 **LangGraph `astream_events()` → AgentEvent 어댑터**. 단일 구현으로 12번 재작성 방지. `on_llm_end` → `ModelEnd`, `on_tool_start/end` → `ToolUse/Result`, 커스텀 이벤트는 `CustomEvent`로 매핑.

---

## § 5. Hook 시스템

### 3계층 ABC

```python
# apps/worker/src/runtime/hooks.py

class AgentHook(ABC):
    async def before_agent(self, ctx: ToolContext, input: dict) -> dict | None: ...
    async def after_agent(self, ctx: ToolContext, output: dict) -> dict | None: ...

class ModelHook(ABC):
    async def before_model(self, ctx, request: ModelRequest) -> ModelRequest | None: ...
    async def after_model(self, ctx, response: ModelResponse) -> ModelResponse | None: ...
    async def on_model_error(self, ctx, error: Exception) -> ModelResponse | None: ...

class ToolHook(ABC):
    async def before_tool(self, ctx, tool_name: str, args: dict) -> dict | None: ...
    async def after_tool(self, ctx, tool_name: str, result: Any) -> Any | None: ...
    async def on_tool_error(self, ctx, tool_name: str, error: Exception) -> Any | None: ...
```

### 단락(short-circuit) 시맨틱

- 훅이 `None` 반환 → 다음 훅으로 통과
- 훅이 **non-None** 반환 → 이후 훅 스킵 + 그 값이 결과로 사용됨
- `before_*`에서 non-None → 실제 실행 스킵 (승인 거부, 캐시 hit 등)
- `after_*`에서 non-None → 결과 변형 (redaction, 포맷 변환)

### 스코프 기반 등록

```python
class HookRegistry:
    def register(
        self,
        hook: AgentHook | ModelHook | ToolHook,
        *,
        scope: Literal["global", "agent", "run"],
        agent_filter: list[str] | None = None,   # scope="agent"일 때
    ) -> None: ...

    def resolve(self, ctx: ToolContext) -> HookChain:
        """실행 시점에 global → agent → run 순으로 체인 구성."""
```

| 스코프 | 수명 | 용도 |
|---|---|---|
| `global` | 워커 프로세스 전체 | TokenCounterHook, TrajectoryWriterHook, SentryHook, LatencyHook |
| `agent` | 특정 에이전트 타입 | ResearchRateLimitHook, CodeSandboxGuardHook |
| `run` | 해당 `run_id`만 | 디버그 trace, 요청별 redaction 강화 |

**실행 순서(양파)**: `global before → agent before → run before → [실제 실행] → run after → agent after → global after`

### 기본 탑재 global 훅

1. **`TrajectoryWriterHook`** — 모든 이벤트를 버퍼에 쓰고, `AgentEnd`/`AgentError`에서 flush + Postgres 요약 insert
2. **`TokenCounterHook`** — `ModelEnd`의 `cost_krw`를 `workspace_credits`에서 차감 (Plan 9)
3. **`SentryHook`** — `AgentError`/`ToolError`를 Sentry로. DSN 없으면 no-op (self-host)
4. **`LatencyHook`** — `before/after_*` 시간차 → OpenTelemetry span

### LangGraph 내장 callback과의 중복 방지

**OpenCairn 훅이 상위 레이어**. 내부적으로 단일 `LangGraphBridgeCallback` 하나만 LangGraph에 attach하고, 그 callback이 `on_llm_end`/`on_tool_end` 이벤트를 OpenCairn HookChain에 위임한다. **12 에이전트 각자 `BaseCallbackHandler` 직접 등록 금지** (린트 규칙).

---

## § 6. Trajectory 저장

### 두 층 분리

**요약 (Postgres `agent_runs`)** — 운영 쿼리, 크레딧 차감, UI 노출용

```sql
CREATE TABLE agent_runs (
    run_id            UUID PRIMARY KEY,
    workspace_id      UUID NOT NULL REFERENCES workspaces(id),
    project_id        UUID REFERENCES projects(id),
    page_id           UUID REFERENCES pages(id),
    user_id           UUID NOT NULL REFERENCES users(id),
    agent_name        TEXT NOT NULL,
    parent_run_id     UUID REFERENCES agent_runs(run_id),   -- handoff 트리
    workflow_id       TEXT NOT NULL,                         -- Temporal workflow_id

    status            TEXT NOT NULL,   -- 'running' | 'completed' | 'failed' | 'awaiting_input'
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at          TIMESTAMPTZ,
    duration_ms       INT,

    total_tokens_in   INT NOT NULL DEFAULT 0,
    total_tokens_out  INT NOT NULL DEFAULT 0,
    total_tokens_cached INT NOT NULL DEFAULT 0,
    total_cost_krw    INT NOT NULL DEFAULT 0,
    tool_call_count   INT NOT NULL DEFAULT 0,
    model_call_count  INT NOT NULL DEFAULT 0,

    error_class       TEXT,
    error_message     TEXT,

    trajectory_uri    TEXT NOT NULL,    -- 's3://...' 또는 'file:///...'
    trajectory_bytes  INT NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_runs_workspace_status ON agent_runs (workspace_id, status, started_at DESC);
CREATE INDEX idx_agent_runs_parent ON agent_runs (parent_run_id) WHERE parent_run_id IS NOT NULL;
CREATE INDEX idx_agent_runs_workflow ON agent_runs (workflow_id);
```

**풀 trajectory (NDJSON)** — eval, 디버깅, 재생

- 경로: `{backend}/{workspace_id}/{YYYY-MM-DD}/{run_id}.ndjson`
- 내용: 한 줄에 하나의 `AgentEvent` (`model_dump_json()`)
- 권한: `workspace_id` prefix 격리. 호스팅은 signed URL, self-host는 워크스페이스 멤버십 체크

### 스토리지 어댑터

```python
class TrajectoryStorage(Protocol):
    async def open_writer(self, run_id: str, workspace_id: str) -> "TrajectoryWriter": ...
    async def read_trajectory(self, uri: str) -> AsyncIterator[AgentEvent]: ...

class S3TrajectoryStorage(TrajectoryStorage):
    """MinIO / AWS S3. 호스티드 기본."""

class LocalFSTrajectoryStorage(TrajectoryStorage):
    """Self-host 기본. Docker volume 마운트.
    원자적 쓰기: write to .tmp → rename.
    """
```

**Self-host 디폴트**: `TRAJECTORY_BACKEND=local` + `TRAJECTORY_DIR=/var/lib/opencairn/trajectories` (Docker volume). MinIO는 **명시적 opt-in**.

### 환경변수

```
TRAJECTORY_BACKEND=local|s3
TRAJECTORY_DIR=/var/lib/opencairn/trajectories
S3_ENDPOINT=
S3_BUCKET=opencairn-trajectories
S3_ACCESS_KEY=
S3_SECRET_KEY=
TRAJECTORY_RETENTION_DAYS=30
```

### 쓰기 전략

```python
class TrajectoryWriter:
    """메모리 버퍼. AgentEnd/Error 또는 매 50 이벤트마다 flush."""

    async def emit(self, event: AgentEvent) -> None:
        self._buffer.append(event)
        if len(self._buffer) >= 50 or isinstance(event, (AgentEnd, AgentError)):
            await self._flush()
```

**장애 시맨틱**: flush 실패는 **최소 한 번 재시도** → 계속 실패하면 워커 로그로만 남기고 에이전트 실행은 정상 완료 처리. **Trajectory 손실이 에이전트 실패보다 낫다** — 사용자에게 이미 응답한 것을 롤백하지 않는다.

### 권한 경계 (호스팅)

- API가 signed URL 발급: `canRead(workspace_id, user_id)` 통과 시 5분 유효 presigned GET
- 웹: `/api/runs/:runId/trajectory` → API가 signed URL 프록시 또는 redirect
- Self-host: `workspace_members` 체크 후 디스크에서 스트리밍

### 리텐션 & GDPR

- NDJSON: 30일 후 자동 삭제 (cron)
- `agent_runs` 요약: 1년
- 유저 계정 삭제 (Plan 9 Export/Delete) 시 `user_id`의 모든 runs CASCADE
- `workspaces` 삭제 시 prefix bulk delete

---

## § 7. Eval 프레임워크

### 데이터 모델

```python
# runtime/eval/case.py
class ExpectedToolCall(BaseModel):
    tool_name: str
    args_match: dict | None = None       # 부분 매칭
    args_ignore: list[str] = []          # 동적 값 무시
    required: bool = True

class ExpectedHandoff(BaseModel):
    to_agent: str
    required: bool = True

class EvalCase(BaseModel):
    id: str
    description: str
    agent: str
    scope: Literal["page", "project", "workspace"]

    input: dict
    fixture: str | None = None           # tests/fixtures/{fixture}.sql

    expected_tools: list[ExpectedToolCall] = []
    expected_handoffs: list[ExpectedHandoff] = []
    forbidden_tools: list[str] = []

    response_contains: list[str] = []
    response_match_llm: str | None = None   # LLM judge (optional, 유료)

    max_duration_ms: int = 60_000
    max_cost_krw: int = 1000
    max_tool_calls: int = 20
```

### 메트릭

```python
DEFAULT_CRITERIA = {
    "tool_trajectory_score": 1.0,    # 기대 툴 호출 매칭률
    "forbidden_tool_score": 1.0,     # 금지 툴 미호출
    "handoff_score": 1.0,
    "response_contains_score": 0.8,
    "cost_within_budget": 1.0,
    "duration_within_budget": 1.0,
}

OPTIONAL_CRITERIA = {
    "response_match_llm": 0.7,       # Gemini judge, 비용 듦
}
```

**LLM judge는 `@eval.slow` 마커로 nightly만 실행**. 매 PR 실행 금지.

### 러너

```python
import pytest
from runtime.eval import AgentEvaluator, load_cases

@pytest.mark.asyncio
@pytest.mark.parametrize("case", load_cases("eval/research/"))
async def test_research_trajectory(case):
    result = await AgentEvaluator.run(case)
    result.assert_passed(criteria=DEFAULT_CRITERIA)
```

### 케이스 파일

```
apps/worker/eval/
  research/
    basic_page_search.yaml
    handoff_to_librarian.yaml
    out_of_scope_refusal.yaml
  compiler/
    route_research_vs_librarian.yaml
  ...
```

```yaml
# 예시
id: research-001
description: Page 스코프 기본 검색은 handoff 없이 자체 처리
agent: research
scope: page
fixture: fixtures/sample_workspace.sql
input:
  query: "프로젝트에서 쓰인 알고리즘 정리해줘"
  page_id: "page-abc"
expected_tools:
  - tool_name: search_pages
    args_match: { scope: "page" }
forbidden_tools:
  - fetch_url
  - call_librarian
response_contains:
  - "알고리즘"
max_cost_krw: 200
```

### 실행 모드

1. **Unit eval (mock LLM)** — `runtime/eval/mocks.py`로 응답 고정. Trajectory만 검증. **CI every PR**
2. **Integration eval (real LLM, fixture DB)** — 실제 Gemini 호출. `pytest -m eval_integration`. 수동/nightly
3. **Replay eval** — 기존 `agent_runs` NDJSON을 입력으로, 모델 업그레이드 회귀 검증

### CLI

```bash
cd apps/worker && uv run eval run research/basic_page_search
cd apps/worker && uv run eval run --all --mock
cd apps/worker && uv run eval replay --since 2026-04-15 --agent research
```

### 리포트

- Pass/fail 테이블 + 메트릭 점수
- 실패 케이스 diff view (기대 vs 실제 trajectory)
- LLM judge 결과 raw 응답 포함
- HTML 리포트 `/tmp/opencairn-eval-report.html` → CI artifact 업로드

### 케이스 수집 전략

- **콜드 스타트**: Plan 4 구현 전 수동 20-30 케이스 (12 에이전트 × 2-3 시나리오)
- **이후**: 프로덕션 `agent_runs` 중 유저 👍/👎 런을 PII redaction 후 골든 데이터셋화

---

## § 8. Temporal 통합 규칙

### 핵심 원칙

**LangGraph가 state 소유 + Temporal이 retry/SLA 소유**. Checkpoint는 Postgres 한 곳에만.

### `thread_id` ↔ `workflow_id`

```python
def make_thread_id(workflow_id: str, agent_name: str, parent_run_id: str | None) -> str:
    """
    - 단독 실행:  "{workflow_id}:{agent_name}"
    - 서브에이전트: "{parent_run_id}:{agent_name}"
    """
    if parent_run_id:
        return f"{parent_run_id}:{agent_name}"
    return f"{workflow_id}:{agent_name}"
```

**규칙**:
1. 하나의 `thread_id`는 동시에 **하나의 activity만** 사용 (LangGraph checkpoint race 방지)
2. Temporal retry 시 같은 `thread_id` 재사용 → LangGraph가 마지막 checkpoint에서 재개
3. Handoff는 **Temporal child workflow**로 분리. 자식 `thread_id`는 부모의 `parent_run_id` 기반

### Checkpoint

```python
checkpointer = PostgresSaver.from_conn_string(
    os.environ["DATABASE_URL"],
    schema="langgraph_checkpoints",
)
graph = state_graph.compile(checkpointer=checkpointer, durability="async")
```

**`durability="async"`**: 성능↑, 장애 시 마지막 1 step 유실 가능. 에이전트 재실행 idempotent 전제로 수용.

### Activity 경계 규칙

```python
@activity.defn
async def run_agent_activity(agent_name: str, input: dict, ctx: ToolContextDict) -> AgentRunResult:
    agent = get_agent(agent_name)
    runtime_ctx = ToolContext.model_validate(ctx)

    try:
        async for event in agent.run(input, runtime_ctx):
            await trajectory.emit(event)

            if isinstance(event, AwaitingInput):
                raise AgentAwaitingInputError(
                    interrupt_id=event.interrupt_id,
                    prompt=event.prompt,
                )
        return AgentRunResult(status="completed")

    except AgentAwaitingInputError:
        raise
    except Exception:
        await trajectory.emit_error(...)
        raise
```

**금지**:
- ❌ `interrupt()` 호출 across activity 경계 → Temporal signal로 대체
- ❌ 같은 `thread_id`로 두 activity 동시 실행
- ❌ activity 안에서 자식 에이전트 직접 실행 → child workflow 사용

### Workflow 레이어 (HITL)

```python
@workflow.defn
class AgentWorkflow:
    @workflow.run
    async def run(self, req: AgentRequest) -> dict:
        while True:
            try:
                return await workflow.execute_activity(
                    run_agent_activity,
                    args=[req.agent_name, req.input, req.ctx],
                    start_to_close_timeout=timedelta(minutes=5),
                    retry_policy=RetryPolicy(
                        maximum_attempts=3,
                        non_retryable_error_types=["AgentAwaitingInputError"],
                    ),
                )
            except AgentAwaitingInputError as e:
                await workflow.wait_condition(
                    lambda: self._pending_inputs.get(e.interrupt_id) is not None,
                    timeout=timedelta(hours=24),
                )
                req.input["_resume"] = {e.interrupt_id: self._pending_inputs[e.interrupt_id]}

    @workflow.signal
    async def provide_input(self, interrupt_id: str, response: dict) -> None:
        self._pending_inputs[interrupt_id] = response
```

### Channel mutation 금지 (린트)

```python
# ❌ 금지
def node(state):
    state["messages"].append(msg)
    return {}

# ✅ 강제
def node(state):
    return {"messages": [msg]}
```

완벽 탐지 어려우므로 `docs/contributing/llm-antipatterns.md`에 명시 + 코드리뷰 체크.

### Checkpoint pruning

```python
@activity.defn
async def prune_old_checkpoints() -> int:
    """
    완료된 workflow의 checkpoint 삭제. Cron: 매일 02:00 KST.
    조건: agent_runs.status IN ('completed','failed') AND ended_at < now() - 7 days
    """
```

**보관 기간**:
- LangGraph checkpoint: 7일
- Temporal workflow history: 30일 (기본)
- Trajectory NDJSON: 30일
- `agent_runs` 요약: 1년

### Messages 누적 방지

```python
from runtime.reducers import keep_last_n

class AgentState(TypedDict):
    # ❌ messages: Annotated[list, operator.add]   # 무한 누적
    messages: Annotated[list, keep_last_n(50)]
```

커스텀 리듀서 `keep_last_n`은 `runtime/reducers.py`에 정의. 12 에이전트 전부 사용 강제.

---

## § 9. Public API

`apps/worker/src/runtime/__init__.py`에서 export (12 에이전트가 import할 표면):

```python
# 계약
from runtime import Agent, Tool, ToolContext, AgentEvent

# 이벤트
from runtime.events import (
    AgentStart, AgentEnd, AgentError,
    ModelEnd, ToolUse, ToolResult,
    Handoff, AwaitingInput, CustomEvent,
)

# 데코레이터 & 레지스트리
from runtime import tool, get_tools_for_agent

# 훅
from runtime.hooks import AgentHook, ModelHook, ToolHook, HookRegistry

# 리듀서
from runtime.reducers import keep_last_n

# Temporal 헬퍼
from runtime.temporal import make_thread_id, AgentAwaitingInputError

# Eval
from runtime.eval import EvalCase, AgentEvaluator, DEFAULT_CRITERIA
```

**린트 규칙**: `apps/worker/src/worker/agents/**/*.py`는 `langgraph`, `langchain_core`, `langchain` 직접 import 금지. 오직 `from runtime import ...`.

---

## § 10. 기존 plan 영향도

이 spec은 **Plan 4 착수 전**에 구현되어야 한다. 구체 변경안:

| Plan | 영향 | 수정 유형 |
|---|---|---|
| `2026-04-13-multi-llm-provider.md` | `LLMProvider` 인터페이스에 tool declaration 메서드 추가 (`build_tool_declarations(tools: list[Tool]) -> list[dict]`) | 기존 plan 수정 |
| `2026-04-09-plan-1-foundation.md` | `packages/db`에 `agent_runs` 테이블 스키마 추가 | 기존 plan 수정 |
| `2026-04-09-plan-4-agent-core.md` | Task 0에 "runtime facade prerequisite 검증" 추가. Task 5/6/7의 Compiler/Research/Librarian 구현이 `Agent` 서브클래스 패턴을 따르도록 전면 재작성 | 기존 plan 수정 |
| `2026-04-09-plan-7-canvas-sandbox.md` | Code agent가 runtime facade 기반 (`@tool`, `AwaitingInput` 승인 플로우) | 기존 plan 수정 |
| `2026-04-09-plan-8-remaining-agents.md` | 6개 에이전트 전부 `Agent` 서브클래스로 | 기존 plan 수정 |
| `2026-04-09-plan-9-billing-marketing.md` | PAYG 차감 훅이 `agent_runs.total_cost_krw` + `TokenCounterHook` 기반 | 기존 plan 수정 |
| `docs/contributing/llm-antipatterns.md` | Channel mutation 금지, 직접 langchain import 금지 추가 | 문서 |
| `docs/architecture/backup-strategy.md` | Checkpoint/trajectory retention 정책 | 문서 |

**구현 순서**:
1. 이 spec 기반 implementation plan 작성 — 새 plan (`2026-04-20-plan-12-agent-runtime.md` 가칭). Plan 4보다 먼저 실행
2. 해당 plan 실행 → `apps/worker/src/runtime/` 골격 + `agent_runs` 테이블 + eval 러너 완성
3. Plan 4 진입 (Task 0에서 runtime prerequisite 검증)
4. Plan 5/6/7/8의 나머지 9개 에이전트는 같은 runtime 위에서 작성

---

## § 11. 결정 요약

| 결정 | 선택 | 근거 |
|---|---|---|
| 추상화 두께 | Thin facade over LangGraph | 균일성 강제 vs 유지보수 비용 균형 |
| 이벤트 타입 수 | 9종 (model_chunk 제외) | Trajectory 크기 제어 |
| Trajectory 저장 | Hybrid (Postgres 요약 + NDJSON 풀) | 운영 쿼리 + eval 양쪽 충족 |
| Self-host 기본 | LocalFS | MinIO 강제 안 함 |
| Temporal 역할 | Retry/SLA만, state는 LangGraph | 더블 durability 방지 |
| HITL | Temporal signal, LangGraph interrupt 아님 | Activity 경계 안전성 |
| Messages 누적 | `keep_last_n(50)` 강제 | Context 비대화 방지 |
| LLM judge eval | Nightly만 | 비용 제어 |
| Trajectory 보관 | 30일 (NDJSON) / 1년 (요약) | GDPR + 운영 균형 |

---

## 참고

- `docs/superpowers/specs/2026-04-09-opencairn-design.md` — 전체 아키텍처
- `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md` — LLM provider 추상화
- `docs/superpowers/specs/2026-04-20-agent-chat-scope-design.md` — Chat scope (Plan 11A)
- `docs/agents/temporal-workflows.md` — Temporal workflow 카탈로그
- `docs/agents/context-management.md` — Gemini 캐싱/RAG
- `docs/architecture/billing-model.md` — PAYG 크레딧

## 리버스엔지니어링 출처

- **google/adk-python** — `@tool` 데코레이터 자동 선언, trajectory-based eval 스키마, 계층적 콜백 훅
- **anthropic/claude-code** — Async generator 스트리밍, `isConcurrencySafe(input)` 동적 판단, coordinator system prompt 주입
- **langchain-ai/langgraph** — Pregel superstep 모델, checkpoint schema, thread_id 시맨틱
- **pyturboquant** — lazy `__getattr__` optional import 패턴 (별도 적용 예정)
