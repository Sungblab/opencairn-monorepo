# Agent Runtime v2 · Sub-project A — Core Tool-Use Loop · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker에 provider-agnostic tool-calling loop를 도입한다. Gemini가 function_call을 반환하면 런타임이 파싱 → tool 실행 → 결과 재주입의 루프를 돌린다. 기존 에이전트 3개(Compiler/Research/Librarian)는 건드리지 않고, 새 `ToolDemoAgent`만 이 loop를 사용해 4가지 채팅 모드(plain/reference/external/full)를 시연한다.

**Architecture:** `ToolLoopExecutor` (runtime)가 루프 주인. Gemini SDK의 automatic function calling을 **명시적으로 disable**하고 runtime이 parts를 iterate하여 `AssistantTurn`을 생성. 한 Temporal activity = 한 loop 전체. 기존 `ToolContext` 주입 패턴을 재사용해 workspace/project 격리 강제.

**Tech Stack:** Python 3.12 · `google-genai >=1.0.0` · `httpx` · Pydantic v2 · pytest + pytest-asyncio + respx · Temporal (기존 활성) · Hono 4 + Drizzle (apps/api 최소 추가)

**Spec:** [`2026-04-22-agent-runtime-v2a-core-tool-loop-design.md`](../specs/2026-04-22-agent-runtime-v2a-core-tool-loop-design.md)
**Umbrella:** [`2026-04-22-agent-runtime-v2-umbrella.md`](../specs/2026-04-22-agent-runtime-v2-umbrella.md)

---

## Spec Reconciliation (Plan 단계에서 결정)

구현 중 spec과 코드베이스 현실 사이에 드러난 차이점:

1. **`system_managed_args` 개념** → 기존 `runtime.tools.ToolContext` 주입 패턴으로 대체. Tool 함수 시그니처에 `ctx: ToolContext`가 있으면 자동으로 LLM schema에서 제외되고 runtime이 주입. 신규 메타 필드 불필요.
2. **"page" 용어** → 코드베이스는 "note" 사용. 내부 구현은 `note_id` / `api_client.hybrid_search_notes` 등으로. Tool 이름은 코드베이스 일관성 위해 `search_notes` / `read_note`로 변경.
3. **Workspace 격리**: `ctx.workspace_id` + `ctx.project_id`가 이미 activity 진입 시점에 검증됨. Tool은 이 값을 그대로 쓰면 자동으로 격리.
4. **Topic 탐색**: 기존 내부 API에 "topics" 엔드포인트 없음 → apps/api에 단일 엔드포인트 추가 (Task 15). 방식: 한 project의 concept 중 link 수 기준 top-30 aggregation.
5. **`get_concept_graph`**: concept_edges 테이블은 존재 (upsert_edge API 확인됨). 하지만 "concept neighbors 조회" 엔드포인트 없음. A에선 **등록 안 함**. B에서 endpoint + tool 동시 작성.
6. **Hash util**: spec의 SHA256 대신 기존 `runtime.tools.hash_input(args)` (xxhash 기반) 재사용.

최종 A에 포함되는 tool: **5개**
1. `search_concepts` (via `api_client.search_concepts`)
2. `search_notes` (via `api_client.hybrid_search_notes`)
3. `read_note` (via `api_client.get_note`)
4. `fetch_url` (self-contained)
5. `emit_structured_output` (self-contained, schema_registry)
6. `list_project_topics` (신규 API endpoint + tool)

`get_concept_graph`는 B로 이동.

---

## File Structure Overview

```
packages/llm/src/llm/
├── base.py                  # MODIFY: + generate_with_tools, supports_*, tool_result_to_message
├── gemini.py                # MODIFY: + generate_with_tools, + tool_result_to_message
├── ollama.py                # MODIFY: + stub raise
├── tool_types.py            # CREATE
└── errors.py                # CREATE

apps/worker/src/runtime/
├── tool_loop.py             # CREATE: ToolLoopExecutor + dataclasses
├── tools.py                 # (기존, 건드리지 않음 — ToolContext 재사용)
└── agent.py                 # MODIFY: + run_with_tools()

apps/worker/src/worker/tools_builtin/
├── __init__.py              # CREATE: BUILTIN_TOOLS
├── schema_registry.py       # CREATE
├── emit_structured_output.py # CREATE
├── fetch_url.py             # CREATE
├── list_project_topics.py   # CREATE
├── search_concepts.py       # CREATE
├── search_notes.py          # CREATE
└── read_note.py             # CREATE

apps/worker/src/worker/agents/
└── tool_demo/               # CREATE
    ├── __init__.py
    └── agent.py             # ToolDemoAgent.plain/.reference/.external/.full

apps/worker/src/worker/lib/
└── api_client.py            # MODIFY: + list_project_topics

apps/api/src/routes/
└── internal.ts              # MODIFY: + GET /api/internal/projects/:id/topics

packages/llm/tests/
└── test_gemini_tool_calling.py  # CREATE
└── test_tool_types.py           # CREATE

apps/worker/tests/
├── runtime/
│   └── test_tool_loop.py             # CREATE
├── tools_builtin/
│   ├── test_fetch_url.py             # CREATE
│   ├── test_emit_structured.py       # CREATE
│   └── test_retrieval_tools.py       # CREATE
├── agents/
│   └── test_tool_demo_agent.py       # CREATE (integration, gated)
└── security/
    └── test_tool_isolation.py        # CREATE

docs/architecture/
├── api-contract.md          # MODIFY
└── context-budget.md        # MODIFY
docs/contributing/
└── llm-antipatterns.md      # MODIFY

docs/superpowers/specs/
└── 2026-04-22-agent-runtime-v2-umbrella.md  # MODIFY: mark A done
```

---

## Phase 1 — Foundation Types (Tasks 1-3)

### Task 1: `tool_types.py` — Provider-neutral IR

**Files:**
- Create: `packages/llm/src/llm/tool_types.py`
- Test: `packages/llm/tests/test_tool_types.py`

- [ ] **Step 1: Write failing tests**

Create `packages/llm/tests/test_tool_types.py`:

```python
from __future__ import annotations

import pytest

from llm.tool_types import (
    AssistantTurn,
    ToolResult,
    ToolUse,
    UsageCounts,
)


def test_tooluse_args_hash_stable_across_key_order():
    a = ToolUse(id="t1", name="foo", args={"x": 1, "y": 2})
    b = ToolUse(id="t1", name="foo", args={"y": 2, "x": 1})
    assert a.args_hash() == b.args_hash()


def test_tooluse_args_hash_differs_for_different_args():
    a = ToolUse(id="t1", name="foo", args={"x": 1})
    b = ToolUse(id="t1", name="foo", args={"x": 2})
    assert a.args_hash() != b.args_hash()


def test_tooluse_thought_signature_optional():
    tu = ToolUse(id="t1", name="foo", args={})
    assert tu.thought_signature is None


def test_tool_result_defaults():
    r = ToolResult(tool_use_id="t1", name="foo", data={"ok": True})
    assert r.is_error is False


def test_assistant_turn_empty_tool_uses():
    turn = AssistantTurn(
        final_text="hello",
        tool_uses=(),
        assistant_message={"raw": "opaque"},
        usage=UsageCounts(input_tokens=10, output_tokens=5),
        stop_reason="STOP",
    )
    assert turn.final_text == "hello"
    assert turn.tool_uses == ()
    assert turn.structured_output is None


def test_assistant_turn_frozen():
    turn = AssistantTurn(
        final_text=None, tool_uses=(), assistant_message=None,
        usage=UsageCounts(0, 0), stop_reason="STOP",
    )
    with pytest.raises(Exception):
        turn.final_text = "mutated"  # type: ignore[misc]
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd packages/llm && pytest tests/test_tool_types.py -v
```

Expected: `ModuleNotFoundError: No module named 'llm.tool_types'`

- [ ] **Step 3: Implement `tool_types.py`**

Create `packages/llm/src/llm/tool_types.py`:

```python
"""Provider-neutral intermediate representation for tool calling.

The `ToolLoopExecutor` depends only on these types; each `LLMProvider`
translates its native format to/from these shapes. `assistant_message`
is intentionally opaque so provider-specific metadata (Gemini 3 thought
signatures, Anthropic cache_control, etc.) pass through the loop
unchanged when re-injected as conversation history.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolUse:
    id: str
    name: str
    args: dict[str, Any]
    thought_signature: bytes | None = None

    def args_hash(self) -> str:
        canonical = json.dumps(self.args, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]


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
    assistant_message: Any
    usage: UsageCounts
    stop_reason: str
    structured_output: dict | None = None
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd packages/llm && pytest tests/test_tool_types.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/tool_types.py packages/llm/tests/test_tool_types.py
git commit -m "feat(llm): add provider-neutral tool-use IR types"
```

---

### Task 2: `errors.py` — Provider error hierarchy

**Files:**
- Create: `packages/llm/src/llm/errors.py`
- Test: `packages/llm/tests/test_errors.py`

- [ ] **Step 1: Write failing tests**

Create `packages/llm/tests/test_errors.py`:

```python
from __future__ import annotations

import pytest

from llm.errors import (
    ProviderError,
    ProviderFatalError,
    ProviderRetryableError,
    ToolCallingNotSupported,
)


def test_hierarchy():
    assert issubclass(ProviderRetryableError, ProviderError)
    assert issubclass(ProviderFatalError, ProviderError)
    assert issubclass(ToolCallingNotSupported, ProviderFatalError)


def test_retryable_vs_fatal_are_distinct():
    with pytest.raises(ProviderRetryableError):
        raise ProviderRetryableError("rate limit")

    with pytest.raises(ProviderFatalError):
        raise ProviderFatalError("unauthorized")


def test_tool_not_supported_is_fatal():
    with pytest.raises(ProviderFatalError):
        raise ToolCallingNotSupported("ollama stub")
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd packages/llm && pytest tests/test_errors.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

Create `packages/llm/src/llm/errors.py`:

```python
"""Provider error taxonomy for tool-calling runtime.

`ToolLoopExecutor` differentiates `ProviderRetryableError` (propagate to
Temporal retry) vs `ProviderFatalError` (terminate loop with
`provider_error` reason). Providers raise these from their
`generate_with_tools` implementations.
"""
from __future__ import annotations


class ProviderError(Exception):
    """Base for all provider-layer errors."""


class ProviderRetryableError(ProviderError):
    """429, 5xx, network timeout — Temporal activity retry is safe."""


class ProviderFatalError(ProviderError):
    """401, 400, 413 — retry will not help; terminate loop."""


class ToolCallingNotSupported(ProviderFatalError):
    """Provider does not implement tool calling. Set LLM_PROVIDER to one
    that does (e.g. gemini) or implement the method."""
```

- [ ] **Step 4: Run tests**

```bash
cd packages/llm && pytest tests/test_errors.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/errors.py packages/llm/tests/test_errors.py
git commit -m "feat(llm): add provider error taxonomy"
```

---

### Task 3: Extend `LLMProvider` base with tool-calling contract

**Files:**
- Modify: `packages/llm/src/llm/base.py`
- Test: `packages/llm/tests/test_base_extensions.py`

- [ ] **Step 1: Write failing tests**

Create `packages/llm/tests/test_base_extensions.py`:

```python
from __future__ import annotations

import pytest

from llm.base import LLMProvider, ProviderConfig
from llm.errors import ToolCallingNotSupported
from llm.tool_types import ToolResult


class _Dummy(LLMProvider):
    async def generate(self, messages, **kwargs):
        return ""

    async def embed(self, inputs):
        return []


def test_default_supports_flags_false():
    p = _Dummy(ProviderConfig(provider="dummy"))
    assert p.supports_tool_calling() is False
    assert p.supports_parallel_tool_calling() is False


async def test_default_generate_with_tools_raises():
    p = _Dummy(ProviderConfig(provider="dummy"))
    with pytest.raises(NotImplementedError):
        await p.generate_with_tools(messages=[], tools=[])


def test_default_tool_result_to_message_raises():
    p = _Dummy(ProviderConfig(provider="dummy"))
    with pytest.raises(NotImplementedError):
        p.tool_result_to_message(
            ToolResult(tool_use_id="t1", name="foo", data={"ok": True})
        )
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd packages/llm && pytest tests/test_base_extensions.py -v
```

Expected: `AttributeError: 'LLMProvider' object has no attribute 'supports_tool_calling'`

- [ ] **Step 3: Extend `base.py`**

Open `packages/llm/src/llm/base.py`. At the top (with existing imports), add:

```python
from typing import Literal, Sequence

from pydantic import BaseModel
```

Inside `class LLMProvider(ABC)`, **after** the existing `build_tool_declarations` method and **before** the `supports_batch_embed` property, insert:

```python
    # ── Tool-calling surface (Plan Agent Runtime v2 · A) ────────────────
    #
    # Providers that support tool calling override `supports_tool_calling`
    # to return True and implement `generate_with_tools` +
    # `tool_result_to_message`. The default raises so callers fail fast
    # when provisioned against a provider that does not support tools
    # (e.g. LLM_PROVIDER=ollama in A).
    #
    # Type of `messages` is intentionally `list[Any]` — each provider
    # uses its own native message type, and ToolLoopExecutor treats
    # them as opaque to preserve provider-specific metadata such as
    # Gemini 3 thought signatures.

    def supports_tool_calling(self) -> bool:
        return False

    def supports_parallel_tool_calling(self) -> bool:
        return False

    async def generate_with_tools(
        self,
        messages: list,
        tools: list,
        *,
        mode: Literal["auto", "any", "none"] = "auto",
        allowed_tool_names: Sequence[str] | None = None,
        final_response_schema: type[BaseModel] | None = None,
        cached_context_id: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
    ):
        raise NotImplementedError(
            f"{type(self).__name__} does not implement generate_with_tools"
        )

    def tool_result_to_message(self, result):
        raise NotImplementedError(
            f"{type(self).__name__} does not implement tool_result_to_message"
        )
```

- [ ] **Step 4: Run tests**

```bash
cd packages/llm && pytest tests/test_base_extensions.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/base.py packages/llm/tests/test_base_extensions.py
git commit -m "feat(llm): add generate_with_tools contract on LLMProvider"
```

---

## Phase 2 — Provider Implementations (Tasks 4-7)

### Task 4: `OllamaProvider` stub

**Files:**
- Modify: `packages/llm/src/llm/ollama.py`
- Test: `packages/llm/tests/test_ollama_stub.py`

- [ ] **Step 1: Write failing test**

Create `packages/llm/tests/test_ollama_stub.py`:

```python
from __future__ import annotations

import pytest

from llm.base import ProviderConfig
from llm.errors import ToolCallingNotSupported
from llm.ollama import OllamaProvider


def test_ollama_does_not_support_tools():
    p = OllamaProvider(ProviderConfig(provider="ollama", model="qwen2.5:7b"))
    assert p.supports_tool_calling() is False
    assert p.supports_parallel_tool_calling() is False


async def test_ollama_generate_with_tools_raises():
    p = OllamaProvider(ProviderConfig(provider="ollama", model="qwen2.5:7b"))
    with pytest.raises(ToolCallingNotSupported):
        await p.generate_with_tools(messages=[], tools=[])


def test_ollama_tool_result_to_message_raises():
    p = OllamaProvider(ProviderConfig(provider="ollama", model="qwen2.5:7b"))
    with pytest.raises(ToolCallingNotSupported):
        p.tool_result_to_message(None)
```

- [ ] **Step 2: Run test, verify fails**

```bash
cd packages/llm && pytest tests/test_ollama_stub.py -v
```

Expected: `supports_tool_calling` returns False already (inherited); but `generate_with_tools` raises `NotImplementedError`, not `ToolCallingNotSupported`.

- [ ] **Step 3: Add stub overrides to `ollama.py`**

Open `packages/llm/src/llm/ollama.py`. Add import at top:

```python
from .errors import ToolCallingNotSupported
```

Inside `class OllamaProvider(LLMProvider)`, append:

```python
    # Ollama tool calling is deferred to a later sub-project. The stub
    # raises an explicit error so callers that route an agent requiring
    # tools to LLM_PROVIDER=ollama fail fast with a useful message
    # instead of silently returning no tool calls.

    def supports_tool_calling(self) -> bool:
        return False

    async def generate_with_tools(self, *args, **kwargs):
        raise ToolCallingNotSupported(
            "OllamaProvider.generate_with_tools is not implemented yet. "
            "Set LLM_PROVIDER=gemini or implement this method."
        )

    def tool_result_to_message(self, result):
        raise ToolCallingNotSupported(
            "OllamaProvider.tool_result_to_message is not implemented yet."
        )
```

- [ ] **Step 4: Run tests**

```bash
cd packages/llm && pytest tests/test_ollama_stub.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/ollama.py packages/llm/tests/test_ollama_stub.py
git commit -m "feat(llm): explicit Ollama stub for tool calling"
```

---

### Task 5: Gemini — `supports_tool_calling` + declaration builder helper

**Files:**
- Modify: `packages/llm/src/llm/gemini.py`
- Test: `packages/llm/tests/test_gemini_declarations.py`

- [ ] **Step 1: Write failing test**

Create `packages/llm/tests/test_gemini_declarations.py`:

```python
from __future__ import annotations

from llm.base import ProviderConfig
from llm.gemini import GeminiProvider


class _FakeTool:
    def __init__(self, name, description, schema):
        self.name = name
        self.description = description
        self._schema = schema

    def input_schema(self) -> dict:
        return self._schema


def test_gemini_supports_tool_calling():
    p = GeminiProvider(ProviderConfig(
        provider="gemini", model="gemini-3-flash-preview", api_key="k",
    ))
    assert p.supports_tool_calling() is True
    assert p.supports_parallel_tool_calling() is False  # C will flip


def test_build_declarations_strips_toolcontext_from_schema():
    p = GeminiProvider(ProviderConfig(
        provider="gemini", model="gemini-3-flash-preview", api_key="k",
    ))
    tool = _FakeTool(
        name="search_concepts",
        description="Search concepts",
        schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "k": {"type": "integer"},
            },
            "required": ["query"],
        },
    )
    decls = p._build_function_declarations([tool])
    assert len(decls) == 1
    d = decls[0]
    assert d["name"] == "search_concepts"
    assert d["description"] == "Search concepts"
    assert "query" in d["parameters"]["properties"]
    assert "k" in d["parameters"]["properties"]
```

- [ ] **Step 2: Run test**

```bash
cd packages/llm && pytest tests/test_gemini_declarations.py -v
```

Expected: `AttributeError: 'GeminiProvider' object has no attribute '_build_function_declarations'`

- [ ] **Step 3: Add to `gemini.py`**

Open `packages/llm/src/llm/gemini.py`. At the top with other imports add:

```python
from typing import Any as _Any
```

Inside `class GeminiProvider(LLMProvider):`, add new methods (placement: after existing `embed_batch_cancel` at file bottom):

```python
    # ── Tool-calling surface (Plan Agent Runtime v2 · A) ────────────────

    def supports_tool_calling(self) -> bool:
        return True

    def supports_parallel_tool_calling(self) -> bool:
        # C will enable this once the executor can partition read-only
        # tool batches and dispatch them concurrently.
        return False

    @staticmethod
    def _build_function_declarations(tools: list) -> list[dict[str, _Any]]:
        """Translate runtime.tools.Tool instances to Gemini
        `function_declarations` shape. `input_schema()` already strips
        `ToolContext` params (handled by the @tool decorator)."""
        decls: list[dict[str, _Any]] = []
        for t in tools:
            decls.append({
                "name": t.name,
                "description": t.description,
                "parameters": t.input_schema(),
            })
        return decls
```

- [ ] **Step 4: Run test**

```bash
cd packages/llm && pytest tests/test_gemini_declarations.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/gemini.py packages/llm/tests/test_gemini_declarations.py
git commit -m "feat(llm): Gemini supports_tool_calling + declaration helper"
```

---

### Task 6: Gemini — `generate_with_tools` (happy path + error mapping)

**Files:**
- Modify: `packages/llm/src/llm/gemini.py`
- Test: `packages/llm/tests/test_gemini_tool_calling.py`

- [ ] **Step 1: Write failing tests**

Create `packages/llm/tests/test_gemini_tool_calling.py`:

```python
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from llm.base import ProviderConfig
from llm.errors import ProviderFatalError, ProviderRetryableError
from llm.gemini import GeminiProvider


def _make_provider() -> GeminiProvider:
    return GeminiProvider(ProviderConfig(
        provider="gemini", model="gemini-3-flash-preview", api_key="k",
    ))


def _fake_part_text(text: str):
    part = SimpleNamespace(text=text, function_call=None, thought_signature=None)
    return part


def _fake_part_function_call(id: str, name: str, args: dict):
    fc = SimpleNamespace(id=id, name=name, args=args)
    part = SimpleNamespace(text=None, function_call=fc, thought_signature=None)
    return part


def _fake_response(parts, finish_reason="STOP", usage=None):
    content = SimpleNamespace(parts=parts)
    candidate = SimpleNamespace(content=content, finish_reason=finish_reason)
    um = usage or SimpleNamespace(
        prompt_token_count=10,
        candidates_token_count=5,
        cached_content_token_count=0,
    )
    return SimpleNamespace(candidates=[candidate], usage_metadata=um)


async def test_pure_text_response_no_tool_uses():
    p = _make_provider()
    fake = _fake_response([_fake_part_text("hello")])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    turn = await p.generate_with_tools(messages=[], tools=[])

    assert turn.tool_uses == ()
    assert turn.final_text == "hello"
    assert turn.stop_reason == "STOP"
    assert turn.usage.input_tokens == 10
    assert turn.usage.output_tokens == 5


async def test_single_function_call_parsed():
    p = _make_provider()
    fake = _fake_response([
        _fake_part_function_call("f1", "search_concepts", {"query": "rope", "k": 3}),
    ])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    turn = await p.generate_with_tools(messages=[], tools=[])

    assert len(turn.tool_uses) == 1
    assert turn.tool_uses[0].id == "f1"
    assert turn.tool_uses[0].name == "search_concepts"
    assert turn.tool_uses[0].args == {"query": "rope", "k": 3}


async def test_mixed_text_and_function_call():
    p = _make_provider()
    fake = _fake_response([
        _fake_part_text("Let me search."),
        _fake_part_function_call("f1", "search_concepts", {"query": "x"}),
    ])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    turn = await p.generate_with_tools(messages=[], tools=[])

    assert turn.final_text == "Let me search."
    assert len(turn.tool_uses) == 1


async def test_api_429_maps_to_retryable():
    from google.genai import errors as genai_errors

    p = _make_provider()
    mock_models = MagicMock()
    err = genai_errors.APIError(code=429, response=MagicMock())
    err.message = "rate limited"
    mock_models.generate_content = AsyncMock(side_effect=err)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    with pytest.raises(ProviderRetryableError):
        await p.generate_with_tools(messages=[], tools=[])


async def test_api_401_maps_to_fatal():
    from google.genai import errors as genai_errors

    p = _make_provider()
    mock_models = MagicMock()
    err = genai_errors.APIError(code=401, response=MagicMock())
    err.message = "unauthorized"
    mock_models.generate_content = AsyncMock(side_effect=err)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    with pytest.raises(ProviderFatalError):
        await p.generate_with_tools(messages=[], tools=[])


async def test_auto_function_calling_always_disabled():
    """CRITICAL: runtime owns the loop. SDK must never auto-execute tools."""
    p = _make_provider()
    fake = _fake_response([_fake_part_text("ok")])
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SimpleNamespace(aio=SimpleNamespace(models=mock_models))

    await p.generate_with_tools(messages=[], tools=[])

    kwargs = mock_models.generate_content.call_args.kwargs
    config = kwargs["config"]
    assert config.automatic_function_calling.disable is True
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd packages/llm && pytest tests/test_gemini_tool_calling.py -v
```

Expected: All fail with `NotImplementedError` (from base).

- [ ] **Step 3: Implement `generate_with_tools` in `gemini.py`**

Add imports at top of `gemini.py`:

```python
import uuid
from typing import Literal, Sequence

from google.genai import errors as genai_errors
from pydantic import BaseModel

from .errors import ProviderFatalError, ProviderRetryableError
from .tool_types import AssistantTurn, ToolUse, UsageCounts
```

Inside `class GeminiProvider`, add (after `_build_function_declarations`):

```python
    async def generate_with_tools(
        self,
        messages: list,
        tools: list,
        *,
        mode: Literal["auto", "any", "none"] = "auto",
        allowed_tool_names: Sequence[str] | None = None,
        final_response_schema: type[BaseModel] | None = None,
        cached_context_id: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
    ) -> AssistantTurn:
        fn_decls = self._build_function_declarations(tools)

        mode_map = {"auto": "AUTO", "any": "ANY", "none": "NONE"}
        tool_config = types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(
                mode=mode_map[mode],
                allowed_function_names=(
                    list(allowed_tool_names) if allowed_tool_names else None
                ),
            )
        )

        config_kwargs: dict[str, _Any] = {
            "tools": [types.Tool(function_declarations=fn_decls)] if fn_decls else [],
            "tool_config": tool_config,
            # CRITICAL: runtime owns the loop. Docs default is auto-exec,
            # which would bypass our instrumentation + guards.
            "automatic_function_calling": types.AutomaticFunctionCallingConfig(
                disable=True
            ),
        }
        if temperature is not None:
            config_kwargs["temperature"] = temperature
        if max_output_tokens is not None:
            config_kwargs["max_output_tokens"] = max_output_tokens
        if cached_context_id:
            config_kwargs["cached_content"] = cached_context_id
        if final_response_schema is not None:
            config_kwargs["response_mime_type"] = "application/json"
            config_kwargs["response_schema"] = final_response_schema

        config = types.GenerateContentConfig(**config_kwargs)

        try:
            response = await self._client.aio.models.generate_content(
                model=self.config.model,
                contents=messages,
                config=config,
            )
        except genai_errors.APIError as e:
            code = getattr(e, "code", None) or 0
            if code in (408, 429, 500, 502, 503, 504):
                raise ProviderRetryableError(str(e)) from e
            raise ProviderFatalError(str(e)) from e

        candidate = response.candidates[0]
        assistant_content = candidate.content
        text_parts: list[str] = []
        tool_uses: list[ToolUse] = []

        # Per Gemini docs §Notes and limitations: "don't assume
        # function_call is always last — iterate through parts".
        for part in assistant_content.parts:
            fc = getattr(part, "function_call", None)
            if fc is not None:
                tool_uses.append(ToolUse(
                    id=fc.id or uuid.uuid4().hex,
                    name=fc.name,
                    args=dict(fc.args) if fc.args else {},
                    thought_signature=getattr(part, "thought_signature", None),
                ))
                continue
            txt = getattr(part, "text", None)
            if txt:
                text_parts.append(txt)

        final_text = "\n".join(text_parts) if text_parts else None
        structured: dict | None = None
        if final_response_schema is not None and final_text:
            import json as _json
            try:
                structured = _json.loads(final_text)
            except _json.JSONDecodeError:
                pass  # caller/loop can recover on next turn

        um = response.usage_metadata
        return AssistantTurn(
            final_text=final_text,
            tool_uses=tuple(tool_uses),
            assistant_message=assistant_content,
            structured_output=structured,
            usage=UsageCounts(
                input_tokens=getattr(um, "prompt_token_count", 0) or 0,
                output_tokens=getattr(um, "candidates_token_count", 0) or 0,
                cached_input_tokens=getattr(um, "cached_content_token_count", 0) or 0,
            ),
            stop_reason=str(candidate.finish_reason or "STOP"),
        )
```

- [ ] **Step 4: Run tests**

```bash
cd packages/llm && pytest tests/test_gemini_tool_calling.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/gemini.py packages/llm/tests/test_gemini_tool_calling.py
git commit -m "feat(llm): Gemini generate_with_tools with runtime-owned loop"
```

---

### Task 7: Gemini — `tool_result_to_message` + config passthrough verification

**Files:**
- Modify: `packages/llm/src/llm/gemini.py`
- Test: `packages/llm/tests/test_gemini_tool_result.py`

- [ ] **Step 1: Write failing tests**

Create `packages/llm/tests/test_gemini_tool_result.py`:

```python
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from llm.base import ProviderConfig
from llm.gemini import GeminiProvider
from llm.tool_types import ToolResult


def _make_provider() -> GeminiProvider:
    return GeminiProvider(ProviderConfig(
        provider="gemini", model="gemini-3-flash-preview", api_key="k",
    ))


def test_tool_result_to_message_success():
    p = _make_provider()
    msg = p.tool_result_to_message(
        ToolResult(tool_use_id="abc", name="search", data={"rows": 3})
    )
    # msg is a types.Content
    assert msg.role == "user"
    assert len(msg.parts) == 1
    fr = msg.parts[0].function_response
    assert fr.id == "abc"
    assert fr.name == "search"
    assert fr.response == {"result": {"rows": 3}}


def test_tool_result_to_message_error():
    p = _make_provider()
    msg = p.tool_result_to_message(
        ToolResult(tool_use_id="abc", name="search", data="boom", is_error=True)
    )
    fr = msg.parts[0].function_response
    assert fr.response == {"error": "boom"}


async def test_mode_any_with_allowed_names():
    from types import SimpleNamespace as SN

    p = _make_provider()
    fake = SN(
        candidates=[SN(content=SN(parts=[]), finish_reason="STOP")],
        usage_metadata=SN(prompt_token_count=0, candidates_token_count=0),
    )
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SN(aio=SN(models=mock_models))

    await p.generate_with_tools(
        messages=[], tools=[],
        mode="any", allowed_tool_names=["search_concepts"],
    )
    kwargs = mock_models.generate_content.call_args.kwargs
    tc = kwargs["config"].tool_config.function_calling_config
    assert tc.mode == "ANY"
    assert tc.allowed_function_names == ["search_concepts"]


async def test_cached_context_id_passed_through():
    from types import SimpleNamespace as SN

    p = _make_provider()
    fake = SN(
        candidates=[SN(content=SN(parts=[]), finish_reason="STOP")],
        usage_metadata=SN(prompt_token_count=0, candidates_token_count=0),
    )
    mock_models = MagicMock()
    mock_models.generate_content = AsyncMock(return_value=fake)
    p._client = SN(aio=SN(models=mock_models))

    await p.generate_with_tools(
        messages=[], tools=[], cached_context_id="cache-xyz",
    )
    kwargs = mock_models.generate_content.call_args.kwargs
    assert kwargs["config"].cached_content == "cache-xyz"
```

- [ ] **Step 2: Run tests, verify fails**

```bash
cd packages/llm && pytest tests/test_gemini_tool_result.py -v
```

Expected: `tool_result_to_message` test fails with `NotImplementedError`.

- [ ] **Step 3: Add `tool_result_to_message` to `gemini.py`**

Add at top of gemini.py if not present:

```python
from .tool_types import ToolResult  # already imported in Task 6
```

Inside `class GeminiProvider`, add (after `generate_with_tools`):

```python
    def tool_result_to_message(self, result: ToolResult):
        """Translate a ToolResult back into a Gemini `Content` so it
        can be appended to the conversation history for the next turn.
        Uses `FunctionResponse.id` to match Gemini 3's id-keyed mapping
        (Function Calling docs §207-210)."""
        payload = (
            {"result": result.data}
            if not result.is_error
            else {"error": result.data}
        )
        return types.Content(
            role="user",
            parts=[types.Part(
                function_response=types.FunctionResponse(
                    id=result.tool_use_id,
                    name=result.name,
                    response=payload,
                )
            )]
        )
```

- [ ] **Step 4: Run tests**

```bash
cd packages/llm && pytest tests/test_gemini_tool_result.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/llm/gemini.py packages/llm/tests/test_gemini_tool_result.py
git commit -m "feat(llm): Gemini tool_result_to_message + config passthrough tests"
```

---

## Phase 3 — ToolLoopExecutor (Tasks 8-12)

### Task 8: Loop dataclasses + hooks protocol

**Files:**
- Create: `apps/worker/src/runtime/tool_loop.py` (dataclasses only)
- Test: `apps/worker/tests/runtime/test_tool_loop_types.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/runtime/test_tool_loop_types.py`:

```python
from __future__ import annotations

import asyncio

from runtime.tool_loop import (
    CallKey,
    LoopConfig,
    LoopHooks,
    LoopResult,
    LoopState,
    NoopHooks,
    NullBudgetPolicy,
)


def test_loop_config_defaults():
    c = LoopConfig()
    assert c.max_turns == 8
    assert c.max_tool_calls == 12
    assert c.max_total_input_tokens == 200_000
    assert c.per_tool_timeout_sec == 30.0
    assert c.per_tool_timeout_overrides == {"fetch_url": 60.0}
    assert c.loop_detection_threshold == 3
    assert c.loop_detection_stop_threshold == 5
    assert c.mode == "auto"


def test_callkey_equality_via_args_hash():
    a = CallKey(tool_name="search", args_hash="deadbeef")
    b = CallKey(tool_name="search", args_hash="deadbeef")
    c = CallKey(tool_name="search", args_hash="cafebabe")
    assert a == b
    assert a != c
    assert hash(a) == hash(b)


def test_loop_state_tracks_counts():
    s = LoopState(messages=[])
    s.turn_count += 1
    s.tool_call_count += 2
    assert s.turn_count == 1
    assert s.tool_call_count == 2
    assert s.call_history == []


def test_null_budget_never_stops():
    p = NullBudgetPolicy()
    s = LoopState(messages=[])
    s.total_input_tokens = 10**9
    assert p.should_stop(s) is False


async def test_noop_hooks_callable():
    h = NoopHooks()
    s = LoopState(messages=[])
    # Should not raise
    await h.on_run_start(s)
    await h.on_turn_start(s)
    await h.on_run_end(s)
```

- [ ] **Step 2: Run tests, verify fails**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_types.py -v
```

Expected: `ModuleNotFoundError: No module named 'runtime.tool_loop'`.

- [ ] **Step 3: Create `tool_loop.py` dataclasses skeleton**

Create `apps/worker/src/runtime/tool_loop.py`:

```python
"""ToolLoopExecutor — runtime-owned tool-calling loop.

Umbrella: docs/superpowers/specs/2026-04-22-agent-runtime-v2-umbrella.md
Spec:     docs/superpowers/specs/2026-04-22-agent-runtime-v2a-core-tool-loop-design.md

The executor consumes a provider's `generate_with_tools` one turn at a
time, dispatches any requested tool uses through a `ToolRegistry`, and
re-feeds the results until the model stops or a guard fires. Guards,
soft loop detection, per-tool timeouts, and termination reasons are all
owned here so providers stay trivial.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, Sequence

from pydantic import BaseModel


# ── Types ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CallKey:
    tool_name: str
    args_hash: str


@dataclass
class LoopConfig:
    max_turns: int = 8
    max_tool_calls: int = 12
    max_total_input_tokens: int = 200_000
    per_tool_timeout_sec: float = 30.0
    per_tool_timeout_overrides: dict[str, float] = field(
        default_factory=lambda: {"fetch_url": 60.0}
    )
    loop_detection_threshold: int = 3
    loop_detection_stop_threshold: int = 5
    mode: Literal["auto", "any", "none"] = "auto"
    allowed_tool_names: Sequence[str] | None = None
    final_response_schema: type[BaseModel] | None = None
    cached_context_id: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    budget_policy: "BudgetPolicy | None" = None


@dataclass
class LoopState:
    messages: list[Any]
    turn_count: int = 0
    tool_call_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    call_history: list[CallKey] = field(default_factory=list)
    final_structured_output: dict | None = None


TerminationReason = Literal[
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


@dataclass
class LoopResult:
    final_text: str | None
    final_structured_output: dict | None
    termination_reason: TerminationReason
    turn_count: int
    tool_call_count: int
    total_input_tokens: int
    total_output_tokens: int
    error: str | None = None


# ── Budget policies ─────────────────────────────────────────────────────


class BudgetPolicy(Protocol):
    def should_stop(self, state: LoopState) -> bool: ...


class NullBudgetPolicy:
    """Default. Never blocks — BYOK / PAYG paths per
    `feedback_byok_cost_philosophy` memory."""

    def should_stop(self, state: LoopState) -> bool:
        return False


# ── Hooks ───────────────────────────────────────────────────────────────


class LoopHooks(Protocol):
    async def on_run_start(self, state: LoopState) -> None: ...
    async def on_turn_start(self, state: LoopState) -> None: ...
    async def on_tool_start(self, state: LoopState, tool_use) -> None: ...
    async def on_tool_end(self, state: LoopState, tool_use, result) -> None: ...
    async def on_run_end(self, state: LoopState) -> None: ...


class NoopHooks:
    async def on_run_start(self, state: LoopState) -> None: ...
    async def on_turn_start(self, state: LoopState) -> None: ...
    async def on_tool_start(self, state: LoopState, tool_use) -> None: ...
    async def on_tool_end(self, state: LoopState, tool_use, result) -> None: ...
    async def on_run_end(self, state: LoopState) -> None: ...
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_types.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/tool_loop.py apps/worker/tests/runtime/test_tool_loop_types.py
git commit -m "feat(worker): tool loop dataclasses + hooks protocol"
```

---

### Task 9: Executor — core `run()` (happy path only)

**Files:**
- Modify: `apps/worker/src/runtime/tool_loop.py`
- Test: `apps/worker/tests/runtime/test_tool_loop_core.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/runtime/test_tool_loop_core.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from llm.tool_types import AssistantTurn, ToolResult, ToolUse, UsageCounts
from runtime.tool_loop import LoopConfig, ToolLoopExecutor


@dataclass
class _FakeProvider:
    """Scripted responses: list of AssistantTurn, popped in order."""
    scripted: list[AssistantTurn]

    def supports_tool_calling(self) -> bool:
        return True

    async def generate_with_tools(self, **kwargs) -> AssistantTurn:
        return self.scripted.pop(0)

    def tool_result_to_message(self, result: ToolResult) -> dict:
        # tests use dict-shaped opaque messages
        return {"role": "tool", "id": result.tool_use_id,
                "name": result.name, "data": result.data,
                "is_error": result.is_error}


class _FakeRegistry:
    def __init__(self, handlers: dict[str, Any]):
        self._handlers = handlers

    async def execute(self, name: str, args: dict) -> Any:
        return await self._handlers[name](args)


def _turn(text: str | None = None, tool_uses=(), stop="STOP"):
    return AssistantTurn(
        final_text=text, tool_uses=tuple(tool_uses),
        assistant_message={"role": "assistant", "text": text},
        usage=UsageCounts(input_tokens=5, output_tokens=3),
        stop_reason=stop,
    )


async def test_turn_one_no_tools_returns_model_stopped():
    provider = _FakeProvider(scripted=[_turn(text="hi")])
    registry = _FakeRegistry(handlers={})
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=LoopConfig(), tool_context={"workspace_id": "ws"},
    )
    result = await exec.run(initial_messages=[{"role": "user", "text": "ping"}])
    assert result.termination_reason == "model_stopped"
    assert result.final_text == "hi"
    assert result.turn_count == 0  # no subsequent turn needed
    assert result.tool_call_count == 0


async def test_tool_use_then_model_stopped():
    tu = ToolUse(id="t1", name="search", args={"q": "rope"})
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="done"),
    ])

    async def search_handler(args):
        assert args["q"] == "rope"
        return {"hits": ["concept_42"]}

    registry = _FakeRegistry(handlers={"search": search_handler})
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=LoopConfig(), tool_context={"workspace_id": "ws"},
    )
    result = await exec.run(initial_messages=[{"role": "user", "text": "find"}])
    assert result.termination_reason == "model_stopped"
    assert result.tool_call_count == 1
    assert result.final_text == "done"
```

- [ ] **Step 2: Run tests, verify fails**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_core.py -v
```

Expected: `ImportError: cannot import name 'ToolLoopExecutor'`.

- [ ] **Step 3: Implement `ToolLoopExecutor` in `tool_loop.py`**

Append to `apps/worker/src/runtime/tool_loop.py`:

```python
import asyncio
import json
import logging

from runtime.tools import hash_input

logger = logging.getLogger(__name__)


class ToolLoopExecutor:
    """Sequential tool-calling loop. See module docstring for scope.

    `tool_context` is a plain dict of system-managed values (e.g.
    workspace_id, project_id) that are merged into every tool_use's
    args before dispatch. This enforces workspace isolation: the LLM
    cannot escape its caller-supplied scope even if it tries to pass
    different values.
    """

    def __init__(
        self,
        provider,
        tool_registry,
        config: LoopConfig,
        tool_context: dict[str, Any],
        *,
        tools: list | None = None,
        hooks: LoopHooks | None = None,
    ) -> None:
        self._provider = provider
        self._tool_registry = tool_registry
        self._config = config
        self._tool_context = dict(tool_context)
        self._tools = tools or []
        self._hooks: LoopHooks = hooks or NoopHooks()
        self._budget = config.budget_policy or NullBudgetPolicy()

    async def run(self, initial_messages: list[Any]) -> LoopResult:
        state = LoopState(messages=list(initial_messages))
        await self._hooks.on_run_start(state)
        try:
            while True:
                await self._hooks.on_turn_start(state)

                turn = await self._provider.generate_with_tools(
                    messages=state.messages,
                    tools=self._tools,
                    mode=self._config.mode,
                    allowed_tool_names=self._config.allowed_tool_names,
                    final_response_schema=self._config.final_response_schema,
                    cached_context_id=self._config.cached_context_id,
                    temperature=self._config.temperature,
                    max_output_tokens=self._config.max_output_tokens,
                )

                state.total_input_tokens += turn.usage.input_tokens
                state.total_output_tokens += turn.usage.output_tokens
                state.messages.append(turn.assistant_message)

                if not turn.tool_uses:
                    return self._finalize(
                        state, "model_stopped",
                        final_text=turn.final_text,
                        structured=turn.structured_output,
                    )

                for tu in turn.tool_uses:
                    result = await self._execute_tool(tu)
                    state.messages.append(
                        self._provider.tool_result_to_message(result)
                    )
                    state.tool_call_count += 1
                    state.call_history.append(
                        CallKey(tu.name, tu.args_hash())
                    )
                    await self._hooks.on_tool_end(state, tu, result)

                state.turn_count += 1
        finally:
            await self._hooks.on_run_end(state)

    async def _execute_tool(self, tool_use) -> ToolResult:
        # Merge system-managed scope values over LLM-supplied args
        # (Umbrella §3 C3 — workspace isolation enforcement).
        args = {**tool_use.args, **self._tool_context}
        try:
            raw = await self._tool_registry.execute(tool_use.name, args)
            data = self._truncate(raw, tool_use.name)
            return ToolResult(
                tool_use_id=tool_use.id, name=tool_use.name,
                data=data, is_error=False,
            )
        except Exception as e:  # other failure modes added in Task 11
            return ToolResult(
                tool_use_id=tool_use.id, name=tool_use.name,
                data={"error": f"{type(e).__name__}: {e}"},
                is_error=True,
            )

    def _truncate(self, data: Any, tool_name: str) -> Any:
        max_chars = 50_000  # tool-specific override added via ToolMeta in later tasks
        encoded = json.dumps(data, default=str)
        if len(encoded) > max_chars:
            return json.loads(encoded[:max_chars - 200]) if False else (
                encoded[:max_chars - 200]
                + f"\n\n[truncated: original {len(encoded)} chars]"
            )
        return data

    def _finalize(
        self,
        state: LoopState,
        reason: TerminationReason,
        *,
        final_text: str | None = None,
        structured: dict | None = None,
        error: str | None = None,
    ) -> LoopResult:
        return LoopResult(
            final_text=final_text,
            final_structured_output=structured or state.final_structured_output,
            termination_reason=reason,
            turn_count=state.turn_count,
            tool_call_count=state.tool_call_count,
            total_input_tokens=state.total_input_tokens,
            total_output_tokens=state.total_output_tokens,
            error=error,
        )
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_core.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/tool_loop.py apps/worker/tests/runtime/test_tool_loop_core.py
git commit -m "feat(worker): ToolLoopExecutor core sequential loop"
```

---

### Task 10: Executor — hard guards (max_turns/max_tool_calls/max_input_tokens)

**Files:**
- Modify: `apps/worker/src/runtime/tool_loop.py`
- Test: `apps/worker/tests/runtime/test_tool_loop_hard_guards.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/runtime/test_tool_loop_hard_guards.py`:

```python
from __future__ import annotations

from llm.tool_types import AssistantTurn, ToolUse, UsageCounts
from runtime.tool_loop import LoopConfig, ToolLoopExecutor

# Reuse fakes from core test
from .test_tool_loop_core import _FakeProvider, _FakeRegistry, _turn


async def test_max_turns_terminates():
    tu = ToolUse(id="t", name="ping", args={})
    # Always return a tool_use → loop would run forever without guard.
    provider = _FakeProvider(scripted=[_turn(tool_uses=[tu]) for _ in range(20)])

    async def ping(args):
        return {"ok": True}

    registry = _FakeRegistry(handlers={"ping": ping})
    config = LoopConfig(max_turns=3, max_tool_calls=999)
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await exec.run(initial_messages=[])
    assert result.termination_reason == "max_turns"


async def test_max_tool_calls_terminates():
    tu = ToolUse(id="t", name="ping", args={})
    provider = _FakeProvider(scripted=[_turn(tool_uses=[tu]) for _ in range(20)])

    async def ping(args):
        return {"ok": True}

    registry = _FakeRegistry(handlers={"ping": ping})
    config = LoopConfig(max_turns=999, max_tool_calls=2)
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await exec.run(initial_messages=[])
    assert result.termination_reason == "max_tool_calls"
    assert result.tool_call_count == 2


async def test_max_input_tokens_terminates():
    # Each turn reports 100 input tokens; limit is 150.
    tu = ToolUse(id="t", name="ping", args={})
    provider = _FakeProvider(scripted=[
        AssistantTurn(
            final_text=None, tool_uses=(tu,),
            assistant_message={},
            usage=UsageCounts(input_tokens=100, output_tokens=10),
            stop_reason="STOP",
        ) for _ in range(5)
    ])

    async def ping(args):
        return {}

    registry = _FakeRegistry(handlers={"ping": ping})
    config = LoopConfig(max_total_input_tokens=150)
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await exec.run(initial_messages=[])
    assert result.termination_reason == "max_input_tokens"
```

- [ ] **Step 2: Run tests, verify fail**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_hard_guards.py -v
```

Expected: Tests hang or fail with empty scripted list — guards not implemented.

- [ ] **Step 3: Add guards to `ToolLoopExecutor.run()`**

In `tool_loop.py`, inside `ToolLoopExecutor.run()`, replace the loop body so it starts each iteration with a guard check. Update to:

```python
    async def run(self, initial_messages: list[Any]) -> LoopResult:
        state = LoopState(messages=list(initial_messages))
        await self._hooks.on_run_start(state)
        try:
            while True:
                # Hard guards — evaluated at loop head so partial state
                # from the previous iteration is already accounted for.
                if reason := self._check_hard_guards(state):
                    return self._finalize(state, reason)

                await self._hooks.on_turn_start(state)

                turn = await self._provider.generate_with_tools(
                    messages=state.messages, tools=self._tools,
                    mode=self._config.mode,
                    allowed_tool_names=self._config.allowed_tool_names,
                    final_response_schema=self._config.final_response_schema,
                    cached_context_id=self._config.cached_context_id,
                    temperature=self._config.temperature,
                    max_output_tokens=self._config.max_output_tokens,
                )

                state.total_input_tokens += turn.usage.input_tokens
                state.total_output_tokens += turn.usage.output_tokens
                state.messages.append(turn.assistant_message)

                if not turn.tool_uses:
                    return self._finalize(
                        state, "model_stopped",
                        final_text=turn.final_text,
                        structured=turn.structured_output,
                    )

                for tu in turn.tool_uses:
                    result = await self._execute_tool(tu)
                    state.messages.append(
                        self._provider.tool_result_to_message(result)
                    )
                    state.tool_call_count += 1
                    state.call_history.append(
                        CallKey(tu.name, tu.args_hash())
                    )
                    await self._hooks.on_tool_end(state, tu, result)

                    # After each tool, check if we've blown the tool budget.
                    if reason := self._check_hard_guards(state):
                        return self._finalize(state, reason)

                state.turn_count += 1
        finally:
            await self._hooks.on_run_end(state)
```

Add the helper method below `_finalize`:

```python
    def _check_hard_guards(self, state: LoopState) -> TerminationReason | None:
        if state.turn_count >= self._config.max_turns:
            return "max_turns"
        if state.tool_call_count >= self._config.max_tool_calls:
            return "max_tool_calls"
        if state.total_input_tokens >= self._config.max_total_input_tokens:
            return "max_input_tokens"
        if self._budget.should_stop(state):
            return "budget_exceeded"
        return None
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_hard_guards.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/tool_loop.py apps/worker/tests/runtime/test_tool_loop_hard_guards.py
git commit -m "feat(worker): tool loop hard guards (turns/calls/tokens)"
```

---

### Task 11: Executor — soft guards (loop detection, per-tool timeout, tool exception)

**Files:**
- Modify: `apps/worker/src/runtime/tool_loop.py`
- Test: `apps/worker/tests/runtime/test_tool_loop_soft_guards.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/runtime/test_tool_loop_soft_guards.py`:

```python
from __future__ import annotations

import asyncio

from llm.tool_types import ToolUse
from runtime.tool_loop import LoopConfig, ToolLoopExecutor

from .test_tool_loop_core import _FakeProvider, _FakeRegistry, _turn


async def test_loop_detection_hard_stop_after_5():
    tu = ToolUse(id="t", name="ping", args={"q": "same"})
    # Same (name, args) 10 times in a row.
    provider = _FakeProvider(scripted=[_turn(tool_uses=[tu]) for _ in range(10)])

    async def ping(args):
        return {"ok": True}

    registry = _FakeRegistry(handlers={"ping": ping})
    config = LoopConfig(
        loop_detection_threshold=3, loop_detection_stop_threshold=5,
        max_turns=999, max_tool_calls=999,
    )
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await exec.run(initial_messages=[])
    assert result.termination_reason == "loop_detected_hard"
    assert result.tool_call_count <= 5


async def test_per_tool_timeout_yields_error_result():
    tu = ToolUse(id="t", name="slow", args={})
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="recovered"),
    ])

    async def slow_handler(args):
        await asyncio.sleep(5)
        return {"never": True}

    registry = _FakeRegistry(handlers={"slow": slow_handler})
    config = LoopConfig(per_tool_timeout_sec=0.05)
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=config, tool_context={},
    )
    result = await exec.run(initial_messages=[])
    assert result.termination_reason == "model_stopped"
    assert result.final_text == "recovered"


async def test_tool_exception_yields_is_error_loop_continues():
    tu = ToolUse(id="t", name="boom", args={})
    provider = _FakeProvider(scripted=[
        _turn(tool_uses=[tu]),
        _turn(text="recovered"),
    ])

    async def boom(args):
        raise ValueError("kaboom")

    registry = _FakeRegistry(handlers={"boom": boom})
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=LoopConfig(), tool_context={},
    )
    result = await exec.run(initial_messages=[])
    assert result.termination_reason == "model_stopped"
    assert result.tool_call_count == 1
```

- [ ] **Step 2: Run tests, verify fails**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_soft_guards.py -v
```

Expected: loop_detection + timeout tests fail.

- [ ] **Step 3: Update `_execute_tool` and loop for timeout + soft guards**

Replace `_execute_tool` in `tool_loop.py` with:

```python
    async def _execute_tool(self, tool_use) -> ToolResult:
        timeout = self._config.per_tool_timeout_overrides.get(
            tool_use.name, self._config.per_tool_timeout_sec,
        )
        args = {**tool_use.args, **self._tool_context}
        try:
            async with asyncio.timeout(timeout):
                raw = await self._tool_registry.execute(tool_use.name, args)
            data = self._truncate(raw, tool_use.name)
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
        except Exception as e:
            return ToolResult(
                tool_use_id=tool_use.id, name=tool_use.name,
                data={"error": f"{type(e).__name__}: {e}"},
                is_error=True,
            )
```

Add soft-guard helper + warning injection. Below `_check_hard_guards`:

```python
    def _check_soft_guards(
        self, state: LoopState, tool_use,
    ) -> TerminationReason | None:
        key = CallKey(tool_use.name, tool_use.args_hash())
        repeat = state.call_history.count(key)
        if repeat >= self._config.loop_detection_stop_threshold - 1:
            return "loop_detected_hard"
        if repeat >= self._config.loop_detection_threshold - 1:
            self._inject_loop_warning(state, tool_use)
        return None

    def _inject_loop_warning(self, state: LoopState, tool_use) -> None:
        warn = ToolResult(
            tool_use_id=tool_use.id, name=tool_use.name,
            data={
                "warning": (
                    f"You have called '{tool_use.name}' with the same "
                    "arguments repeatedly. Try a different approach."
                )
            },
            is_error=True,
        )
        state.messages.append(
            self._provider.tool_result_to_message(warn)
        )
```

Update the per-`tu` loop in `run()` to call `_check_soft_guards` before execution:

Replace the block:
```python
                for tu in turn.tool_uses:
                    result = await self._execute_tool(tu)
```
with:
```python
                for tu in turn.tool_uses:
                    if reason := self._check_soft_guards(state, tu):
                        return self._finalize(state, reason)
                    result = await self._execute_tool(tu)
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_soft_guards.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/tool_loop.py apps/worker/tests/runtime/test_tool_loop_soft_guards.py
git commit -m "feat(worker): tool loop soft guards (detection, timeout, tool exception)"
```

---

### Task 12: Executor — termination paths (structured_submitted / cancelled / provider errors)

**Files:**
- Modify: `apps/worker/src/runtime/tool_loop.py`
- Test: `apps/worker/tests/runtime/test_tool_loop_termination.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/runtime/test_tool_loop_termination.py`:

```python
from __future__ import annotations

import asyncio

from llm.errors import ProviderFatalError, ProviderRetryableError
from llm.tool_types import AssistantTurn, ToolUse, UsageCounts
from runtime.tool_loop import LoopConfig, ToolLoopExecutor

from .test_tool_loop_core import _FakeProvider, _FakeRegistry, _turn


class _ErrorProvider:
    def __init__(self, exc: Exception):
        self._exc = exc

    def supports_tool_calling(self) -> bool:
        return True

    async def generate_with_tools(self, **kwargs):
        raise self._exc

    def tool_result_to_message(self, result):
        return {}


async def test_structured_submitted_ends_immediately():
    tu = ToolUse(
        id="t", name="emit_structured_output",
        args={"schema_name": "X", "data": {"a": 1}},
    )
    provider = _FakeProvider(scripted=[_turn(tool_uses=[tu])])

    async def emit(args):
        return {"accepted": True, "validated": args["data"]}

    registry = _FakeRegistry(handlers={"emit_structured_output": emit})
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=registry,
        config=LoopConfig(), tool_context={},
    )
    result = await exec.run(initial_messages=[])
    assert result.termination_reason == "structured_submitted"
    assert result.final_structured_output == {"a": 1}


async def test_provider_fatal_terminates_provider_error():
    provider = _ErrorProvider(ProviderFatalError("unauthorized"))
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=_FakeRegistry(handlers={}),
        config=LoopConfig(), tool_context={},
    )
    result = await exec.run(initial_messages=[])
    assert result.termination_reason == "provider_error"
    assert "unauthorized" in (result.error or "")


async def test_provider_retryable_propagates():
    provider = _ErrorProvider(ProviderRetryableError("rate limit"))
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=_FakeRegistry(handlers={}),
        config=LoopConfig(), tool_context={},
    )
    import pytest
    with pytest.raises(ProviderRetryableError):
        await exec.run(initial_messages=[])


async def test_cancelled_returns_partial_state():
    async def slow_generate(**kwargs):
        await asyncio.sleep(5)
        return _turn(text="never")

    class _SlowProvider:
        def supports_tool_calling(self): return True
        generate_with_tools = staticmethod(slow_generate)
        def tool_result_to_message(self, r): return {}

    provider = _SlowProvider()
    exec = ToolLoopExecutor(
        provider=provider, tool_registry=_FakeRegistry(handlers={}),
        config=LoopConfig(), tool_context={},
    )
    task = asyncio.create_task(exec.run(initial_messages=[]))
    await asyncio.sleep(0.05)
    task.cancel()
    result = await task
    assert result.termination_reason == "cancelled"
```

- [ ] **Step 2: Run tests, verify fail**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_termination.py -v
```

Expected: 4 fails (no termination handling yet).

- [ ] **Step 3: Add termination handling in `tool_loop.py`**

Import at top:

```python
from llm.errors import ProviderFatalError, ProviderRetryableError
```

Replace `run()` once more to handle all termination paths. The full final shape:

```python
    async def run(self, initial_messages: list[Any]) -> LoopResult:
        state = LoopState(messages=list(initial_messages))
        await self._hooks.on_run_start(state)
        try:
            while True:
                if reason := self._check_hard_guards(state):
                    return self._finalize(state, reason)

                await self._hooks.on_turn_start(state)

                try:
                    turn = await self._provider.generate_with_tools(
                        messages=state.messages, tools=self._tools,
                        mode=self._config.mode,
                        allowed_tool_names=self._config.allowed_tool_names,
                        final_response_schema=self._config.final_response_schema,
                        cached_context_id=self._config.cached_context_id,
                        temperature=self._config.temperature,
                        max_output_tokens=self._config.max_output_tokens,
                    )
                except ProviderRetryableError:
                    raise  # Temporal activity retry
                except ProviderFatalError as e:
                    return self._finalize(
                        state, "provider_error", error=str(e),
                    )

                state.total_input_tokens += turn.usage.input_tokens
                state.total_output_tokens += turn.usage.output_tokens
                state.messages.append(turn.assistant_message)

                if not turn.tool_uses:
                    return self._finalize(
                        state, "model_stopped",
                        final_text=turn.final_text,
                        structured=turn.structured_output,
                    )

                for tu in turn.tool_uses:
                    if reason := self._check_soft_guards(state, tu):
                        return self._finalize(state, reason)
                    result = await self._execute_tool(tu)
                    state.messages.append(
                        self._provider.tool_result_to_message(result)
                    )
                    state.tool_call_count += 1
                    state.call_history.append(
                        CallKey(tu.name, tu.args_hash())
                    )
                    await self._hooks.on_tool_end(state, tu, result)

                    if (
                        tu.name == "emit_structured_output"
                        and isinstance(result.data, dict)
                        and result.data.get("accepted") is True
                    ):
                        state.final_structured_output = result.data.get("validated")
                        return self._finalize(state, "structured_submitted")

                    if reason := self._check_hard_guards(state):
                        return self._finalize(state, reason)

                state.turn_count += 1
        except asyncio.CancelledError:
            return self._finalize(state, "cancelled")
        finally:
            await self._hooks.on_run_end(state)
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/runtime/test_tool_loop_termination.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Run full tool_loop suite to confirm no regressions**

```bash
cd apps/worker && pytest tests/runtime/ -v
```

Expected: all previous tool_loop tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/tool_loop.py apps/worker/tests/runtime/test_tool_loop_termination.py
git commit -m "feat(worker): tool loop termination paths (structured/cancel/provider)"
```

---

## Phase 4 — Tool Family (Tasks 13-18)

### Task 13: `schema_registry` + `emit_structured_output`

**Files:**
- Create: `apps/worker/src/worker/tools_builtin/__init__.py`
- Create: `apps/worker/src/worker/tools_builtin/schema_registry.py`
- Create: `apps/worker/src/worker/tools_builtin/emit_structured_output.py`
- Test: `apps/worker/tests/tools_builtin/test_emit_structured.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/tools_builtin/test_emit_structured.py`:

```python
from __future__ import annotations

from pydantic import BaseModel

from runtime.events import Scope
from runtime.tools import ToolContext
from worker.tools_builtin.schema_registry import SCHEMA_REGISTRY, register_schema
from worker.tools_builtin.emit_structured_output import emit_structured_output


class _DemoSchema(BaseModel):
    title: str
    score: int


def _ctx() -> ToolContext:
    async def _emit(_ev): ...
    return ToolContext(
        workspace_id="ws", project_id="pj", page_id=None,
        user_id="u", run_id="r", scope="project",
        emit=_emit,
    )


def test_register_schema():
    register_schema("DemoSchema", _DemoSchema)
    assert SCHEMA_REGISTRY["DemoSchema"] is _DemoSchema


async def test_emit_valid():
    register_schema("DemoSchema", _DemoSchema)
    res = await emit_structured_output.run(
        args={"schema_name": "DemoSchema", "data": {"title": "x", "score": 3}},
        ctx=_ctx(),
    )
    assert res["accepted"] is True
    assert res["validated"] == {"title": "x", "score": 3}


async def test_emit_invalid_returns_errors():
    register_schema("DemoSchema", _DemoSchema)
    res = await emit_structured_output.run(
        args={"schema_name": "DemoSchema", "data": {"title": "x"}},
        ctx=_ctx(),
    )
    assert res["accepted"] is False
    assert "score" in str(res["errors"])


async def test_emit_unregistered_schema_returns_error():
    res = await emit_structured_output.run(
        args={"schema_name": "UnknownSchema", "data": {}},
        ctx=_ctx(),
    )
    assert res["accepted"] is False
    assert "not registered" in res["errors"][0].lower()
```

Add `apps/worker/tests/tools_builtin/__init__.py` (empty).

- [ ] **Step 2: Run tests**

```bash
cd apps/worker && pytest tests/tools_builtin/test_emit_structured.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create builtin tools scaffolding**

Create `apps/worker/src/worker/tools_builtin/__init__.py`:

```python
"""Built-in tools for Sub-project A demo agent.

These tools are designed around the existing `runtime.tools.ToolContext`
injection pattern: every tool function takes `ctx: ToolContext` in
addition to the LLM-visible args, and `ctx` is populated from the
activity's caller (workspace/project id validated upstream).

BUILTIN_TOOLS is the default tool set for ToolDemoAgent.full(); subsets
map to the other presets (plain/reference/external).
"""
from __future__ import annotations

from .emit_structured_output import emit_structured_output
from .fetch_url import fetch_url
from .list_project_topics import list_project_topics
from .read_note import read_note
from .search_concepts import search_concepts
from .search_notes import search_notes

BUILTIN_TOOLS: tuple = (
    list_project_topics,
    search_concepts,
    search_notes,
    read_note,
    fetch_url,
    emit_structured_output,
)

__all__ = [
    "BUILTIN_TOOLS",
    "emit_structured_output",
    "fetch_url",
    "list_project_topics",
    "read_note",
    "search_concepts",
    "search_notes",
]
```

Note: this file will fail to import until the other tool modules exist — it is the terminal state for Task 18. For now we'll import lazily in `emit_structured_output` only.

For this task, first create only the two files needed. Replace the above `__init__.py` temporarily with:

```python
"""Built-in tools (stub — populated across Tasks 13-18)."""
```

Create `apps/worker/src/worker/tools_builtin/schema_registry.py`:

```python
"""Pydantic schema registry for `emit_structured_output`.

Sub-project A ships a tiny demo schema set; B expands. Registration is
explicit (no auto-discovery) so the tool rejects unknown names with a
clear error the LLM can correct.
"""
from __future__ import annotations

from pydantic import BaseModel

SCHEMA_REGISTRY: dict[str, type[BaseModel]] = {}


def register_schema(name: str, model: type[BaseModel]) -> None:
    SCHEMA_REGISTRY[name] = model


# Demo schemas used by ToolDemoAgent ------------------------------------


class ConceptSummary(BaseModel):
    concept_id: str
    title: str
    synopsis: str
    confidence: float


class ResearchAnswer(BaseModel):
    question: str
    answer: str
    supporting_note_ids: list[str]
    confidence: float


register_schema("ConceptSummary", ConceptSummary)
register_schema("ResearchAnswer", ResearchAnswer)
```

Create `apps/worker/src/worker/tools_builtin/emit_structured_output.py`:

```python
"""`emit_structured_output` tool — structured answer submission."""
from __future__ import annotations

from pydantic import ValidationError

from runtime.tools import ToolContext, tool

from .schema_registry import SCHEMA_REGISTRY


@tool(name="emit_structured_output")
async def emit_structured_output(
    schema_name: str,
    data: dict,
    ctx: ToolContext,
) -> dict:
    """Submit your final answer as a structured object matching one of
    the registered schemas. The loop ends when a valid schema is
    accepted. If validation fails, fix the errors and retry.
    """
    model = SCHEMA_REGISTRY.get(schema_name)
    if model is None:
        return {
            "accepted": False,
            "errors": [
                f"Schema '{schema_name}' is not registered. "
                f"Available: {sorted(SCHEMA_REGISTRY.keys())}"
            ],
        }
    try:
        validated = model.model_validate(data)
    except ValidationError as e:
        return {"accepted": False, "errors": [str(err) for err in e.errors()]}
    return {"accepted": True, "validated": validated.model_dump()}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/tools_builtin/test_emit_structured.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/tools_builtin/ apps/worker/tests/tools_builtin/
git commit -m "feat(worker): schema registry + emit_structured_output tool"
```

---

### Task 14: `fetch_url` — public HTTP fetch with SSRF defenses

**Files:**
- Create: `apps/worker/src/worker/tools_builtin/fetch_url.py`
- Test: `apps/worker/tests/tools_builtin/test_fetch_url.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/tools_builtin/test_fetch_url.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from runtime.tools import ToolContext
from worker.tools_builtin.fetch_url import fetch_url


def _ctx() -> ToolContext:
    async def _emit(_ev): ...
    return ToolContext(
        workspace_id="ws", project_id="pj", page_id=None,
        user_id="u", run_id="r", scope="project",
        emit=_emit,
    )


@pytest.mark.parametrize("url", [
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[fe80::1]/",
])
async def test_fetch_url_blocks_private_address(url):
    res = await fetch_url.run(args={"url": url}, ctx=_ctx())
    assert res.get("error")
    assert "private" in res["error"].lower() or "blocked" in res["error"].lower()


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "gopher://example.com/",
    "ftp://example.com/",
    "javascript:alert(1)",
])
async def test_fetch_url_blocks_unsupported_scheme(url):
    res = await fetch_url.run(args={"url": url}, ctx=_ctx())
    assert res.get("error")


async def test_fetch_url_public_http_returns_content():
    with patch("worker.tools_builtin.fetch_url._fetch_bytes") as mock_fetch:
        mock_fetch.return_value = (
            b"<html><body><p>Hello world</p></body></html>",
            "text/html",
        )
        res = await fetch_url.run(
            args={"url": "https://example.com/"},
            ctx=_ctx(),
        )
        assert "Hello world" in res["content"]
        assert res["content_type"] == "text/html"


async def test_fetch_url_binary_content_omitted():
    with patch("worker.tools_builtin.fetch_url._fetch_bytes") as mock_fetch:
        mock_fetch.return_value = (b"\x00\x01\x02", "application/pdf")
        res = await fetch_url.run(
            args={"url": "https://example.com/file.pdf"},
            ctx=_ctx(),
        )
        assert "[binary content omitted]" in res["content"]
```

- [ ] **Step 2: Run tests, verify fails**

```bash
cd apps/worker && pytest tests/tools_builtin/test_fetch_url.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `fetch_url.py`**

Create `apps/worker/src/worker/tools_builtin/fetch_url.py`:

```python
"""`fetch_url` tool — public URL fetch with SSRF defenses.

Blocks RFC1918 private ranges, loopback, link-local (AWS metadata
included), IPv6 link-local, and non-http(s) schemes. DNS resolution is
performed up-front so a domain that resolves to a private IP is rejected
before bytes are pulled (naive rebinding defense — sufficient for a
worker where ingress is controlled).
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from runtime.tools import ToolContext, tool

MAX_BYTES = 10 * 1024 * 1024  # 10 MB
TIMEOUT_SEC = 60.0


def _is_private(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # be conservative
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _resolve_host(host: str) -> list[str]:
    try:
        return [info[4][0] for info in socket.getaddrinfo(host, None)]
    except socket.gaierror:
        return []


async def _fetch_bytes(url: str) -> tuple[bytes, str]:
    """Isolated for ease of mocking in tests."""
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC, follow_redirects=True) as c:
        async with c.stream("GET", url) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError(f"Response exceeded {MAX_BYTES} bytes")
                chunks.append(chunk)
    return b"".join(chunks), content_type.split(";")[0].strip()


def _extract_text(body: bytes, content_type: str) -> str:
    if not content_type.startswith("text/"):
        return "[binary content omitted]"
    try:
        html = body.decode("utf-8", errors="replace")
    except Exception:
        return "[decoding failed]"
    if content_type == "text/html":
        # Minimal: strip tags without pulling in a heavyweight lib.
        import re
        stripped = re.sub(r"<script.*?</script>|<style.*?</style>", " ",
                          html, flags=re.DOTALL | re.IGNORECASE)
        stripped = re.sub(r"<[^>]+>", " ", stripped)
        stripped = re.sub(r"\s+", " ", stripped).strip()
        return stripped
    return html


@tool(name="fetch_url")
async def fetch_url(url: str, ctx: ToolContext) -> dict:
    """Fetch text content from a public URL. Returns an error for
    private/internal addresses, non-http(s) schemes, or responses
    larger than 10 MB."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return {"error": f"Unsupported scheme: {parsed.scheme!r}"}
    host = parsed.hostname or ""
    if not host:
        return {"error": "URL has no host"}

    # Quick-path: literal IP in URL.
    try:
        if _is_private(host):
            return {"error": f"Blocked: {host} is a private/internal address"}
    except ValueError:
        pass

    # Resolve hostname and reject if any address is private (rebinding defense).
    addrs = _resolve_host(host)
    if not addrs:
        return {"error": f"DNS resolution failed for {host}"}
    for addr in addrs:
        if _is_private(addr):
            return {
                "error": (
                    f"Blocked: {host} resolves to private address {addr}"
                )
            }

    try:
        body, content_type = await _fetch_bytes(url)
    except ValueError as e:
        return {"error": str(e)}
    except httpx.HTTPError as e:
        return {"error": f"HTTP error: {e}"}

    return {
        "url": url,
        "content": _extract_text(body, content_type),
        "content_type": content_type,
    }
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/tools_builtin/test_fetch_url.py -v
```

Expected: all parametrized tests pass (7 + 4 + 1 + 1 = 13).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/tools_builtin/fetch_url.py apps/worker/tests/tools_builtin/test_fetch_url.py
git commit -m "feat(worker): fetch_url tool with SSRF defenses"
```

---

### Task 15: Add `/api/internal/projects/:id/topics` endpoint

**Files:**
- Modify: `apps/api/src/routes/internal.ts` (or closest existing file)
- Test: `apps/api/test/internal.test.ts` (or closest existing)
- Modify: `apps/worker/src/worker/lib/api_client.py` — add `list_project_topics` method

- [ ] **Step 1: Locate the existing internal route file**

```bash
grep -rn "api/internal/concepts/search\|api/internal/concepts/upsert" apps/api/src --include="*.ts" | head -5
```

Use the path returned (likely `apps/api/src/routes/internal.ts`) as the integration point.

- [ ] **Step 2: Write a failing API-side test**

Open the existing test file that tests internal routes (identified in the grep above — if none, create `apps/api/test/internal-topics.test.ts`).

Add a test case (adapt to existing test framework in apps/api; the following uses Vitest style assumed by the codebase):

```typescript
describe("GET /api/internal/projects/:id/topics", () => {
  it("returns top N concepts as topics with concept_count", async () => {
    const projectId = await seedProjectWithConcepts(7);
    const res = await app.request(`/api/internal/projects/${projectId}/topics`, {
      headers: { "X-Internal-Secret": process.env.INTERNAL_API_SECRET! },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(7);
    expect(body.results[0]).toHaveProperty("topic_id");
    expect(body.results[0]).toHaveProperty("name");
    expect(body.results[0]).toHaveProperty("concept_count");
  });

  it("401s without internal secret", async () => {
    const res = await app.request("/api/internal/projects/abc/topics");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @opencairn/api test -- internal-topics
```

Expected: route not found / 404.

- [ ] **Step 4: Implement the endpoint**

In the file returned by step 1, add a new route. If the file is `apps/api/src/routes/internal.ts`:

```typescript
// GET /api/internal/projects/:id/topics
// Returns up to 30 concepts in the project ordered by note-link count
// desc. Used by Sub-project A's `list_project_topics` tool as the
// Layer-3 hierarchical retrieval entry point.
internal.get("/projects/:id/topics", async (c) => {
  const projectId = c.req.param("id");
  const rows = await db.execute(sql`
    SELECT c.id AS topic_id, c.name, COUNT(cn.note_id)::int AS concept_count
    FROM concepts c
    LEFT JOIN concept_notes cn ON cn.concept_id = c.id
    WHERE c.project_id = ${projectId}
    GROUP BY c.id, c.name
    ORDER BY concept_count DESC
    LIMIT 30
  `);
  return c.json({ results: rows });
});
```

(Adjust the Drizzle/SQL import to match the project's existing pattern — check neighbor handlers for `db.execute` vs `db.select`.)

- [ ] **Step 5: Run API tests**

```bash
pnpm --filter @opencairn/api test -- internal-topics
```

Expected: both tests pass.

- [ ] **Step 6: Add `list_project_topics` to `api_client.py`**

In `apps/worker/src/worker/lib/api_client.py`, inside `class AgentApiClient`, add:

```python
    async def list_project_topics(
        self, *, project_id: str,
    ) -> list[dict[str, _Any]]:  # type: ignore[name-defined]
        """Top 30 concepts in the project by note-link count, used as
        Layer 3 hierarchical retrieval entry point."""
        res = await get_internal(
            f"/api/internal/projects/{project_id}/topics"
        )
        return list(res.get("results", []))
```

(If `_Any` isn't imported in the file, use `Any` with existing import.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/internal.ts apps/api/test/ apps/worker/src/worker/lib/api_client.py
git commit -m "feat(api): add internal list_project_topics endpoint"
```

---

### Task 16: `list_project_topics` + `search_concepts` tools

**Files:**
- Create: `apps/worker/src/worker/tools_builtin/list_project_topics.py`
- Create: `apps/worker/src/worker/tools_builtin/search_concepts.py`
- Test: `apps/worker/tests/tools_builtin/test_retrieval_concept_tools.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/tools_builtin/test_retrieval_concept_tools.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from runtime.tools import ToolContext
from worker.tools_builtin.list_project_topics import list_project_topics
from worker.tools_builtin.search_concepts import search_concepts


def _ctx(project_id: str = "pj") -> ToolContext:
    async def _emit(_ev): ...
    return ToolContext(
        workspace_id="ws", project_id=project_id, page_id=None,
        user_id="u", run_id="r", scope="project",
        emit=_emit,
    )


async def test_list_project_topics_delegates_to_api():
    with patch(
        "worker.tools_builtin.list_project_topics.AgentApiClient",
    ) as cls:
        inst = cls.return_value
        inst.list_project_topics = AsyncMock(return_value=[
            {"topic_id": "c1", "name": "RoPE", "concept_count": 5},
        ])
        res = await list_project_topics.run(args={}, ctx=_ctx())
    assert res == [{"topic_id": "c1", "name": "RoPE", "concept_count": 5}]
    inst.list_project_topics.assert_awaited_once_with(project_id="pj")


async def test_search_concepts_embeds_query_then_calls_api():
    with patch(
        "worker.tools_builtin.search_concepts.get_provider",
    ) as get_provider, patch(
        "worker.tools_builtin.search_concepts.AgentApiClient",
    ) as cls:
        provider = AsyncMock()
        provider.embed = AsyncMock(return_value=[[0.1, 0.2]])
        get_provider.return_value = provider
        inst = cls.return_value
        inst.search_concepts = AsyncMock(return_value=[
            {"id": "c1", "name": "RoPE", "description": "..", "similarity": 0.9},
        ])
        res = await search_concepts.run(
            args={"query": "rotary embeddings", "k": 3}, ctx=_ctx(),
        )
    provider.embed.assert_awaited_once()
    inst.search_concepts.assert_awaited_once_with(
        project_id="pj", embedding=[0.1, 0.2], k=3,
    )
    assert res[0]["id"] == "c1"
```

- [ ] **Step 2: Run tests**

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement tools**

Create `apps/worker/src/worker/tools_builtin/list_project_topics.py`:

```python
"""`list_project_topics` tool — Layer 3 hierarchical retrieval entry."""
from __future__ import annotations

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient


@tool(name="list_project_topics", allowed_scopes=("project",))
async def list_project_topics(ctx: ToolContext) -> list[dict]:
    """Return the top topics in the current project. Start here to see
    what domains this project covers. Then use search_concepts to drill
    into one topic.
    """
    client = AgentApiClient()
    return await client.list_project_topics(project_id=ctx.project_id)
```

Create `apps/worker/src/worker/tools_builtin/search_concepts.py`:

```python
"""`search_concepts` tool — concept-level hybrid retrieval."""
from __future__ import annotations

from llm.base import EmbedInput
from llm.factory import get_provider

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient


@tool(name="search_concepts", allowed_scopes=("project",))
async def search_concepts(
    query: str,
    ctx: ToolContext,
    k: int = 5,
) -> list[dict]:
    """Vector search over concepts in the current project. Returns
    summaries (not full page content). Use read_note to drill into a
    specific source note after picking a concept.
    """
    provider = get_provider()
    [embedding] = await provider.embed(
        [EmbedInput(text=query, task="retrieval_query")],
    )
    client = AgentApiClient()
    return await client.search_concepts(
        project_id=ctx.project_id,
        embedding=embedding,
        k=k,
    )
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/tools_builtin/test_retrieval_concept_tools.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/tools_builtin/list_project_topics.py \
        apps/worker/src/worker/tools_builtin/search_concepts.py \
        apps/worker/tests/tools_builtin/test_retrieval_concept_tools.py
git commit -m "feat(worker): list_project_topics + search_concepts tools"
```

---

### Task 17: `search_notes` + `read_note` tools

**Files:**
- Create: `apps/worker/src/worker/tools_builtin/search_notes.py`
- Create: `apps/worker/src/worker/tools_builtin/read_note.py`
- Test: `apps/worker/tests/tools_builtin/test_note_tools.py`

- [ ] **Step 1: Write failing tests**

Create `apps/worker/tests/tools_builtin/test_note_tools.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from runtime.tools import ToolContext
from worker.tools_builtin.read_note import read_note
from worker.tools_builtin.search_notes import search_notes


def _ctx() -> ToolContext:
    async def _emit(_ev): ...
    return ToolContext(
        workspace_id="ws", project_id="pj", page_id=None,
        user_id="u", run_id="r", scope="project",
        emit=_emit,
    )


async def test_search_notes_hybrid_mode_synopsis():
    with patch(
        "worker.tools_builtin.search_notes.get_provider",
    ) as gp, patch(
        "worker.tools_builtin.search_notes.AgentApiClient",
    ) as cls:
        gp.return_value.embed = AsyncMock(return_value=[[0.1]])
        inst = cls.return_value
        inst.hybrid_search_notes = AsyncMock(return_value=[
            {"noteId": "n1", "title": "T", "snippet": "snip",
             "rrfScore": 0.5},
        ])
        res = await search_notes.run(
            args={"query": "x", "k": 3, "mode": "synopsis"}, ctx=_ctx(),
        )
    assert res[0]["noteId"] == "n1"


async def test_read_note_delegates_to_get_note():
    with patch(
        "worker.tools_builtin.read_note.AgentApiClient",
    ) as cls:
        inst = cls.return_value
        inst.get_note = AsyncMock(return_value={
            "id": "n1", "title": "T", "contentText": "body",
            "workspaceId": "ws", "projectId": "pj",
        })
        res = await read_note.run(
            args={"note_id": "n1"}, ctx=_ctx(),
        )
    assert res["id"] == "n1"
    assert res["title"] == "T"


async def test_read_note_rejects_cross_workspace():
    with patch(
        "worker.tools_builtin.read_note.AgentApiClient",
    ) as cls:
        inst = cls.return_value
        inst.get_note = AsyncMock(return_value={
            "id": "n1", "title": "T", "contentText": "body",
            "workspaceId": "ws-OTHER",  # belongs to different ws
            "projectId": "pj",
        })
        res = await read_note.run(args={"note_id": "n1"}, ctx=_ctx())
    assert res.get("error")
    assert "workspace" in res["error"].lower()
```

- [ ] **Step 2: Run tests**

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement tools**

Create `apps/worker/src/worker/tools_builtin/search_notes.py`:

```python
"""`search_notes` tool — raw note/chunk hybrid retrieval."""
from __future__ import annotations

from typing import Literal

from llm.base import EmbedInput
from llm.factory import get_provider

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient


@tool(name="search_notes", allowed_scopes=("project",))
async def search_notes(
    query: str,
    ctx: ToolContext,
    k: int = 5,
    mode: Literal["synopsis", "full"] = "synopsis",
) -> list[dict]:
    """Chunk-level RRF hybrid search over source notes in the current
    project. Prefer synopsis mode; use full only when a deep dive is
    necessary.
    """
    provider = get_provider()
    [embedding] = await provider.embed(
        [EmbedInput(text=query, task="retrieval_query")],
    )
    client = AgentApiClient()
    hits = await client.hybrid_search_notes(
        project_id=ctx.project_id,
        query_text=query,
        query_embedding=embedding,
        k=k,
    )
    if mode == "synopsis":
        # Truncate snippet further for context budget preservation.
        return [
            {**h, "snippet": (h.get("snippet") or "")[:400]}
            for h in hits
        ]
    return hits
```

Create `apps/worker/src/worker/tools_builtin/read_note.py`:

```python
"""`read_note` tool — full note content with workspace isolation."""
from __future__ import annotations

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient

MAX_CONTENT_CHARS = 50_000


@tool(name="read_note", allowed_scopes=("project",))
async def read_note(note_id: str, ctx: ToolContext) -> dict:
    """Fetch the full content of a specific note. Use after
    search_concepts or search_notes identified something worth reading.
    """
    client = AgentApiClient()
    try:
        note = await client.get_note(note_id)
    except Exception as e:
        return {"error": f"Failed to fetch note: {e}"}

    # Defence in depth — even if the caller injected a note_id from
    # another workspace, the API response includes workspaceId and we
    # check it here (project_id is stricter still).
    if note.get("workspaceId") != ctx.workspace_id:
        return {
            "error": (
                f"Note {note_id} does not belong to current workspace"
            )
        }

    content = note.get("contentText") or ""
    truncated = False
    if len(content) > MAX_CONTENT_CHARS:
        content = content[: MAX_CONTENT_CHARS - 100] + "\n\n[truncated]"
        truncated = True

    return {
        "id": note["id"],
        "title": note.get("title"),
        "content": content,
        "truncated": truncated,
        "project_id": note.get("projectId"),
    }
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/tools_builtin/test_note_tools.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/tools_builtin/search_notes.py \
        apps/worker/src/worker/tools_builtin/read_note.py \
        apps/worker/tests/tools_builtin/test_note_tools.py
git commit -m "feat(worker): search_notes + read_note tools with isolation check"
```

---

### Task 18: Wire `BUILTIN_TOOLS` + tool registry bridge

**Files:**
- Modify: `apps/worker/src/worker/tools_builtin/__init__.py`
- Create: `apps/worker/src/runtime/tool_registry.py` (adapter)
- Test: `apps/worker/tests/tools_builtin/test_builtin_tools_package.py`

- [ ] **Step 1: Write failing test**

Create `apps/worker/tests/tools_builtin/test_builtin_tools_package.py`:

```python
from __future__ import annotations

from worker.tools_builtin import BUILTIN_TOOLS


def test_builtin_tools_has_six():
    names = {t.name for t in BUILTIN_TOOLS}
    assert names == {
        "list_project_topics",
        "search_concepts",
        "search_notes",
        "read_note",
        "fetch_url",
        "emit_structured_output",
    }


def test_all_tools_have_descriptions():
    for t in BUILTIN_TOOLS:
        assert t.description, f"{t.name} has empty description"


def test_all_tools_support_input_schema():
    for t in BUILTIN_TOOLS:
        schema = t.input_schema()
        assert schema["type"] == "object"
        assert "properties" in schema
```

- [ ] **Step 2: Update `__init__.py` with the full BUILTIN_TOOLS tuple**

Overwrite `apps/worker/src/worker/tools_builtin/__init__.py` with the final shape (already drafted in Task 13 notes):

```python
"""Built-in tools for Sub-project A demo agent."""
from __future__ import annotations

from .emit_structured_output import emit_structured_output
from .fetch_url import fetch_url
from .list_project_topics import list_project_topics
from .read_note import read_note
from .search_concepts import search_concepts
from .search_notes import search_notes

BUILTIN_TOOLS: tuple = (
    list_project_topics,
    search_concepts,
    search_notes,
    read_note,
    fetch_url,
    emit_structured_output,
)

__all__ = [
    "BUILTIN_TOOLS",
    "emit_structured_output",
    "fetch_url",
    "list_project_topics",
    "read_note",
    "search_concepts",
    "search_notes",
]
```

- [ ] **Step 3: Add a lightweight registry adapter for `ToolLoopExecutor`**

Create `apps/worker/src/runtime/tool_registry.py`:

```python
"""Tool registry adapter used by `ToolLoopExecutor`.

`runtime.tools.Tool` instances are keyed by `.name`. The adapter looks
them up, injects a `ToolContext`, and calls `.run()`. The executor only
needs an object with an async `execute(name, args)` signature.
"""
from __future__ import annotations

from typing import Any

from runtime.tools import Tool, ToolContext


class ToolContextRegistry:
    def __init__(self, tools: list[Tool], ctx: ToolContext) -> None:
        self._by_name = {t.name: t for t in tools}
        self._ctx = ctx

    async def execute(self, name: str, args: dict[str, Any]) -> Any:
        tool = self._by_name.get(name)
        if tool is None:
            raise KeyError(f"Unknown tool: {name}")
        # Remove any system-managed keys the LLM might have tried to
        # supply; they come from ctx instead.
        clean = {k: v for k, v in args.items()
                 if k not in ("workspace_id", "project_id", "page_id",
                              "user_id", "run_id", "scope")}
        return await tool.run(clean, self._ctx)
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/tools_builtin/test_builtin_tools_package.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Run all worker tests to confirm no regressions**

```bash
cd apps/worker && pytest tests/ -v
```

Expected: entire suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/tools_builtin/__init__.py \
        apps/worker/src/runtime/tool_registry.py \
        apps/worker/tests/tools_builtin/test_builtin_tools_package.py
git commit -m "feat(worker): wire BUILTIN_TOOLS tuple + registry adapter"
```

---

## Phase 5 — Agent Integration (Tasks 19-20)

### Task 19: `runtime.Agent.run_with_tools()` convenience

**Files:**
- Modify: `apps/worker/src/runtime/agent.py`
- Test: `apps/worker/tests/runtime/test_agent_run_with_tools.py`

- [ ] **Step 1: Write failing test**

Create `apps/worker/tests/runtime/test_agent_run_with_tools.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from llm.errors import ToolCallingNotSupported
from runtime.agent import Agent
from runtime.tool_loop import LoopConfig


class _NoToolsProvider:
    def supports_tool_calling(self) -> bool:
        return False

    async def generate_with_tools(self, **kwargs):
        raise ToolCallingNotSupported("nope")


async def test_run_with_tools_fails_fast_when_provider_unsupported():
    agent = Agent(name="test", provider=_NoToolsProvider())
    with pytest.raises(ToolCallingNotSupported):
        await agent.run_with_tools(
            initial_messages=[],
            tools=[],
            tool_context={"workspace_id": "ws", "project_id": "pj"},
            config=LoopConfig(),
        )
```

- [ ] **Step 2: Run test, verify fails**

```bash
cd apps/worker && pytest tests/runtime/test_agent_run_with_tools.py -v
```

Expected: `AttributeError: 'Agent' object has no attribute 'run_with_tools'`.

- [ ] **Step 3: Add `run_with_tools` to `agent.py`**

Open `apps/worker/src/runtime/agent.py`. Near the top (existing imports), add:

```python
from runtime.tool_loop import LoopConfig, LoopHooks, LoopResult, ToolLoopExecutor
from runtime.tool_registry import ToolContextRegistry
```

Inside `class Agent:`, append:

```python
    async def run_with_tools(
        self,
        *,
        initial_messages: list,
        tools: list,
        tool_context: dict,
        config: LoopConfig | None = None,
        hooks: LoopHooks | None = None,
    ) -> LoopResult:
        """Run a tool-calling loop bound to this agent's provider.

        Fails fast with `ToolCallingNotSupported` when the provider
        does not implement tool calling (e.g. env LLM_PROVIDER=ollama
        during Sub-project A).
        """
        from llm.errors import ToolCallingNotSupported

        if not self.provider.supports_tool_calling():
            raise ToolCallingNotSupported(
                f"Provider {type(self.provider).__name__} does not "
                "support tool calling."
            )

        # ToolContext pattern (runtime.tools) expects a ToolContext
        # dataclass. If the caller supplied a dict, adapt.
        from runtime.tools import ToolContext
        from runtime.events import Scope

        async def _noop_emit(_ev): ...
        ctx = ToolContext(
            workspace_id=tool_context["workspace_id"],
            project_id=tool_context.get("project_id"),
            page_id=tool_context.get("page_id"),
            user_id=tool_context.get("user_id", ""),
            run_id=tool_context.get("run_id", ""),
            scope=tool_context.get("scope", "project"),
            emit=tool_context.get("emit", _noop_emit),
        )

        registry = ToolContextRegistry(tools=tools, ctx=ctx)
        executor = ToolLoopExecutor(
            provider=self.provider,
            tool_registry=registry,
            config=config or LoopConfig(),
            tool_context=tool_context,
            tools=tools,
            hooks=hooks,
        )
        return await executor.run(initial_messages=initial_messages)
```

(Note: `self.provider` must be an existing attribute. If `Agent` stores provider under a different name, adjust.)

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/runtime/test_agent_run_with_tools.py -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime/agent.py apps/worker/tests/runtime/test_agent_run_with_tools.py
git commit -m "feat(worker): Agent.run_with_tools convenience"
```

---

### Task 20: `ToolDemoAgent` with 4 presets

**Files:**
- Create: `apps/worker/src/worker/agents/tool_demo/__init__.py`
- Create: `apps/worker/src/worker/agents/tool_demo/agent.py`
- Test: `apps/worker/tests/agents/test_tool_demo_agent_unit.py`

- [ ] **Step 1: Write failing unit tests (not yet integration)**

Create `apps/worker/tests/agents/__init__.py` (empty) and `apps/worker/tests/agents/test_tool_demo_agent_unit.py`:

```python
from __future__ import annotations

from worker.agents.tool_demo.agent import ToolDemoAgent


def test_plain_preset_has_no_tools():
    a = ToolDemoAgent.plain(provider=None)
    assert a.tools == ()


def test_reference_preset_is_retrieval_only():
    a = ToolDemoAgent.reference(provider=None)
    names = {t.name for t in a.tools}
    assert names == {
        "list_project_topics", "search_concepts",
        "search_notes", "read_note",
    }


def test_external_preset_has_fetch_and_emit():
    a = ToolDemoAgent.external(provider=None)
    names = {t.name for t in a.tools}
    assert names == {"fetch_url", "emit_structured_output"}


def test_full_preset_is_all_builtin():
    from worker.tools_builtin import BUILTIN_TOOLS
    a = ToolDemoAgent.full(provider=None)
    assert set(a.tools) == set(BUILTIN_TOOLS)
```

- [ ] **Step 2: Run tests**

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `ToolDemoAgent`**

Create `apps/worker/src/worker/agents/tool_demo/__init__.py`:

```python
from .agent import ToolDemoAgent

__all__ = ["ToolDemoAgent"]
```

Create `apps/worker/src/worker/agents/tool_demo/agent.py`:

```python
"""ToolDemoAgent — Sub-project A verification agent.

Four presets map 1:1 to the four chat modes identified in the umbrella
(plain / reference / external / full). Each preset bundles a different
tool subset; the `run_with_tools` loop is identical across presets.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from runtime.agent import Agent
from runtime.tool_loop import LoopConfig, LoopResult
from worker.tools_builtin import (
    BUILTIN_TOOLS,
    emit_structured_output,
    fetch_url,
    list_project_topics,
    read_note,
    search_concepts,
    search_notes,
)


@dataclass
class ToolDemoAgent:
    provider: object
    tools: tuple = field(default_factory=tuple)

    @classmethod
    def plain(cls, provider) -> "ToolDemoAgent":
        """Pure chat — no tools. PLAIN chat mode demo."""
        return cls(provider=provider, tools=())

    @classmethod
    def reference(cls, provider) -> "ToolDemoAgent":
        """NotebookLM-style — retrieval-only."""
        return cls(provider=provider, tools=(
            list_project_topics, search_concepts, search_notes, read_note,
        ))

    @classmethod
    def external(cls, provider) -> "ToolDemoAgent":
        """External-only — fetch_url + emit_structured_output."""
        return cls(provider=provider, tools=(fetch_url, emit_structured_output))

    @classmethod
    def full(cls, provider) -> "ToolDemoAgent":
        """All builtin tools."""
        return cls(provider=provider, tools=tuple(BUILTIN_TOOLS))

    async def run(
        self,
        *,
        user_prompt: str,
        tool_context: dict,
        config: LoopConfig | None = None,
    ) -> LoopResult:
        agent = Agent(name="tool_demo", provider=self.provider)
        # Build the initial message in the provider's native format.
        # For Gemini, this is types.Content; we leave construction to
        # the caller by providing a factory on the provider, or default
        # to a generic dict shape that the Gemini wrapper accepts when
        # using the `text=` convenience in integration tests.
        messages = [{"role": "user", "text": user_prompt}]
        return await agent.run_with_tools(
            initial_messages=messages,
            tools=list(self.tools),
            tool_context=tool_context,
            config=config,
        )
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && pytest tests/agents/test_tool_demo_agent_unit.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/tool_demo/ \
        apps/worker/tests/agents/
git commit -m "feat(worker): ToolDemoAgent with plain/reference/external/full presets"
```

---

## Phase 6 — Integration Tests (Task 21)

### Task 21: Integration tests — 4 modes with real Postgres + Gemini

**Files:**
- Create: `apps/worker/tests/integration/test_tool_demo_agent.py`
- Create: `apps/worker/tests/integration/conftest.py` (if not present)

This task runs against a live Gemini API — gate behind env var `GEMINI_API_KEY_CI`.

- [ ] **Step 1: Confirm Plan 4 integration fixtures exist**

```bash
grep -rn "testcontainers\|postgres_url\|pgvector" apps/worker/tests --include="conftest.py" | head -5
```

Note the fixture names. If `postgres_url`, `api_client`, etc. are defined, reuse them.

- [ ] **Step 2: Write the integration tests**

Create `apps/worker/tests/integration/test_tool_demo_agent.py`:

```python
"""Integration tests for ToolDemoAgent.

Gated by GEMINI_API_KEY_CI; skipped locally. Asserts each of the four
chat-mode presets runs end-to-end and respects the cost budget.
"""
from __future__ import annotations

import os

import pytest

from llm.factory import get_provider
from runtime.tool_loop import LoopConfig
from worker.agents.tool_demo.agent import ToolDemoAgent

pytestmark = pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY_CI"),
    reason="needs GEMINI_API_KEY_CI",
)


COST_BUDGET_USD = 0.05


def _context(project_id: str) -> dict:
    return {
        "workspace_id": "integration-ws",
        "project_id": project_id,
        "user_id": "test-user",
        "run_id": "test-run",
        "scope": "project",
    }


async def test_plain_mode_no_tool_calls(postgres_url, seeded_project):
    provider = get_provider()
    agent = ToolDemoAgent.plain(provider=provider)
    result = await agent.run(
        user_prompt="Say hello in one short sentence.",
        tool_context=_context(seeded_project),
    )
    assert result.termination_reason == "model_stopped"
    assert result.tool_call_count == 0
    assert result.final_text


async def test_reference_mode_hits_search_tools(postgres_url, seeded_project):
    provider = get_provider()
    agent = ToolDemoAgent.reference(provider=provider)
    result = await agent.run(
        user_prompt="What topics are in this project?",
        tool_context=_context(seeded_project),
        config=LoopConfig(max_turns=4, max_tool_calls=4),
    )
    assert result.termination_reason == "model_stopped"
    assert result.tool_call_count >= 1


async def test_full_mode_structured_output(postgres_url, seeded_project):
    provider = get_provider()
    agent = ToolDemoAgent.full(provider=provider)
    result = await agent.run(
        user_prompt=(
            "Find a topic and submit a ConceptSummary via "
            "emit_structured_output."
        ),
        tool_context=_context(seeded_project),
        config=LoopConfig(max_turns=5, max_tool_calls=6),
    )
    assert result.termination_reason in (
        "structured_submitted", "model_stopped",
    )


async def test_external_mode_fetch_url_and_emit():
    provider = get_provider()
    agent = ToolDemoAgent.external(provider=provider)
    result = await agent.run(
        user_prompt=(
            "Fetch https://example.com and submit a summary via "
            "emit_structured_output using the ResearchAnswer schema."
        ),
        tool_context=_context("any-project"),
        config=LoopConfig(max_turns=5),
    )
    assert result.termination_reason in (
        "structured_submitted", "model_stopped",
    )
```

If `seeded_project` fixture does not exist, add one in `apps/worker/tests/integration/conftest.py`:

```python
import pytest

from worker.lib.api_client import AgentApiClient


@pytest.fixture
async def seeded_project(postgres_url) -> str:
    """Create a project and seed 3 concepts + 3 notes for retrieval tests."""
    # Implementation reuses the existing Plan 4 fixture helpers;
    # adapt to whatever ingest path the repo's test harness already provides.
    # Minimal shape: insert a workspace, project, 3 source_notes, and
    # 3 concepts with concept_notes links.
    raise NotImplementedError(
        "Wire to existing Plan 4 fixture harness — see "
        "apps/worker/tests/conftest.py for patterns."
    )
```

(This fixture is wired by the implementer based on the existing Plan 4 harness. Mark as `@pytest.mark.xfail(strict=False)` for initial merge if the harness is not yet drop-in.)

- [ ] **Step 3: Run integration tests**

With `GEMINI_API_KEY_CI` set:

```bash
cd apps/worker && GEMINI_API_KEY_CI=$GEMINI_API_KEY pytest tests/integration/test_tool_demo_agent.py -v
```

Expected: all 4 tests pass (or `xfail` on the `seeded_project` fixture until wired).

Without the env var:

```bash
cd apps/worker && pytest tests/integration/test_tool_demo_agent.py -v
```

Expected: 4 skipped.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/tests/integration/
git commit -m "test(worker): tool demo agent integration 4-mode matrix"
```

---

## Phase 7 — Security Tests (Task 22)

### Task 22: Security test matrix — workspace isolation + SSRF

**Files:**
- Create: `apps/worker/tests/security/test_tool_isolation.py`

- [ ] **Step 1: Write the isolation matrix**

Create `apps/worker/tests/security/__init__.py` (empty) and `apps/worker/tests/security/test_tool_isolation.py`:

```python
"""Security matrix for Sub-project A.

Covers:
- Workspace isolation: LLM-injected workspace_id cannot override runtime
- Read_note cross-workspace rejection
- fetch_url SSRF breadth (RFC1918, loopback, link-local, IPv6, schemes, size)
- emit_structured_output schema registry rejects unknown names
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from runtime.tools import ToolContext
from worker.tools_builtin.read_note import read_note
from worker.tools_builtin.search_concepts import search_concepts


def _ctx(ws: str = "ws-A", pj: str = "pj-A") -> ToolContext:
    async def _emit(_): ...
    return ToolContext(
        workspace_id=ws, project_id=pj, page_id=None,
        user_id="u", run_id="r", scope="project", emit=_emit,
    )


async def test_runtime_overrides_llm_injected_workspace_id():
    """Even if the LLM passes workspace_id='ws-B' in tool args, the
    ToolContextRegistry strips it and the tool only sees ctx values."""
    from runtime.tool_registry import ToolContextRegistry
    from worker.tools_builtin.search_concepts import search_concepts

    with patch(
        "worker.tools_builtin.search_concepts.get_provider",
    ) as gp, patch(
        "worker.tools_builtin.search_concepts.AgentApiClient",
    ) as cls:
        gp.return_value.embed = AsyncMock(return_value=[[0.1]])
        inst = cls.return_value
        inst.search_concepts = AsyncMock(return_value=[])

        reg = ToolContextRegistry(
            tools=[search_concepts],
            ctx=_ctx(ws="ws-A", pj="pj-A"),
        )
        # LLM tried to inject a different workspace/project.
        await reg.execute(
            "search_concepts",
            {"query": "x",
             "workspace_id": "ws-B",
             "project_id": "pj-B"},
        )
    # Assert the API was called with ctx.project_id, not the injected one.
    inst.search_concepts.assert_awaited_once_with(
        project_id="pj-A", embedding=[0.1], k=5,
    )


async def test_read_note_rejects_cross_workspace_response():
    """Even if the API returns a note from another workspace (e.g. via
    a bug), read_note double-checks and refuses."""
    with patch(
        "worker.tools_builtin.read_note.AgentApiClient",
    ) as cls:
        inst = cls.return_value
        inst.get_note = AsyncMock(return_value={
            "id": "n1", "title": "Leaked", "contentText": "secret",
            "workspaceId": "ws-B",  # different from ctx
            "projectId": "pj",
        })
        res = await read_note.run(args={"note_id": "n1"}, ctx=_ctx(ws="ws-A"))
    assert res.get("error")


@pytest.mark.parametrize("private", [
    "http://10.0.0.1/",
    "http://172.31.255.254/",
    "http://192.168.0.1/",
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/latest/",
    "http://[fe80::1]/",
])
async def test_ssrf_private_blocked(private):
    from worker.tools_builtin.fetch_url import fetch_url
    res = await fetch_url.run(args={"url": private}, ctx=_ctx())
    assert res.get("error")


@pytest.mark.parametrize("scheme", [
    "file:///etc/passwd",
    "gopher://a/",
    "ftp://a/",
    "javascript:alert(1)",
])
async def test_ssrf_schemes_blocked(scheme):
    from worker.tools_builtin.fetch_url import fetch_url
    res = await fetch_url.run(args={"url": scheme}, ctx=_ctx())
    assert res.get("error")


async def test_emit_schema_registry_rejects_unknown():
    from worker.tools_builtin.emit_structured_output import emit_structured_output
    res = await emit_structured_output.run(
        args={"schema_name": "NonexistentSchema", "data": {}},
        ctx=_ctx(),
    )
    assert res["accepted"] is False
```

- [ ] **Step 2: Run security matrix**

```bash
cd apps/worker && pytest tests/security/test_tool_isolation.py -v
```

Expected: all pass (covers ~14 parametrized cases + 3 isolated cases).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/tests/security/
git commit -m "test(worker): security matrix for tool isolation + SSRF"
```

---

## Phase 8 — Documentation + Wrap-up (Tasks 23-24)

### Task 23: Update antipatterns doc + api-contract + context-budget

**Files:**
- Modify: `docs/contributing/llm-antipatterns.md`
- Modify: `docs/architecture/api-contract.md`
- Modify: `docs/architecture/context-budget.md`

- [ ] **Step 1: Append Gemini tool-calling § to antipatterns**

Open `docs/contributing/llm-antipatterns.md` and append a new section at the bottom:

```markdown

## §N. Gemini Tool Calling — gotchas from Sub-project A

Added 2026-04-22. These bit us during Agent Runtime v2 · Sub-project A
implementation and must not bite us again.

### N.1 Never read only `response.text` when tools are enabled

`response.text` flattens the candidate and drops every `function_call`
part. If the model requested a tool, you will silently see an empty
string and skip the tool invocation entirely.

**Correct**: iterate `response.candidates[0].content.parts` and branch
on `part.function_call` vs `part.text`.

### N.2 Always pass `AutomaticFunctionCallingConfig(disable=True)` when the runtime owns the loop

The Python `google-genai` SDK's default is to *auto-execute* Python
callables you pass as tools. That bypasses every guard, hook, and log
we rely on. When the runtime owns the loop, this MUST be disabled.

### N.3 Preserve `function_call.id` in `function_response`

Gemini 3 generates a unique `id` for every function call and uses it to
map responses back to the originating call. Omitting it works for
single-tool turns but breaks parallel/compositional calling and
corrupts thought signature context on the next turn.

### N.4 Do not split or merge parts that carry a `thought_signature`

Gemini 3 embeds thought signatures in arbitrary parts of the assistant
content. The documented rule set (Function Calling §497-504) forbids
splitting a signature-carrying part from its neighbours or merging two
signatures. The safest path is to treat the whole `content` object as
opaque and re-inject it verbatim on the next turn.

### N.5 Ollama does not support tool calling in Sub-project A

The `OllamaProvider.generate_with_tools` stub raises
`ToolCallingNotSupported`. Routing a tool-requiring agent to
`LLM_PROVIDER=ollama` must fail fast at
`Agent.run_with_tools` with a clear message — do not silently fall back
to text-only generation.
```

- [ ] **Step 2: Append tool-loop route to api-contract**

Open `docs/architecture/api-contract.md`. Under the agent activity
section (find existing agent activity signature), append:

```markdown

### `run_tool_loop` activity (Agent Runtime v2 · A)

```python
@activity.defn
async def run_tool_loop(
    workspace_id: str,
    project_id: str | None,
    user_id: str,
    run_id: str,
    user_prompt: str,
    tool_names: list[str],
    agent_preset: Literal["plain", "reference", "external", "full"],
) -> LoopResult:
    ...
```

Implementation lives in `apps/worker/src/runtime/tool_loop.py`. A single
activity == a single loop, bounded by `LoopConfig.max_turns`,
`max_tool_calls`, `max_total_input_tokens`, and per-tool timeouts.
```

- [ ] **Step 3: Append tool path budget to context-budget**

Open `docs/architecture/context-budget.md`. Add a new subsection:

```markdown

## Tool path token budgets (Sub-project A)

Each retrieval tool returns a bounded response by design so the loop
does not blow the workspace's input token budget:

| Tool | Mode | Max output chars | Approx tokens |
|------|------|-------------------|---------------|
| `list_project_topics` | — | ~2 KB | ~500 |
| `search_concepts` (k=5) | synopsis | ~4 KB | ~1k |
| `search_notes` (k=5, synopsis) | snippet ≤ 400 ch each | ~2 KB | ~500 |
| `search_notes` (k=5, full) | chunk full | ~10 KB | ~2.5k |
| `read_note` | — | 50 KB | ~12k |
| `fetch_url` | — | 50 KB | ~12k |
| `emit_structured_output` | — | ~1 KB | ~250 |

For synopsis-only paths the single-turn input stays under ~15k tokens
excluding user prompt and wiki root, matching the "long-context <200k /
hybrid" policy.
```

- [ ] **Step 4: Commit doc updates**

```bash
git add docs/contributing/llm-antipatterns.md \
        docs/architecture/api-contract.md \
        docs/architecture/context-budget.md
git commit -m "docs: Gemini tool calling antipatterns + tool path budget"
```

---

### Task 24: Mark Sub-A done in Umbrella + final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-04-22-agent-runtime-v2-umbrella.md`

- [ ] **Step 1: Run entire test suite one last time**

```bash
cd packages/llm && pytest -v
cd apps/worker && pytest -v --ignore=tests/integration
```

Expected: all green. Integration tests skipped unless `GEMINI_API_KEY_CI` provided.

- [ ] **Step 2: Update Umbrella sub-project A status**

In `docs/superpowers/specs/2026-04-22-agent-runtime-v2-umbrella.md`, find the A row in the Sub-project Map table and change:

From:
```markdown
| **A** | Core Tool-Use Loop | ... | 없음 | 📘 planned | `2026-04-22-agent-runtime-v2a-core-tool-loop-design.md` |
```

To:
```markdown
| **A** | Core Tool-Use Loop | ... | 없음 | ✅ done | `2026-04-22-agent-runtime-v2a-core-tool-loop-design.md` |
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-22-agent-runtime-v2-umbrella.md
git commit -m "docs: mark agent runtime v2 sub-project A done"
```

- [ ] **Step 4: Verify final state**

```bash
git log --oneline -30
pnpm --filter @opencairn/api test
cd apps/worker && pytest -v --ignore=tests/integration
cd packages/llm && pytest -v
```

All three test suites green. Sub-project A complete.

---

## Self-Review Checklist (executed by author)

1. **Spec coverage**
   - §1.3 success criteria: Tasks 3-7 (provider contract), 8-12 (runtime), 13-18 (tools), 20 (ToolDemoAgent), 21+22 (tests). ✓
   - §2 constraints: env-only (Task 4 stub), BYOK no-block (Task 8 NullBudgetPolicy), workspace isolation (Tasks 18, 22), `generate()` unchanged (no task touches it), Temporal boundary (entire plan), capability guard (Tasks 4-5), tools server-only (no API exposure added). ✓
   - §4 tools: list_project_topics (16), search_concepts (16), search_notes (17), read_note (17), fetch_url (14), emit_structured_output (13). `get_concept_graph` deferred to B per reconciliation. ✓
   - §5 executor: dataclasses (8), core loop (9), hard guards (10), soft guards (11), termination paths (12). ✓
   - §6 provider contract: tool_types (1), errors (2), base (3), Ollama stub (4), Gemini decls (5), Gemini generate (6), Gemini tool_result_to_message (7). ✓
   - §7 tests + docs + rollout: Tasks 13-22 TDD throughout, 21 integration, 22 security, 23 docs, 24 wrap. ✓

2. **Placeholder scan** — zero "TBD" / "implement later" in task bodies. Spec-reconciliation `get_concept_graph` deferral is explicit, not a placeholder. ✓

3. **Type consistency**
   - `ToolUse`/`ToolResult`/`AssistantTurn`/`UsageCounts` defined in Task 1, referenced identically in Tasks 6-12. ✓
   - `LoopConfig` fields defined in Task 8 used consistently in Tasks 10-12. ✓
   - `ToolContext` fields (workspace_id/project_id/page_id/user_id/run_id/scope/emit) match `runtime.tools.ToolContext` existing class. ✓

4. **Ambiguity** — `_truncate` placeholder in Task 9 is intentionally simple; Task 11 upgrades to async-timeout path. No silent regression. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-agent-runtime-v2a-core-tool-loop.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Works well for this plan because each task has clean TDD-shaped steps and minimal cross-task context.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

**Which approach?**
