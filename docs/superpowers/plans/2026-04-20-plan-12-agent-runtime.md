# Plan 12: Agent Runtime Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/worker/src/runtime/` — a thin facade over LangGraph + langchain-core that enforces a single contract (Tool, AgentEvent, Agent, Hook, Trajectory, Eval) for all 12 OpenCairn AI agents to implement against.

**Architecture:** Pure-Python module tree with 9 sub-modules (events, tools, hooks, agent, reducers, trajectory, temporal, eval, __init__). LangGraph/langchain-core are internal dependencies — 12 agents only import `from runtime import ...`. Trajectory writes to Postgres summary row + NDJSON stream (local filesystem by default, MinIO/S3 opt-in).

**Tech Stack:** Python 3.12, uv, LangGraph 0.3, langchain-core, Pydantic v2, xxhash, asyncpg (for trajectory summary), langgraph-checkpoint-postgres, pytest + pytest-asyncio, temporalio SDK

**Blocks:** Plan 4 (Agent Core), Plan 5 (Knowledge Graph Task M1 Visualization agent), Plan 6 (Socratic), Plan 7 (Canvas/Code agent), Plan 8 (remaining 6 agents)

**Prerequisite plans:** Plan 1 (Foundation — `packages/db`, workspaces schema, DATABASE_URL env), Plan 13 (`packages/llm`)

**Spec:** `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md`

---

## File Structure

```
apps/worker/
  pyproject.toml                          -- uv + Python 3.12, deps, TWO packages (worker, runtime)
  .python-version                         -- 3.12
  uv.lock                                 -- generated
  .env.example                            -- TRAJECTORY_BACKEND, TRAJECTORY_DIR, DATABASE_URL, etc.
  Dockerfile                              -- stub (full version in Plan 4 Task 9)

  src/
    runtime/
      __init__.py                         -- public API (exports)
      events.py                           -- 9 AgentEvent Pydantic models + Union
      tools.py                            -- @tool decorator, ToolContext, Tool Protocol, registry
      tool_declarations.py                -- Gemini/Ollama schema builders
      hooks.py                            -- AgentHook/ModelHook/ToolHook ABCs, HookRegistry, HookChain
      agent.py                            -- Agent ABC, stream_graph_as_events adapter
      reducers.py                         -- keep_last_n LangGraph reducer
      trajectory.py                       -- TrajectoryWriter, TrajectoryStorage Protocol, LocalFSTrajectoryStorage
      trajectory_s3.py                    -- S3TrajectoryStorage (opt-in)
      default_hooks.py                    -- TrajectoryWriterHook, TokenCounterHook, SentryHook, LatencyHook
      langgraph_bridge.py                 -- single BaseCallbackHandler that delegates to HookChain
      temporal.py                         -- make_thread_id, AgentAwaitingInputError
      eval/
        __init__.py
        case.py                           -- EvalCase, ExpectedToolCall, ExpectedHandoff
        metrics.py                        -- trajectory/handoff/forbidden/cost/duration scorers
        runner.py                         -- AgentEvaluator, EvalResult, pytest helper
        loader.py                         -- YAML case loader

    worker/
      __init__.py                         -- app package (Plan 4 fills in)

  tests/
    runtime/
      conftest.py                         -- db fixture, fake_ctx fixture
      test_events.py
      test_tools.py
      test_tool_declarations.py
      test_hooks.py
      test_agent.py
      test_reducers.py
      test_trajectory_local.py
      test_default_hooks.py
      test_temporal_helpers.py
      test_langgraph_bridge.py
      test_eval_case.py
      test_eval_metrics.py
      test_eval_runner.py
      test_integration_echo_agent.py      -- end-to-end smoke

packages/shared/src/agent-events.ts       -- Zod mirror of events.py
packages/db/src/schema/agent-runs.ts      -- Drizzle schema for agent_runs table
packages/db/drizzle/<timestamp>_agent_runs.sql  -- migration
```

---

## Task 0: Prerequisites Verification (BLOCKING)

**Files:** none (verification only)

- [x] **Step 1: Verify Plan 1 completion**

Run:
```bash
ls packages/db/src/schema/workspaces.ts packages/db/src/schema/users.ts 2>&1
grep -l "DATABASE_URL" .env.example
```
Expected: files exist + grep matches. If not → STOP, complete Plan 1 first.

- [x] **Step 2: Verify Plan 13 (multi-llm) completion**

Run:
```bash
test -f packages/llm/src/llm/__init__.py && test -f packages/llm/src/llm/base.py && echo OK
cd packages/llm && uv run python -c "from llm import get_provider; print('OK')"
cd ../..
```
Expected: "OK" printed twice. If not → STOP, complete Plan 13 first.

- [x] **Step 3: Verify tooling**

Run:
```bash
uv --version
python --version
```
Expected: `uv 0.4+`, Python accessible. If `uv` missing: `pip install uv` or follow `docs/contributing/dev-guide.md`.

- [x] **Step 4: Review spec**

Read `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md` end-to-end. Confirm mental model matches:
- 9 AgentEvent types
- thin facade over LangGraph
- Postgres summary + NDJSON stream
- thread_id = `{workflow_id}:{agent_name}` OR `{parent_run_id}:{agent_name}`
- HITL via Temporal signal (no LangGraph interrupt across activity boundary)

---

## Task 1: apps/worker Scaffolding + Runtime Package Skeleton

**Files:**
- Create: `apps/worker/pyproject.toml`
- Create: `apps/worker/.python-version`
- Create: `apps/worker/.env.example`
- Create: `apps/worker/src/runtime/__init__.py`
- Create: `apps/worker/src/worker/__init__.py`
- Create: `apps/worker/tests/runtime/__init__.py`
- Create: `apps/worker/tests/runtime/conftest.py`
- Modify: root `pnpm-workspace.yaml` (if exists from Plan 1) — no changes needed for Python apps, but verify

- [x] **Step 1: Create `apps/worker/pyproject.toml`**

```toml
[project]
name = "opencairn-worker"
version = "0.1.0"
description = "OpenCairn Python worker: Temporal + LangGraph agent runtime"
requires-python = ">=3.12,<3.13"
dependencies = [
    "langgraph>=0.3.0,<0.4",
    "langgraph-checkpoint-postgres>=2.0.0",
    "langchain-core>=0.3.0,<0.4",
    "temporalio>=1.8.0",
    "pydantic>=2.6.0",
    "pydantic-settings>=2.2.0",
    "xxhash>=3.4.0",
    "asyncpg>=0.29.0",
    "pyyaml>=6.0",
    "opencairn-llm",
]

[project.optional-dependencies]
s3 = ["aioboto3>=12.0.0"]
sentry = ["sentry-sdk>=2.0.0"]
otel = ["opentelemetry-api>=1.25.0", "opentelemetry-sdk>=1.25.0"]

[tool.uv.sources]
opencairn-llm = { path = "../../packages/llm" }

[dependency-groups]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "pytest-cov>=5.0",
    "ruff>=0.5.0",
    "pyright>=1.1.360",
    "testcontainers[postgres]>=4.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/runtime", "src/worker"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "SIM", "TCH"]
ignore = []

[tool.pyright]
include = ["src", "tests"]
pythonVersion = "3.12"
strict = ["src/runtime"]
```

- [x] **Step 2: Create `apps/worker/.python-version`**

```
3.12
```

- [x] **Step 3: Create `apps/worker/.env.example`**

```bash
# Database (inherits from Plan 1)
DATABASE_URL=postgresql://opencairn:opencairn@localhost:5432/opencairn

# LangGraph checkpoint schema (isolated from app tables)
LANGGRAPH_CHECKPOINT_SCHEMA=langgraph_checkpoints

# Trajectory storage
TRAJECTORY_BACKEND=local
TRAJECTORY_DIR=/var/lib/opencairn/trajectories
TRAJECTORY_RETENTION_DAYS=30
# TRAJECTORY_BACKEND=s3 alternative:
# S3_ENDPOINT=
# S3_BUCKET=opencairn-trajectories
# S3_ACCESS_KEY=
# S3_SECRET_KEY=

# Optional observability
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

- [x] **Step 4: Create empty package files**

Write empty files with only a docstring:

`apps/worker/src/runtime/__init__.py`:
```python
"""OpenCairn agent runtime — thin facade over LangGraph + langchain-core.

12 agents import only from this module. Direct imports of langgraph or
langchain_core from apps/worker/src/worker/agents/ are forbidden (see lint rule in Task 16).
"""
```

`apps/worker/src/worker/__init__.py`:
```python
"""OpenCairn Python worker — Temporal activities and workflows (filled in Plan 4)."""
```

`apps/worker/tests/runtime/__init__.py`: empty file.

- [x] **Step 5: Create `apps/worker/tests/runtime/conftest.py`**

```python
"""Shared fixtures for runtime tests."""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest


@pytest.fixture
def tmp_trajectory_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated trajectory dir per test."""
    d = tmp_path / "trajectories"
    d.mkdir()
    monkeypatch.setenv("TRAJECTORY_BACKEND", "local")
    monkeypatch.setenv("TRAJECTORY_DIR", str(d))
    return d
```

- [x] **Step 6: Install and verify imports**

Run:
```bash
cd apps/worker && uv sync && uv run python -c "import runtime; import worker; print('OK')"
```
Expected: "OK" printed. If `opencairn-llm` path resolution fails, verify `packages/llm/pyproject.toml` exists.

- [x] **Step 7: Commit**

```bash
git add apps/worker/pyproject.toml apps/worker/.python-version apps/worker/.env.example apps/worker/src/runtime/__init__.py apps/worker/src/worker/__init__.py apps/worker/tests/runtime/__init__.py apps/worker/tests/runtime/conftest.py apps/worker/uv.lock
git commit -m "chore(worker): scaffold apps/worker with runtime + worker packages"
```

---

## Task 2: AgentEvent Pydantic Models

**Files:**
- Create: `apps/worker/src/runtime/events.py`
- Create: `apps/worker/tests/runtime/test_events.py`

- [x] **Step 1: Write the failing test (`tests/runtime/test_events.py`)**

```python
"""AgentEvent model tests — construction, serialization, discriminated union parsing."""
from __future__ import annotations

import json

import pytest
from pydantic import TypeAdapter, ValidationError

from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    AwaitingInput,
    CustomEvent,
    Handoff,
    ModelEnd,
    ToolResult,
    ToolUse,
)


BASE = {"run_id": "r1", "workspace_id": "w1", "agent_name": "test", "seq": 0, "ts": 1700000000.0}


def test_agent_start_roundtrip() -> None:
    ev = AgentStart(**BASE, type="agent_start", scope="page", input={"q": "hi"})
    raw = ev.model_dump_json()
    parsed = TypeAdapter(AgentEvent).validate_json(raw)
    assert isinstance(parsed, AgentStart)
    assert parsed.scope == "page"


def test_agent_end_duration() -> None:
    ev = AgentEnd(**BASE, type="agent_end", output={"answer": "x"}, duration_ms=1234)
    assert ev.duration_ms == 1234


def test_model_end_cost() -> None:
    ev = ModelEnd(
        **BASE,
        type="model_end",
        model_id="gemini-3-pro",
        prompt_tokens=100,
        completion_tokens=50,
        cached_tokens=0,
        cost_krw=12,
        finish_reason="stop",
        latency_ms=800,
    )
    assert ev.cost_krw == 12


def test_tool_use_hash_is_string() -> None:
    ev = ToolUse(
        **BASE,
        type="tool_use",
        tool_call_id="call-1",
        tool_name="search_pages",
        input_args={"query": "test"},
        input_hash="abc123",
        concurrency_safe=True,
    )
    assert ev.input_hash == "abc123"


def test_tool_result_matches_use() -> None:
    ev = ToolResult(
        **BASE,
        type="tool_result",
        tool_call_id="call-1",
        ok=True,
        output=[{"id": "p1"}],
        duration_ms=42,
    )
    assert ev.ok is True


def test_handoff_has_child_run_id() -> None:
    ev = Handoff(
        **BASE,
        type="handoff",
        from_agent="compiler",
        to_agent="research",
        child_run_id="r2",
        scope="project",
        reason="page search needed",
    )
    assert ev.to_agent == "research"


def test_awaiting_input_has_interrupt_id() -> None:
    ev = AwaitingInput(
        **BASE,
        type="awaiting_input",
        interrupt_id="int-1",
        prompt="Approve?",
        schema=None,
    )
    assert ev.interrupt_id == "int-1"


def test_agent_error_retryable_flag() -> None:
    ev = AgentError(
        **BASE,
        type="agent_error",
        error_class="ToolTimeout",
        message="search timed out",
        retryable=True,
    )
    assert ev.retryable is True


def test_custom_event_label() -> None:
    ev = CustomEvent(**BASE, type="custom", label="progress", payload={"pct": 50})
    assert ev.label == "progress"


def test_discriminator_rejects_unknown_type() -> None:
    bad = json.dumps({**BASE, "type": "nonexistent"})
    with pytest.raises(ValidationError):
        TypeAdapter(AgentEvent).validate_json(bad)


def test_seq_monotonic_not_enforced_at_model_level() -> None:
    """seq is monotonic by convention; the model itself doesn't enforce sequencing."""
    ev1 = AgentStart(**{**BASE, "seq": 5}, type="agent_start", scope="page", input={})
    ev2 = AgentEnd(**{**BASE, "seq": 3}, type="agent_end", output={}, duration_ms=1)
    assert ev1.seq == 5
    assert ev2.seq == 3
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_events.py -v`
Expected: ImportError — `runtime.events` does not exist.

- [x] **Step 3: Implement `src/runtime/events.py`**

```python
"""AgentEvent schema — 9 event types + discriminated union.

All events flow through hooks and land in NDJSON trajectory + Postgres summary.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field


class BaseEvent(BaseModel):
    """Common fields on every event. seq is monotonic per run_id."""

    run_id: str
    workspace_id: str
    agent_name: str
    seq: int
    ts: float
    parent_seq: int | None = None


Scope = Literal["page", "project", "workspace"]


class AgentStart(BaseEvent):
    type: Literal["agent_start"] = "agent_start"
    scope: Scope
    input: dict[str, Any]
    parent_run_id: str | None = None


class AgentEnd(BaseEvent):
    type: Literal["agent_end"] = "agent_end"
    output: dict[str, Any]
    duration_ms: int


class AgentError(BaseEvent):
    type: Literal["agent_error"] = "agent_error"
    error_class: str
    message: str
    retryable: bool


class ModelEnd(BaseEvent):
    type: Literal["model_end"] = "model_end"
    model_id: str
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int = 0
    cost_krw: int
    finish_reason: str
    latency_ms: int


class ToolUse(BaseEvent):
    type: Literal["tool_use"] = "tool_use"
    tool_call_id: str
    tool_name: str
    input_args: dict[str, Any]
    input_hash: str
    concurrency_safe: bool


class ToolResult(BaseEvent):
    type: Literal["tool_result"] = "tool_result"
    tool_call_id: str
    ok: bool
    output: Any
    duration_ms: int
    cached: bool = False


class Handoff(BaseEvent):
    type: Literal["handoff"] = "handoff"
    from_agent: str
    to_agent: str
    child_run_id: str
    scope: Scope
    reason: str


class AwaitingInput(BaseEvent):
    type: Literal["awaiting_input"] = "awaiting_input"
    interrupt_id: str
    prompt: str
    schema: dict[str, Any] | None = None


class CustomEvent(BaseEvent):
    type: Literal["custom"] = "custom"
    label: str
    payload: dict[str, Any]


AgentEvent = Annotated[
    Union[
        AgentStart,
        AgentEnd,
        AgentError,
        ModelEnd,
        ToolUse,
        ToolResult,
        Handoff,
        AwaitingInput,
        CustomEvent,
    ],
    Field(discriminator="type"),
]


__all__ = [
    "AgentEnd",
    "AgentError",
    "AgentEvent",
    "AgentStart",
    "AwaitingInput",
    "BaseEvent",
    "CustomEvent",
    "Handoff",
    "ModelEnd",
    "Scope",
    "ToolResult",
    "ToolUse",
]
```

- [x] **Step 4: Update `src/runtime/__init__.py` exports**

Replace the contents:
```python
"""OpenCairn agent runtime — thin facade over LangGraph + langchain-core."""
from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    AwaitingInput,
    CustomEvent,
    Handoff,
    ModelEnd,
    Scope,
    ToolResult,
    ToolUse,
)

__all__ = [
    "AgentEnd",
    "AgentError",
    "AgentEvent",
    "AgentStart",
    "AwaitingInput",
    "CustomEvent",
    "Handoff",
    "ModelEnd",
    "Scope",
    "ToolResult",
    "ToolUse",
]
```

- [x] **Step 5: Run tests to verify they pass**

Run: `cd apps/worker && uv run pytest tests/runtime/test_events.py -v`
Expected: all 10 tests PASS.

- [x] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/events.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_events.py
git commit -m "feat(worker): add AgentEvent schema (9 types, discriminated union)"
```

---

## Task 3: Wire Format — Zod Schemas (TS side)

**Files:**
- Create: `packages/shared/src/agent-events.ts`
- Create: `packages/shared/tests/agent-events.test.ts`

- [x] **Step 1: Write the failing test (`tests/agent-events.test.ts`)**

```typescript
import { describe, expect, test } from "vitest";
import { AgentEventSchema, type AgentEvent } from "../src/agent-events";

const BASE = {
  run_id: "r1",
  workspace_id: "w1",
  agent_name: "test",
  seq: 0,
  ts: 1700000000.0,
  parent_seq: null,
};

describe("AgentEventSchema", () => {
  test("parses agent_start", () => {
    const raw = { ...BASE, type: "agent_start", scope: "page", input: { q: "hi" }, parent_run_id: null };
    const parsed = AgentEventSchema.parse(raw);
    expect(parsed.type).toBe("agent_start");
  });

  test("parses model_end with cost", () => {
    const raw = {
      ...BASE,
      type: "model_end",
      model_id: "gemini-3-pro",
      prompt_tokens: 100,
      completion_tokens: 50,
      cached_tokens: 0,
      cost_krw: 12,
      finish_reason: "stop",
      latency_ms: 800,
    };
    const parsed = AgentEventSchema.parse(raw);
    if (parsed.type === "model_end") {
      expect(parsed.cost_krw).toBe(12);
    } else {
      throw new Error("wrong discriminator");
    }
  });

  test("rejects unknown type", () => {
    expect(() => AgentEventSchema.parse({ ...BASE, type: "bogus" })).toThrow();
  });

  test("all 9 types have schemas", () => {
    const types: AgentEvent["type"][] = [
      "agent_start",
      "agent_end",
      "agent_error",
      "model_end",
      "tool_use",
      "tool_result",
      "handoff",
      "awaiting_input",
      "custom",
    ];
    expect(types).toHaveLength(9);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/shared test agent-events`
Expected: Module not found — `agent-events.ts` does not exist.

- [x] **Step 3: Implement `packages/shared/src/agent-events.ts`**

```typescript
import { z } from "zod";

const baseFields = {
  run_id: z.string(),
  workspace_id: z.string(),
  agent_name: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
  parent_seq: z.number().int().nullable(),
};

export const ScopeSchema = z.enum(["page", "project", "workspace"]);
export type Scope = z.infer<typeof ScopeSchema>;

export const AgentStartSchema = z.object({
  ...baseFields,
  type: z.literal("agent_start"),
  scope: ScopeSchema,
  input: z.record(z.unknown()),
  parent_run_id: z.string().nullable(),
});

export const AgentEndSchema = z.object({
  ...baseFields,
  type: z.literal("agent_end"),
  output: z.record(z.unknown()),
  duration_ms: z.number().int().nonnegative(),
});

export const AgentErrorSchema = z.object({
  ...baseFields,
  type: z.literal("agent_error"),
  error_class: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const ModelEndSchema = z.object({
  ...baseFields,
  type: z.literal("model_end"),
  model_id: z.string(),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  cached_tokens: z.number().int().nonnegative().default(0),
  cost_krw: z.number().int().nonnegative(),
  finish_reason: z.string(),
  latency_ms: z.number().int().nonnegative(),
});

export const ToolUseSchema = z.object({
  ...baseFields,
  type: z.literal("tool_use"),
  tool_call_id: z.string(),
  tool_name: z.string(),
  input_args: z.record(z.unknown()),
  input_hash: z.string(),
  concurrency_safe: z.boolean(),
});

export const ToolResultSchema = z.object({
  ...baseFields,
  type: z.literal("tool_result"),
  tool_call_id: z.string(),
  ok: z.boolean(),
  output: z.unknown(),
  duration_ms: z.number().int().nonnegative(),
  cached: z.boolean().default(false),
});

export const HandoffSchema = z.object({
  ...baseFields,
  type: z.literal("handoff"),
  from_agent: z.string(),
  to_agent: z.string(),
  child_run_id: z.string(),
  scope: ScopeSchema,
  reason: z.string(),
});

export const AwaitingInputSchema = z.object({
  ...baseFields,
  type: z.literal("awaiting_input"),
  interrupt_id: z.string(),
  prompt: z.string(),
  schema: z.record(z.unknown()).nullable(),
});

export const CustomEventSchema = z.object({
  ...baseFields,
  type: z.literal("custom"),
  label: z.string(),
  payload: z.record(z.unknown()),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  AgentStartSchema,
  AgentEndSchema,
  AgentErrorSchema,
  ModelEndSchema,
  ToolUseSchema,
  ToolResultSchema,
  HandoffSchema,
  AwaitingInputSchema,
  CustomEventSchema,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @opencairn/shared test agent-events`
Expected: 4 tests PASS.

- [x] **Step 5: Commit**

```bash
git add packages/shared/src/agent-events.ts packages/shared/tests/agent-events.test.ts
git commit -m "feat(shared): add AgentEvent Zod schema mirroring Python runtime"
```

---

## Task 4: ToolContext, Tool Protocol, @tool Decorator

**Files:**
- Create: `apps/worker/src/runtime/tools.py`
- Create: `apps/worker/tests/runtime/test_tools.py`

- [x] **Step 1: Write the failing test**

```python
"""Tests for @tool decorator and ToolContext auto-injection."""
from __future__ import annotations

from typing import Any

import pytest

from runtime.events import AgentEvent
from runtime.tools import (
    Tool,
    ToolContext,
    get_tool,
    get_tools_for_agent,
    hash_input,
    tool,
)


async def _noop_emit(_ev: AgentEvent) -> None:
    pass


@pytest.fixture
def fake_ctx() -> ToolContext:
    return ToolContext(
        workspace_id="w1",
        project_id="p1",
        page_id=None,
        user_id="u1",
        run_id="r1",
        scope="project",
        emit=_noop_emit,
    )


async def test_tool_decorator_creates_tool(fake_ctx: ToolContext) -> None:
    @tool()
    async def echo(msg: str, ctx: ToolContext) -> str:
        """Returns msg unchanged."""
        return msg

    assert isinstance(echo, Tool)
    assert echo.name == "echo"
    assert "Returns msg unchanged" in echo.description
    result = await echo.run({"msg": "hi"}, fake_ctx)
    assert result == "hi"


async def test_tool_context_excluded_from_schema() -> None:
    @tool()
    async def search(query: str, limit: int, ctx: ToolContext) -> list[str]:
        """Search things."""
        return [query] * limit

    schema = search.input_schema()
    assert "ctx" not in schema["properties"]
    assert "query" in schema["properties"]
    assert "limit" in schema["properties"]


async def test_supports_parallel_static_true() -> None:
    @tool(parallel=True)
    async def read_only_op(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    assert read_only_op.supports_parallel({"x": 1}) is True


async def test_supports_parallel_dynamic() -> None:
    @tool(parallel=lambda args: args.get("read_only", False))
    async def bash_like(cmd: str, read_only: bool, ctx: ToolContext) -> str:
        """."""
        return cmd

    assert bash_like.supports_parallel({"cmd": "ls", "read_only": True}) is True
    assert bash_like.supports_parallel({"cmd": "rm -rf /", "read_only": False}) is False


async def test_supports_parallel_default_false() -> None:
    @tool()
    async def default_op(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    assert default_op.supports_parallel({"x": 1}) is False


async def test_redact_fields(fake_ctx: ToolContext) -> None:
    @tool(redact_fields=("api_key",))
    async def fetch(url: str, api_key: str, ctx: ToolContext) -> str:
        """."""
        return url

    redacted = fetch.redact({"url": "https://x", "api_key": "secret"})
    assert redacted == {"url": "https://x", "api_key": "[REDACTED]"}


async def test_registry_lookup() -> None:
    @tool(name="unique_one")
    async def some_tool(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    assert get_tool("unique_one") is some_tool


async def test_registry_duplicate_raises() -> None:
    @tool(name="dup_test_tool")
    async def a(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    with pytest.raises(ValueError, match="already registered"):

        @tool(name="dup_test_tool")
        async def b(x: int, ctx: ToolContext) -> int:
            """."""
            return x


async def test_hash_input_deterministic() -> None:
    h1 = hash_input({"a": 1, "b": 2})
    h2 = hash_input({"b": 2, "a": 1})
    assert h1 == h2  # key order independent
    assert len(h1) == 16  # xxhash64 hex


async def test_get_tools_for_agent_filters_by_scope(fake_ctx: ToolContext) -> None:
    @tool(name="page_only_tool", allowed_agents=("research",), allowed_scopes=("page",))
    async def t(x: int, ctx: ToolContext) -> int:
        """."""
        return x

    assert t in get_tools_for_agent("research", "page")
    assert t not in get_tools_for_agent("research", "project")
    assert t not in get_tools_for_agent("compiler", "page")
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_tools.py -v`
Expected: ImportError on `runtime.tools`.

- [x] **Step 3: Implement `src/runtime/tools.py`**

```python
"""Tool system — @tool decorator, ToolContext, registry."""
from __future__ import annotations

import inspect
import json
from collections.abc import Awaitable, Callable
from typing import Any, Protocol, get_type_hints, runtime_checkable

import xxhash
from pydantic import BaseModel, ConfigDict, create_model

from runtime.events import AgentEvent, Scope


class ToolContext(BaseModel):
    """Runtime injects this per invocation. Excluded from tool input schema."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    workspace_id: str
    project_id: str | None
    page_id: str | None
    user_id: str
    run_id: str
    scope: Scope
    emit: Callable[[AgentEvent], Awaitable[None]]


@runtime_checkable
class Tool(Protocol):
    name: str
    description: str
    allowed_agents: tuple[str, ...]  # empty tuple = all agents
    allowed_scopes: tuple[Scope, ...]  # empty tuple = all scopes

    def supports_parallel(self, args: dict[str, Any]) -> bool: ...
    def input_schema(self) -> dict[str, Any]: ...
    def redact(self, args: dict[str, Any]) -> dict[str, Any]: ...
    async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any: ...


_REGISTRY: dict[str, Tool] = {}


def get_tool(name: str) -> Tool:
    return _REGISTRY[name]


def get_tools_for_agent(agent_name: str, scope: Scope) -> list[Tool]:
    out: list[Tool] = []
    for t in _REGISTRY.values():
        if t.allowed_agents and agent_name not in t.allowed_agents:
            continue
        if t.allowed_scopes and scope not in t.allowed_scopes:
            continue
        out.append(t)
    return out


def hash_input(args: dict[str, Any]) -> str:
    """Stable 64-bit hex hash of args (key-order independent)."""
    canonical = json.dumps(args, sort_keys=True, default=str)
    return xxhash.xxh64(canonical.encode()).hexdigest()


def _build_input_model(func: Callable[..., Any], excluded_params: set[str]) -> type[BaseModel]:
    """Build a Pydantic model from function signature, excluding ToolContext params."""
    hints = get_type_hints(func)
    sig = inspect.signature(func)
    fields: dict[str, Any] = {}
    for name, param in sig.parameters.items():
        if name in excluded_params or name == "return":
            continue
        annotation = hints.get(name, Any)
        default = param.default if param.default is not inspect.Parameter.empty else ...
        fields[name] = (annotation, default)
    model = create_model(f"{func.__name__}_Input", **fields)  # type: ignore[call-overload]
    return model


def _find_context_params(func: Callable[..., Any]) -> set[str]:
    hints = get_type_hints(func)
    return {name for name, t in hints.items() if t is ToolContext}


def tool(
    *,
    name: str | None = None,
    parallel: bool | Callable[[dict[str, Any]], bool] = False,
    redact_fields: tuple[str, ...] = (),
    allowed_agents: tuple[str, ...] = (),
    allowed_scopes: tuple[Scope, ...] = (),
) -> Callable[[Callable[..., Awaitable[Any]]], Tool]:
    """Decorate an async function to register it as a Tool.

    - Function signature → Pydantic input schema (ToolContext params excluded)
    - Docstring first paragraph → description
    - `parallel`: bool for static, callable(args) -> bool for dynamic
    - `redact_fields`: field names replaced with "[REDACTED]" in trajectory
    - `allowed_agents`: tuple of agent names that can use this tool (empty = all)
    - `allowed_scopes`: scope whitelist
    """

    def decorator(func: Callable[..., Awaitable[Any]]) -> Tool:
        tool_name = name or func.__name__
        if tool_name in _REGISTRY:
            raise ValueError(f"Tool '{tool_name}' already registered")

        doc = inspect.getdoc(func) or ""
        description = doc.split("\n\n", 1)[0].strip() or tool_name

        ctx_params = _find_context_params(func)
        input_model = _build_input_model(func, excluded_params=ctx_params)

        class _ConcreteTool:
            def __init__(self) -> None:
                self.name = tool_name
                self.description = description
                self.allowed_agents = allowed_agents
                self.allowed_scopes = allowed_scopes
                self._input_model = input_model
                self._ctx_params = ctx_params
                self._func = func
                self._parallel_spec = parallel
                self._redact_fields = redact_fields

            def supports_parallel(self, args: dict[str, Any]) -> bool:
                if callable(self._parallel_spec):
                    return bool(self._parallel_spec(args))
                return bool(self._parallel_spec)

            def input_schema(self) -> dict[str, Any]:
                return self._input_model.model_json_schema()

            def redact(self, args: dict[str, Any]) -> dict[str, Any]:
                if not self._redact_fields:
                    return dict(args)
                return {k: ("[REDACTED]" if k in self._redact_fields else v) for k, v in args.items()}

            async def run(self, args: dict[str, Any], ctx: ToolContext) -> Any:
                validated = self._input_model.model_validate(args)
                kwargs = validated.model_dump()
                for p in self._ctx_params:
                    kwargs[p] = ctx
                return await self._func(**kwargs)

        concrete = _ConcreteTool()
        _REGISTRY[tool_name] = concrete
        return concrete  # type: ignore[return-value]

    return decorator


def _clear_registry_for_tests() -> None:
    """TEST ONLY — reset the registry between tests."""
    _REGISTRY.clear()


__all__ = [
    "Tool",
    "ToolContext",
    "_clear_registry_for_tests",
    "get_tool",
    "get_tools_for_agent",
    "hash_input",
    "tool",
]
```

- [x] **Step 4: Update `conftest.py` to clear registry between tests**

Edit `apps/worker/tests/runtime/conftest.py`:

```python
"""Shared fixtures for runtime tests."""
from __future__ import annotations

from pathlib import Path

import pytest

from runtime.tools import _clear_registry_for_tests


@pytest.fixture(autouse=True)
def _reset_tool_registry() -> None:
    _clear_registry_for_tests()
    yield
    _clear_registry_for_tests()


@pytest.fixture
def tmp_trajectory_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    d = tmp_path / "trajectories"
    d.mkdir()
    monkeypatch.setenv("TRAJECTORY_BACKEND", "local")
    monkeypatch.setenv("TRAJECTORY_DIR", str(d))
    return d
```

- [x] **Step 5: Update `runtime/__init__.py` exports**

Append to imports:
```python
from runtime.tools import Tool, ToolContext, get_tool, get_tools_for_agent, hash_input, tool
```

And to `__all__`:
```python
    "Tool",
    "ToolContext",
    "get_tool",
    "get_tools_for_agent",
    "hash_input",
    "tool",
```

- [x] **Step 6: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/test_tools.py tests/runtime/test_events.py -v`
Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add apps/worker/src/runtime/tools.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_tools.py apps/worker/tests/runtime/conftest.py
git commit -m "feat(worker): add @tool decorator with auto-schema and registry"
```

---

## Task 5: Provider-specific Tool Declaration Builders

**Files:**
- Create: `apps/worker/src/runtime/tool_declarations.py`
- Create: `apps/worker/tests/runtime/test_tool_declarations.py`
- Modify: `packages/llm/src/llm/base.py` — add `build_tool_declarations` method

- [x] **Step 1: Write the failing test**

```python
"""Tests for Gemini/Ollama tool schema builders."""
from __future__ import annotations

from runtime.tool_declarations import build_gemini_declarations, build_ollama_declarations
from runtime.tools import ToolContext, tool


async def test_gemini_declaration_shape() -> None:
    @tool()
    async def search_pages(query: str, limit: int, ctx: ToolContext) -> list[str]:
        """Search pages by keyword."""
        return [query] * limit

    decls = build_gemini_declarations([search_pages])
    assert len(decls) == 1
    fd = decls[0]
    assert fd["name"] == "search_pages"
    assert fd["description"].startswith("Search pages")
    assert "query" in fd["parameters"]["properties"]
    assert "limit" in fd["parameters"]["properties"]
    assert "ctx" not in fd["parameters"]["properties"]
    assert fd["parameters"]["type"] == "object"


async def test_ollama_declaration_shape() -> None:
    @tool()
    async def fetch_url(url: str, ctx: ToolContext) -> str:
        """Fetch URL content."""
        return url

    decls = build_ollama_declarations([fetch_url])
    assert len(decls) == 1
    d = decls[0]
    assert d["type"] == "function"
    assert d["function"]["name"] == "fetch_url"
    assert d["function"]["description"].startswith("Fetch URL")
    assert "url" in d["function"]["parameters"]["properties"]


async def test_empty_list_returns_empty() -> None:
    assert build_gemini_declarations([]) == []
    assert build_ollama_declarations([]) == []
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_tool_declarations.py -v`
Expected: ImportError.

- [x] **Step 3: Implement `src/runtime/tool_declarations.py`**

```python
"""Provider-specific tool schema builders.

Converts a runtime Tool's input_schema() into the declaration format each
LLM provider expects.
"""
from __future__ import annotations

from typing import Any

from runtime.tools import Tool


def _strip_pydantic_metadata(schema: dict[str, Any]) -> dict[str, Any]:
    """Flatten Pydantic schema to plain JSON Schema that LLM providers accept.

    Pydantic adds `title`, `$defs`, etc. which Gemini/Ollama don't use.
    """
    out: dict[str, Any] = {
        "type": schema.get("type", "object"),
        "properties": {},
    }
    required = schema.get("required", [])
    if required:
        out["required"] = list(required)
    for pname, pschema in schema.get("properties", {}).items():
        clean: dict[str, Any] = {}
        if "type" in pschema:
            clean["type"] = pschema["type"]
        if "description" in pschema:
            clean["description"] = pschema["description"]
        if "enum" in pschema:
            clean["enum"] = pschema["enum"]
        if "items" in pschema:
            clean["items"] = pschema["items"]
        out["properties"][pname] = clean
    return out


def build_gemini_declarations(tools: list[Tool]) -> list[dict[str, Any]]:
    """Gemini FunctionDeclaration format: {name, description, parameters}."""
    return [
        {
            "name": t.name,
            "description": t.description,
            "parameters": _strip_pydantic_metadata(t.input_schema()),
        }
        for t in tools
    ]


def build_ollama_declarations(tools: list[Tool]) -> list[dict[str, Any]]:
    """Ollama tool format: {type: 'function', function: {name, description, parameters}}."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": _strip_pydantic_metadata(t.input_schema()),
            },
        }
        for t in tools
    ]


__all__ = ["build_gemini_declarations", "build_ollama_declarations"]
```

- [x] **Step 4: Update `runtime/__init__.py`**

Append:
```python
from runtime.tool_declarations import build_gemini_declarations, build_ollama_declarations
```
Add to `__all__`:
```python
    "build_gemini_declarations",
    "build_ollama_declarations",
```

- [x] **Step 5: Modify `packages/llm/src/llm/base.py` — add default method**

Add to the `LLMProvider` ABC:

```python
    # Default — providers override if they support tool calling
    def build_tool_declarations(self, tools: list) -> list[dict]:
        """Return tool schemas in this provider's expected format.

        Default raises NotImplementedError. Gemini/Ollama override.
        """
        raise NotImplementedError(f"{type(self).__name__} does not support tool calling")
```

Then in `gemini.py`:
```python
    def build_tool_declarations(self, tools: list) -> list[dict]:
        from runtime.tool_declarations import build_gemini_declarations
        return build_gemini_declarations(tools)
```

And `ollama.py`:
```python
    def build_tool_declarations(self, tools: list) -> list[dict]:
        from runtime.tool_declarations import build_ollama_declarations
        return build_ollama_declarations(tools)
```

Note: the `from runtime...` import is lazy (inside method) to avoid circular import — `packages/llm` does not depend on `runtime` at module-load time.

- [x] **Step 6: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/ -v`
Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add apps/worker/src/runtime/tool_declarations.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_tool_declarations.py packages/llm/src/llm/base.py packages/llm/src/llm/gemini.py packages/llm/src/llm/ollama.py
git commit -m "feat(llm,worker): add Gemini/Ollama tool declaration builders"
```

---

## Task 6: Custom LangGraph Reducer `keep_last_n`

**Files:**
- Create: `apps/worker/src/runtime/reducers.py`
- Create: `apps/worker/tests/runtime/test_reducers.py`

- [x] **Step 1: Write the failing test**

```python
"""Tests for keep_last_n reducer."""
from __future__ import annotations

import pytest

from runtime.reducers import keep_last_n


def test_keeps_most_recent() -> None:
    reducer = keep_last_n(3)
    state = [1, 2]
    updates = [3, 4, 5]
    merged = reducer(state, updates)
    assert merged == [3, 4, 5]


def test_preserves_order_when_under_cap() -> None:
    reducer = keep_last_n(5)
    merged = reducer([1, 2], [3])
    assert merged == [1, 2, 3]


def test_empty_state() -> None:
    reducer = keep_last_n(2)
    assert reducer([], [1, 2, 3]) == [2, 3]


def test_empty_update_returns_state() -> None:
    reducer = keep_last_n(3)
    assert reducer([1, 2, 3], []) == [1, 2, 3]


def test_n_must_be_positive() -> None:
    with pytest.raises(ValueError):
        keep_last_n(0)
    with pytest.raises(ValueError):
        keep_last_n(-1)


def test_handles_single_update_not_list() -> None:
    """LangGraph often passes a single item; reducer must tolerate it."""
    reducer = keep_last_n(3)
    merged = reducer([1, 2], 3)
    assert merged == [1, 2, 3]
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_reducers.py -v`
Expected: ImportError.

- [x] **Step 3: Implement `src/runtime/reducers.py`**

```python
"""Custom LangGraph reducers."""
from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def keep_last_n(n: int) -> Callable[[list[T], list[T] | T], list[T]]:
    """Return a LangGraph reducer that appends updates and keeps the last N items.

    Usage in state TypedDict:
        messages: Annotated[list[Message], keep_last_n(50)]
    """
    if n <= 0:
        raise ValueError(f"keep_last_n requires n > 0, got {n}")

    def reducer(state: list[T], updates: list[T] | T) -> list[T]:
        if isinstance(updates, list):
            merged = list(state) + list(updates)
        else:
            merged = list(state) + [updates]
        return merged[-n:]

    reducer.__name__ = f"keep_last_{n}"
    return reducer


__all__ = ["keep_last_n"]
```

- [x] **Step 4: Update `runtime/__init__.py`**

Append:
```python
from runtime.reducers import keep_last_n
```
Add `"keep_last_n"` to `__all__`.

- [x] **Step 5: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/test_reducers.py -v`
Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/reducers.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_reducers.py
git commit -m "feat(worker): add keep_last_n LangGraph reducer"
```

---

## Task 7: Hook ABCs, HookRegistry, HookChain

**Files:**
- Create: `apps/worker/src/runtime/hooks.py`
- Create: `apps/worker/tests/runtime/test_hooks.py`

- [x] **Step 1: Write the failing test**

```python
"""Tests for hook system — registration, scope resolution, short-circuit semantics."""
from __future__ import annotations

from typing import Any

import pytest

from runtime.events import AgentEvent
from runtime.hooks import (
    AgentHook,
    HookChain,
    HookRegistry,
    ModelHook,
    ModelRequest,
    ModelResponse,
    ToolHook,
)
from runtime.tools import ToolContext


async def _noop(_ev: AgentEvent) -> None:
    pass


@pytest.fixture
def ctx() -> ToolContext:
    return ToolContext(
        workspace_id="w1", project_id=None, page_id=None,
        user_id="u1", run_id="r1", scope="workspace", emit=_noop,
    )


class RecorderAgentHook(AgentHook):
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def before_agent(self, ctx: ToolContext, input: dict[str, Any]) -> dict[str, Any] | None:
        self.calls.append(f"before:{input.get('tag')}")
        return None

    async def after_agent(self, ctx: ToolContext, output: dict[str, Any]) -> dict[str, Any] | None:
        self.calls.append("after")
        return None


class ShortCircuitHook(AgentHook):
    async def before_agent(self, ctx: ToolContext, input: dict[str, Any]) -> dict[str, Any] | None:
        return {"short_circuited": True}

    async def after_agent(self, ctx: ToolContext, output: dict[str, Any]) -> dict[str, Any] | None:
        return None


async def test_register_global_agent_hook(ctx: ToolContext) -> None:
    reg = HookRegistry()
    h = RecorderAgentHook()
    reg.register(h, scope="global")
    chain = reg.resolve(ctx)
    await chain.run_before_agent(ctx, {"tag": "x"})
    assert h.calls == ["before:x"]


async def test_short_circuit_stops_chain(ctx: ToolContext) -> None:
    reg = HookRegistry()
    sc = ShortCircuitHook()
    rec = RecorderAgentHook()
    reg.register(sc, scope="global")
    reg.register(rec, scope="global")
    chain = reg.resolve(ctx)
    result = await chain.run_before_agent(ctx, {"tag": "y"})
    assert result == {"short_circuited": True}
    assert rec.calls == []  # recorder skipped


async def test_agent_scope_filters_by_agent_filter(ctx: ToolContext) -> None:
    reg = HookRegistry()
    h = RecorderAgentHook()
    reg.register(h, scope="agent", agent_filter=["research"])
    ctx_research = ctx.model_copy(update={"agent_name": "research"})  # not in ctx, but name lives on Agent
    # agent_filter is matched against a string we pass in; adjust test to match impl
    chain = reg.resolve_for_agent(ctx, agent_name="research")
    await chain.run_before_agent(ctx, {"tag": "r"})
    assert h.calls == ["before:r"]

    h2 = RecorderAgentHook()
    reg2 = HookRegistry()
    reg2.register(h2, scope="agent", agent_filter=["research"])
    chain2 = reg2.resolve_for_agent(ctx, agent_name="librarian")
    await chain2.run_before_agent(ctx, {"tag": "l"})
    assert h2.calls == []  # not in filter


async def test_onion_execution_order(ctx: ToolContext) -> None:
    """global before → agent before → run before → [run] → run after → agent after → global after."""
    order: list[str] = []

    class OrderHook(AgentHook):
        def __init__(self, tag: str) -> None:
            self.tag = tag

        async def before_agent(self, ctx: ToolContext, input: dict[str, Any]) -> None:
            order.append(f"{self.tag}:before")
            return None

        async def after_agent(self, ctx: ToolContext, output: dict[str, Any]) -> None:
            order.append(f"{self.tag}:after")
            return None

    reg = HookRegistry()
    reg.register(OrderHook("global"), scope="global")
    reg.register(OrderHook("agent"), scope="agent", agent_filter=["research"])
    reg.register(OrderHook("run"), scope="run", run_id="r1")
    chain = reg.resolve_for_agent(ctx, agent_name="research")
    await chain.run_before_agent(ctx, {})
    await chain.run_after_agent(ctx, {})
    assert order == [
        "global:before", "agent:before", "run:before",
        "run:after", "agent:after", "global:after",
    ]


async def test_model_hook_on_error_short_circuits(ctx: ToolContext) -> None:
    class Recover(ModelHook):
        async def before_model(self, ctx, req: ModelRequest) -> ModelRequest | None:
            return None

        async def after_model(self, ctx, resp: ModelResponse) -> ModelResponse | None:
            return None

        async def on_model_error(self, ctx, err: Exception) -> ModelResponse | None:
            return ModelResponse(text="fallback", model_id="x", prompt_tokens=0, completion_tokens=0, cost_krw=0)

    reg = HookRegistry()
    reg.register(Recover(), scope="global")
    chain = reg.resolve(ctx)
    resp = await chain.run_on_model_error(ctx, RuntimeError("boom"))
    assert resp is not None
    assert resp.text == "fallback"


async def test_tool_hook_before_can_replace_result(ctx: ToolContext) -> None:
    class CacheHit(ToolHook):
        async def before_tool(self, ctx, tool_name, args):
            return {"cached": True}

        async def after_tool(self, ctx, tool_name, result):
            return None

        async def on_tool_error(self, ctx, tool_name, err):
            return None

    reg = HookRegistry()
    reg.register(CacheHit(), scope="global")
    chain = reg.resolve(ctx)
    result = await chain.run_before_tool(ctx, "search_pages", {"q": "x"})
    assert result == {"cached": True}
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_hooks.py -v`
Expected: ImportError.

- [x] **Step 3: Implement `src/runtime/hooks.py`**

```python
"""Hook system — 3-tier ABCs (agent/model/tool), scope-based registry, onion execution.

Short-circuit semantics:
  - before_* returning non-None: skip subsequent hooks + skip real execution, use value as result
  - after_* returning non-None: transform result, pass to outer hooks
  - on_error returning non-None: suppress error, use value as result
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel

from runtime.tools import ToolContext


class ModelRequest(BaseModel):
    """Provider-agnostic LLM request passed through hooks."""
    model_id: str
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]] = []
    temperature: float | None = None
    max_tokens: int | None = None


class ModelResponse(BaseModel):
    """Provider-agnostic LLM response."""
    text: str
    model_id: str
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int = 0
    cost_krw: int
    finish_reason: str = "stop"
    latency_ms: int = 0
    raw: Any = None  # provider-specific payload


class AgentHook(ABC):
    @abstractmethod
    async def before_agent(self, ctx: ToolContext, input: dict[str, Any]) -> dict[str, Any] | None: ...
    @abstractmethod
    async def after_agent(self, ctx: ToolContext, output: dict[str, Any]) -> dict[str, Any] | None: ...


class ModelHook(ABC):
    @abstractmethod
    async def before_model(self, ctx: ToolContext, request: ModelRequest) -> ModelRequest | None: ...
    @abstractmethod
    async def after_model(self, ctx: ToolContext, response: ModelResponse) -> ModelResponse | None: ...
    @abstractmethod
    async def on_model_error(self, ctx: ToolContext, error: Exception) -> ModelResponse | None: ...


class ToolHook(ABC):
    @abstractmethod
    async def before_tool(self, ctx: ToolContext, tool_name: str, args: dict[str, Any]) -> Any | None: ...
    @abstractmethod
    async def after_tool(self, ctx: ToolContext, tool_name: str, result: Any) -> Any | None: ...
    @abstractmethod
    async def on_tool_error(self, ctx: ToolContext, tool_name: str, error: Exception) -> Any | None: ...


Hook = AgentHook | ModelHook | ToolHook
Scope = Literal["global", "agent", "run"]


@dataclass
class _Registration:
    hook: Hook
    scope: Scope
    agent_filter: tuple[str, ...] | None
    run_id: str | None


class HookRegistry:
    def __init__(self) -> None:
        self._regs: list[_Registration] = []

    def register(
        self,
        hook: Hook,
        *,
        scope: Scope,
        agent_filter: list[str] | None = None,
        run_id: str | None = None,
    ) -> None:
        self._regs.append(
            _Registration(
                hook=hook,
                scope=scope,
                agent_filter=tuple(agent_filter) if agent_filter else None,
                run_id=run_id,
            )
        )

    def resolve(self, ctx: ToolContext) -> HookChain:
        """Resolve chain without an agent_name filter. Matches global + run scope only."""
        return self.resolve_for_agent(ctx, agent_name=None)

    def resolve_for_agent(self, ctx: ToolContext, agent_name: str | None) -> HookChain:
        matched: list[_Registration] = []
        for r in self._regs:
            if r.scope == "global":
                matched.append(r)
            elif r.scope == "agent":
                if agent_name is not None and r.agent_filter and agent_name in r.agent_filter:
                    matched.append(r)
            elif r.scope == "run":
                if r.run_id == ctx.run_id:
                    matched.append(r)
        # Preserve onion ordering: global → agent → run
        order = {"global": 0, "agent": 1, "run": 2}
        matched.sort(key=lambda r: order[r.scope])
        return HookChain(matched)


class HookChain:
    """Executes a matched set of hooks with short-circuit + onion semantics."""

    def __init__(self, regs: list[_Registration]) -> None:
        self._regs = regs

    def _agent_hooks(self) -> list[AgentHook]:
        return [r.hook for r in self._regs if isinstance(r.hook, AgentHook)]

    def _model_hooks(self) -> list[ModelHook]:
        return [r.hook for r in self._regs if isinstance(r.hook, ModelHook)]

    def _tool_hooks(self) -> list[ToolHook]:
        return [r.hook for r in self._regs if isinstance(r.hook, ToolHook)]

    async def run_before_agent(self, ctx: ToolContext, input: dict[str, Any]) -> dict[str, Any] | None:
        for h in self._agent_hooks():
            result = await h.before_agent(ctx, input)
            if result is not None:
                return result
        return None

    async def run_after_agent(self, ctx: ToolContext, output: dict[str, Any]) -> dict[str, Any]:
        # Reverse order for "after" (onion)
        current = output
        for h in reversed(self._agent_hooks()):
            result = await h.after_agent(ctx, current)
            if result is not None:
                current = result
        return current

    async def run_before_model(self, ctx: ToolContext, request: ModelRequest) -> ModelResponse | None:
        """Non-None ModelResponse short-circuits model call."""
        current_req = request
        for h in self._model_hooks():
            out = await h.before_model(ctx, current_req)
            if isinstance(out, ModelResponse):
                return out
            if isinstance(out, ModelRequest):
                current_req = out
        return None  # caller uses current_req to actually call the model

    async def run_after_model(self, ctx: ToolContext, response: ModelResponse) -> ModelResponse:
        current = response
        for h in reversed(self._model_hooks()):
            out = await h.after_model(ctx, current)
            if out is not None:
                current = out
        return current

    async def run_on_model_error(self, ctx: ToolContext, error: Exception) -> ModelResponse | None:
        for h in self._model_hooks():
            recovered = await h.on_model_error(ctx, error)
            if recovered is not None:
                return recovered
        return None

    async def run_before_tool(self, ctx: ToolContext, tool_name: str, args: dict[str, Any]) -> Any | None:
        for h in self._tool_hooks():
            result = await h.before_tool(ctx, tool_name, args)
            if result is not None:
                return result
        return None

    async def run_after_tool(self, ctx: ToolContext, tool_name: str, result: Any) -> Any:
        current = result
        for h in reversed(self._tool_hooks()):
            out = await h.after_tool(ctx, tool_name, current)
            if out is not None:
                current = out
        return current

    async def run_on_tool_error(self, ctx: ToolContext, tool_name: str, error: Exception) -> Any | None:
        for h in self._tool_hooks():
            recovered = await h.on_tool_error(ctx, tool_name, error)
            if recovered is not None:
                return recovered
        return None


__all__ = [
    "AgentHook",
    "Hook",
    "HookChain",
    "HookRegistry",
    "ModelHook",
    "ModelRequest",
    "ModelResponse",
    "Scope",
    "ToolHook",
]
```

- [x] **Step 4: Update `runtime/__init__.py`**

Append:
```python
from runtime.hooks import AgentHook, HookChain, HookRegistry, ModelHook, ModelRequest, ModelResponse, ToolHook
```
Add to `__all__`:
```python
    "AgentHook", "HookChain", "HookRegistry", "ModelHook", "ModelRequest", "ModelResponse", "ToolHook",
```

- [x] **Step 5: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/test_hooks.py -v`
Expected: 7 tests PASS.

- [x] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/hooks.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_hooks.py
git commit -m "feat(worker): add 3-tier hook system with scope-based registry"
```

---

## Task 8: Agent Base Class + LangGraph Stream Adapter

**Files:**
- Create: `apps/worker/src/runtime/agent.py`
- Create: `apps/worker/src/runtime/langgraph_bridge.py`
- Create: `apps/worker/tests/runtime/test_agent.py`

- [x] **Step 1: Write the failing test**

```python
"""Tests for Agent ABC and stream_graph_as_events adapter."""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from runtime.agent import Agent
from runtime.events import AgentEnd, AgentEvent, AgentStart, CustomEvent
from runtime.tools import ToolContext


async def _noop(_ev: AgentEvent) -> None:
    pass


async def test_agent_is_abstract() -> None:
    import pytest
    with pytest.raises(TypeError):
        Agent()  # type: ignore[abstract]


async def test_subclass_yields_events() -> None:
    class EchoAgent(Agent):
        name = "echo"
        description = "Echoes input."

        async def run(self, input: dict[str, Any], ctx: ToolContext) -> AsyncGenerator[AgentEvent, None]:
            yield AgentStart(
                run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                seq=0, ts=1.0, type="agent_start", scope=ctx.scope, input=input,
            )
            yield CustomEvent(
                run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                seq=1, ts=1.1, type="custom", label="progress", payload={"pct": 50},
            )
            yield AgentEnd(
                run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                seq=2, ts=2.0, type="agent_end", output=input, duration_ms=1000,
            )

    ctx = ToolContext(
        workspace_id="w1", project_id=None, page_id=None,
        user_id="u1", run_id="r1", scope="project", emit=_noop,
    )
    agent = EchoAgent()
    events = [ev async for ev in agent.run({"msg": "hi"}, ctx)]
    assert len(events) == 3
    assert events[0].type == "agent_start"
    assert events[1].type == "custom"
    assert events[2].type == "agent_end"
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_agent.py -v`
Expected: ImportError.

- [x] **Step 3: Implement `src/runtime/agent.py`**

```python
"""Agent base class — contract for all 12 OpenCairn agents."""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any, ClassVar

from runtime.events import AgentEvent
from runtime.tools import ToolContext


class Agent(ABC):
    """All OpenCairn agents subclass this.

    `run()` is an async generator — yields AgentEvent items. If the agent
    yields `AwaitingInput`, the consumer may resume via `generator.asend(response)`.

    Subclasses MUST define class-level `name` and `description`.
    """

    name: ClassVar[str]
    description: ClassVar[str]

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        if not hasattr(cls, "name") or not isinstance(getattr(cls, "name", None), str):
            raise TypeError(f"{cls.__name__} must define class-level `name: str`")
        if not hasattr(cls, "description") or not isinstance(getattr(cls, "description", None), str):
            raise TypeError(f"{cls.__name__} must define class-level `description: str`")

    @abstractmethod
    def run(self, input: dict[str, Any], ctx: ToolContext) -> AsyncGenerator[AgentEvent, Any]:
        """Run the agent. Yields AgentEvent items. Implementations are `async def` with `yield`."""
        ...


__all__ = ["Agent"]
```

- [x] **Step 4: Implement `src/runtime/langgraph_bridge.py` (adapter)**

```python
"""LangGraph astream_events → AgentEvent adapter.

Single BaseCallbackHandler attached to each graph; converts LangGraph's
native event stream into OpenCairn's AgentEvent stream.
"""
from __future__ import annotations

import time
from collections.abc import AsyncGenerator
from typing import Any

from runtime.events import (
    AgentEnd,
    AgentError,
    AgentEvent,
    AgentStart,
    CustomEvent,
    ModelEnd,
    ToolResult,
    ToolUse,
)
from runtime.tools import ToolContext, hash_input


async def stream_graph_as_events(
    graph: Any,  # langgraph CompiledGraph, typed Any to avoid hard import
    input: dict[str, Any],
    ctx: ToolContext,
    *,
    agent_name: str,
    thread_id: str,
) -> AsyncGenerator[AgentEvent, None]:
    """Consume graph.astream_events() and emit AgentEvent items.

    Maps:
      on_chain_start → AgentStart (only for the graph root)
      on_chain_end → AgentEnd (only for the graph root)
      on_llm_end → ModelEnd
      on_tool_start → ToolUse
      on_tool_end → ToolResult
      custom dispatches → CustomEvent
    """
    seq = 0
    start_time = time.time()

    def _next_seq() -> int:
        nonlocal seq
        seq += 1
        return seq - 1

    def _base(ts: float | None = None) -> dict[str, Any]:
        return {
            "run_id": ctx.run_id,
            "workspace_id": ctx.workspace_id,
            "agent_name": agent_name,
            "seq": _next_seq(),
            "ts": ts if ts is not None else time.time(),
            "parent_seq": None,
        }

    tool_call_ids: dict[str, str] = {}  # langgraph run_id → our tool_call_id

    yield AgentStart(**_base(start_time), type="agent_start", scope=ctx.scope, input=input)

    try:
        config = {"configurable": {"thread_id": thread_id}}
        async for ev in graph.astream_events(input, config=config, version="v2"):
            name: str = ev.get("event", "")
            data: dict[str, Any] = ev.get("data", {})
            run_id_lg: str = ev.get("run_id", "")

            if name == "on_chat_model_end" or name == "on_llm_end":
                usage = _extract_usage(data.get("output"))
                yield ModelEnd(
                    **_base(),
                    type="model_end",
                    model_id=ev.get("metadata", {}).get("ls_model_name", "unknown"),
                    prompt_tokens=usage["prompt_tokens"],
                    completion_tokens=usage["completion_tokens"],
                    cached_tokens=usage.get("cached_tokens", 0),
                    cost_krw=0,  # computed by TokenCounterHook after the fact
                    finish_reason=usage.get("finish_reason", "stop"),
                    latency_ms=int(usage.get("latency_ms", 0)),
                )
            elif name == "on_tool_start":
                tool_input = data.get("input", {})
                call_id = f"call-{run_id_lg}"
                tool_call_ids[run_id_lg] = call_id
                tool_name = ev.get("name", "unknown")
                yield ToolUse(
                    **_base(),
                    type="tool_use",
                    tool_call_id=call_id,
                    tool_name=tool_name,
                    input_args=tool_input if isinstance(tool_input, dict) else {"input": tool_input},
                    input_hash=hash_input(tool_input if isinstance(tool_input, dict) else {"input": tool_input}),
                    concurrency_safe=False,  # runtime scheduler knows better; this is just a log
                )
            elif name == "on_tool_end":
                call_id = tool_call_ids.get(run_id_lg, f"call-{run_id_lg}")
                out = data.get("output")
                yield ToolResult(
                    **_base(),
                    type="tool_result",
                    tool_call_id=call_id,
                    ok=True,
                    output=_coerce_json(out),
                    duration_ms=0,  # langgraph doesn't give us duration directly; compute if needed
                )
            elif name == "on_custom_event":
                yield CustomEvent(
                    **_base(),
                    type="custom",
                    label=ev.get("name", "custom"),
                    payload=data if isinstance(data, dict) else {"value": data},
                )

        duration = int((time.time() - start_time) * 1000)
        final_state = await graph.ainvoke(input, config=config)  # graph already ran; this returns cached state
        yield AgentEnd(
            **_base(),
            type="agent_end",
            output=final_state if isinstance(final_state, dict) else {"output": final_state},
            duration_ms=duration,
        )
    except Exception as e:  # noqa: BLE001 — bubble up after emitting
        yield AgentError(
            **_base(),
            type="agent_error",
            error_class=type(e).__name__,
            message=str(e)[:500],
            retryable=_is_retryable(e),
        )
        raise


def _extract_usage(output: Any) -> dict[str, Any]:
    """Best-effort extraction of token usage from langchain-core message output."""
    if output is None:
        return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0}
    # langchain AIMessage with usage_metadata
    usage = getattr(output, "usage_metadata", None)
    if usage:
        return {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "cached_tokens": usage.get("input_token_details", {}).get("cache_read", 0),
            "finish_reason": "stop",
        }
    return {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0}


def _coerce_json(val: Any) -> Any:
    """Make langgraph tool output JSON-serializable."""
    if val is None:
        return None
    if isinstance(val, (str, int, float, bool, list, dict)):
        return val
    if hasattr(val, "model_dump"):
        return val.model_dump()
    return str(val)


def _is_retryable(err: Exception) -> bool:
    name = type(err).__name__
    return name in {"TimeoutError", "ConnectionError", "RateLimitError", "APIConnectionError"}


__all__ = ["stream_graph_as_events"]
```

- [x] **Step 5: Update `runtime/__init__.py`**

Append:
```python
from runtime.agent import Agent
from runtime.langgraph_bridge import stream_graph_as_events
```
Add to `__all__`:
```python
    "Agent",
    "stream_graph_as_events",
```

- [x] **Step 6: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/test_agent.py -v`
Expected: all pass.

- [x] **Step 7: Commit**

```bash
git add apps/worker/src/runtime/agent.py apps/worker/src/runtime/langgraph_bridge.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_agent.py
git commit -m "feat(worker): add Agent ABC and LangGraph→AgentEvent adapter"
```

---

## Task 9: agent_runs DB Schema + Migration

**Files:**
- Create: `packages/db/src/schema/agent-runs.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/<timestamp>_agent_runs.sql`
- Create: `packages/db/tests/agent-runs.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from "vitest";
import { agentRuns } from "../src/schema/agent-runs";

describe("agent_runs schema", () => {
  test("exports agentRuns table", () => {
    expect(agentRuns).toBeDefined();
  });

  test("has required columns", () => {
    const cols = Object.keys(agentRuns);
    for (const c of [
      "runId", "workspaceId", "userId", "agentName", "status",
      "startedAt", "totalTokensIn", "totalTokensOut", "totalCostKrw",
      "trajectoryUri", "createdAt",
    ]) {
      expect(cols).toContain(c);
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @opencairn/db test agent-runs`
Expected: module not found.

- [x] **Step 3: Implement `packages/db/src/schema/agent-runs.ts`**

```typescript
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { projects } from "./projects";
import { users } from "./users";
import { workspaces } from "./workspaces";

// Note: page_id is NOT foreign-keyed. The owning table (`pages` or `notes`)
// evolves across plans; keep this as a soft reference to avoid cross-plan
// migration ordering issues. Integrity is enforced at the application layer.

export const agentRuns = pgTable(
  "agent_runs",
  {
    runId: uuid("run_id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    pageId: uuid("page_id"),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    agentName: text("agent_name").notNull(),
    parentRunId: uuid("parent_run_id"),  // self-ref, enforced via app
    workflowId: text("workflow_id").notNull(),

    status: text("status").notNull(),  // 'running' | 'completed' | 'failed' | 'awaiting_input'
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),

    totalTokensIn: integer("total_tokens_in").notNull().default(0),
    totalTokensOut: integer("total_tokens_out").notNull().default(0),
    totalTokensCached: integer("total_tokens_cached").notNull().default(0),
    totalCostKrw: integer("total_cost_krw").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    modelCallCount: integer("model_call_count").notNull().default(0),

    errorClass: text("error_class"),
    errorMessage: text("error_message"),

    trajectoryUri: text("trajectory_uri").notNull(),
    trajectoryBytes: integer("trajectory_bytes").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxWorkspaceStatus: index("idx_agent_runs_workspace_status").on(t.workspaceId, t.status, t.startedAt.desc()),
    idxParent: index("idx_agent_runs_parent").on(t.parentRunId).where(sql`${t.parentRunId} IS NOT NULL`),
    idxWorkflow: index("idx_agent_runs_workflow").on(t.workflowId),
  }),
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
```

- [x] **Step 4: Modify `packages/db/src/schema/index.ts` to re-export**

Add:
```typescript
export * from "./agent-runs";
```

- [x] **Step 5: Generate migration**

Run:
```bash
pnpm --filter @opencairn/db db:generate
```
Inspect the generated SQL in `packages/db/drizzle/<timestamp>_*.sql`. Verify it creates `agent_runs` table and 3 indexes.

- [x] **Step 6: Run tests**

Run: `pnpm --filter @opencairn/db test agent-runs && pnpm --filter @opencairn/db typecheck`
Expected: tests pass, typecheck clean.

- [x] **Step 7: Apply migration locally**

Run:
```bash
pnpm db:migrate
```
Verify: `psql $DATABASE_URL -c "\d agent_runs"` shows 20 columns + 3 indexes.

- [x] **Step 8: Commit**

```bash
git add packages/db/src/schema/agent-runs.ts packages/db/src/schema/index.ts packages/db/drizzle/ packages/db/tests/agent-runs.test.ts
git commit -m "feat(db): add agent_runs table with handoff tree + trajectory pointer"
```

---

## Task 10: TrajectoryStorage — LocalFS Backend

**Files:**
- Create: `apps/worker/src/runtime/trajectory.py`
- Create: `apps/worker/tests/runtime/test_trajectory_local.py`

- [x] **Step 1: Write the failing test**

```python
"""Tests for LocalFSTrajectoryStorage — NDJSON write, read, atomic rename."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from runtime.events import AgentEnd, AgentStart
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter


def _ev_start(seq: int = 0) -> AgentStart:
    return AgentStart(
        run_id="r1", workspace_id="w1", agent_name="test", seq=seq, ts=1.0,
        type="agent_start", scope="project", input={"q": "x"},
    )


def _ev_end(seq: int = 1) -> AgentEnd:
    return AgentEnd(
        run_id="r1", workspace_id="w1", agent_name="test", seq=seq, ts=2.0,
        type="agent_end", output={"answer": "y"}, duration_ms=1000,
    )


async def test_writer_creates_file(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = await storage.open_writer(run_id="r1", workspace_id="w1")
    await writer.emit(_ev_start())
    await writer.emit(_ev_end())
    await writer.close()

    files = list(tmp_trajectory_dir.rglob("*.ndjson"))
    assert len(files) == 1
    assert files[0].name == "r1.ndjson"
    assert "w1/" in str(files[0])


async def test_writer_appends_ndjson_lines(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = await storage.open_writer(run_id="r1", workspace_id="w1")
    await writer.emit(_ev_start(seq=0))
    await writer.emit(_ev_end(seq=1))
    uri = await writer.close()

    lines = Path(uri.removeprefix("file://")).read_text().splitlines()
    assert len(lines) == 2
    parsed = [json.loads(line) for line in lines]
    assert parsed[0]["type"] == "agent_start"
    assert parsed[1]["type"] == "agent_end"


async def test_writer_returns_file_uri(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = await storage.open_writer(run_id="r1", workspace_id="w1")
    await writer.emit(_ev_start())
    uri = await writer.close()
    assert uri.startswith("file://")


async def test_read_trajectory_roundtrip(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = await storage.open_writer(run_id="r1", workspace_id="w1")
    await writer.emit(_ev_start())
    await writer.emit(_ev_end())
    uri = await writer.close()

    events = [ev async for ev in storage.read_trajectory(uri)]
    assert len(events) == 2
    assert events[0].type == "agent_start"
    assert events[1].type == "agent_end"


async def test_buffer_flushes_on_agent_end(tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)
    writer = TrajectoryWriter(storage=storage, run_id="r1", workspace_id="w1", buffer_size=50)
    await writer.open()
    await writer.emit(_ev_start())
    # not flushed yet (buffer_size=50)
    files_before = list(tmp_trajectory_dir.rglob("*.ndjson"))

    await writer.emit(_ev_end())  # agent_end triggers flush
    # file should exist now
    files_after = list(tmp_trajectory_dir.rglob("*.ndjson"))
    assert len(files_after) == 1
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_trajectory_local.py -v`
Expected: ImportError.

- [x] **Step 3: Implement `src/runtime/trajectory.py`**

```python
"""Trajectory storage — Protocol + LocalFSTrajectoryStorage + TrajectoryWriter.

NDJSON path: {base}/{workspace_id}/{YYYY-MM-DD}/{run_id}.ndjson
"""
from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from pydantic import TypeAdapter

from runtime.events import AgentEnd, AgentError, AgentEvent

_AGENT_EVENT_ADAPTER = TypeAdapter(AgentEvent)


class TrajectoryWriterProtocol(Protocol):
    async def emit(self, event: AgentEvent) -> None: ...
    async def close(self) -> str: ...  # returns URI


@runtime_checkable
class TrajectoryStorage(Protocol):
    async def open_writer(self, run_id: str, workspace_id: str) -> TrajectoryWriterProtocol: ...
    def read_trajectory(self, uri: str) -> AsyncIterator[AgentEvent]: ...


class LocalFSWriter:
    """Buffered NDJSON writer with atomic rename on close."""

    def __init__(self, *, final_path: Path) -> None:
        self._final = final_path
        self._tmp = final_path.with_suffix(final_path.suffix + ".tmp")
        self._final.parent.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()
        self._buffer: list[str] = []

    async def emit(self, event: AgentEvent) -> None:
        line = event.model_dump_json()
        async with self._lock:
            self._buffer.append(line)
            if len(self._buffer) >= 50 or isinstance(event, (AgentEnd, AgentError)):
                await self._flush()

    async def _flush(self) -> None:
        if not self._buffer:
            return
        content = "\n".join(self._buffer) + "\n"
        await asyncio.to_thread(self._append, content)
        self._buffer.clear()

    def _append(self, content: str) -> None:
        with open(self._tmp, "a", encoding="utf-8") as f:
            f.write(content)

    async def close(self) -> str:
        async with self._lock:
            await self._flush()
        if self._tmp.exists():
            await asyncio.to_thread(os.replace, self._tmp, self._final)
        return f"file://{self._final}"


class LocalFSTrajectoryStorage:
    def __init__(self, *, base_dir: Path) -> None:
        self._base = Path(base_dir)
        self._base.mkdir(parents=True, exist_ok=True)

    async def open_writer(self, run_id: str, workspace_id: str) -> LocalFSWriter:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        path = self._base / workspace_id / today / f"{run_id}.ndjson"
        return LocalFSWriter(final_path=path)

    async def read_trajectory(self, uri: str) -> AsyncIterator[AgentEvent]:
        path = Path(uri.removeprefix("file://"))
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                yield _AGENT_EVENT_ADAPTER.validate_json(line)


class TrajectoryWriter:
    """Higher-level writer used by the TrajectoryWriterHook.

    Wraps a backend writer and exposes a consistent API regardless of storage backend.
    """

    def __init__(
        self,
        *,
        storage: TrajectoryStorage,
        run_id: str,
        workspace_id: str,
        buffer_size: int = 50,
    ) -> None:
        self._storage = storage
        self._run_id = run_id
        self._workspace_id = workspace_id
        self._buffer_size = buffer_size
        self._backend_writer: TrajectoryWriterProtocol | None = None

    async def open(self) -> None:
        self._backend_writer = await self._storage.open_writer(self._run_id, self._workspace_id)

    async def emit(self, event: AgentEvent) -> None:
        if self._backend_writer is None:
            raise RuntimeError("TrajectoryWriter not opened")
        await self._backend_writer.emit(event)

    async def close(self) -> str:
        if self._backend_writer is None:
            raise RuntimeError("TrajectoryWriter not opened")
        return await self._backend_writer.close()


def resolve_storage_from_env() -> TrajectoryStorage:
    """Factory that honors TRAJECTORY_BACKEND env."""
    backend = os.environ.get("TRAJECTORY_BACKEND", "local")
    if backend == "local":
        base = Path(os.environ.get("TRAJECTORY_DIR", "/var/lib/opencairn/trajectories"))
        return LocalFSTrajectoryStorage(base_dir=base)
    if backend == "s3":
        from runtime.trajectory_s3 import S3TrajectoryStorage
        return S3TrajectoryStorage.from_env()
    raise ValueError(f"Unknown TRAJECTORY_BACKEND: {backend}")


__all__ = [
    "LocalFSTrajectoryStorage",
    "LocalFSWriter",
    "TrajectoryStorage",
    "TrajectoryWriter",
    "TrajectoryWriterProtocol",
    "resolve_storage_from_env",
]
```

- [x] **Step 4: Update `runtime/__init__.py`**

Append:
```python
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryStorage, TrajectoryWriter, resolve_storage_from_env
```
Add to `__all__`:
```python
    "LocalFSTrajectoryStorage",
    "TrajectoryStorage",
    "TrajectoryWriter",
    "resolve_storage_from_env",
```

- [x] **Step 5: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/test_trajectory_local.py -v`
Expected: 5 tests PASS.

- [x] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/trajectory.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_trajectory_local.py
git commit -m "feat(worker): add LocalFS trajectory storage with buffered NDJSON writes"
```

---

## Task 11: Default Hooks (TrajectoryWriter, TokenCounter, Sentry, Latency)

**Files:**
- Create: `apps/worker/src/runtime/default_hooks.py`
- Create: `apps/worker/tests/runtime/test_default_hooks.py`

- [x] **Step 1: Write the failing test**

```python
"""Tests for default global hooks."""
from __future__ import annotations

from pathlib import Path

import asyncpg
import pytest

from runtime.default_hooks import TokenCounterHook, TrajectoryWriterHook
from runtime.events import AgentEnd, AgentStart, ModelEnd
from runtime.hooks import HookRegistry
from runtime.tools import ToolContext
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter


async def _noop(_ev) -> None:
    pass


@pytest.fixture
def ctx() -> ToolContext:
    return ToolContext(
        workspace_id="w1", project_id=None, page_id=None,
        user_id="u1", run_id="r-traj-1", scope="project", emit=_noop,
    )


async def test_trajectory_writer_hook_flushes_on_end(ctx: ToolContext, tmp_trajectory_dir: Path) -> None:
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)

    class TestHook(TrajectoryWriterHook):
        async def _build_writer(self, ctx: ToolContext) -> TrajectoryWriter:
            w = TrajectoryWriter(storage=storage, run_id=ctx.run_id, workspace_id=ctx.workspace_id)
            await w.open()
            return w

    hook = TestHook()
    start = AgentStart(
        run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name="t", seq=0, ts=1.0,
        type="agent_start", scope="project", input={"q": "x"},
    )
    end = AgentEnd(
        run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name="t", seq=1, ts=2.0,
        type="agent_end", output={}, duration_ms=1000,
    )
    await hook.on_event(ctx, start)
    await hook.on_event(ctx, end)

    files = list(tmp_trajectory_dir.rglob("*.ndjson"))
    assert len(files) == 1


async def test_token_counter_aggregates_cost(ctx: ToolContext) -> None:
    hook = TokenCounterHook()
    await hook.reset(ctx.run_id)
    await hook.on_event(
        ctx,
        ModelEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name="t", seq=0, ts=1.0,
            type="model_end", model_id="gemini-3-pro",
            prompt_tokens=100, completion_tokens=50, cached_tokens=0, cost_krw=12,
            finish_reason="stop", latency_ms=800,
        ),
    )
    await hook.on_event(
        ctx,
        ModelEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name="t", seq=1, ts=1.1,
            type="model_end", model_id="gemini-3-pro",
            prompt_tokens=50, completion_tokens=20, cached_tokens=0, cost_krw=5,
            finish_reason="stop", latency_ms=300,
        ),
    )
    totals = hook.totals(ctx.run_id)
    assert totals.prompt_tokens == 150
    assert totals.completion_tokens == 70
    assert totals.cost_krw == 17
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_default_hooks.py -v`
Expected: ImportError.

- [x] **Step 3: Implement `src/runtime/default_hooks.py`**

```python
"""Default global hooks — trajectory writer, token counter, Sentry, latency."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

from runtime.events import AgentEnd, AgentError, AgentEvent, ModelEnd
from runtime.hooks import AgentHook, ModelHook, ToolHook
from runtime.tools import ToolContext
from runtime.trajectory import TrajectoryWriter, resolve_storage_from_env

log = logging.getLogger(__name__)


@dataclass
class RunTotals:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    cost_krw: int = 0
    tool_call_count: int = 0
    model_call_count: int = 0


class TrajectoryWriterHook(AgentHook, ModelHook, ToolHook):
    """Captures every event into an NDJSON trajectory.

    Attached as `global` scope. Hook methods delegate to `on_event`.
    """

    def __init__(self) -> None:
        self._writers: dict[str, TrajectoryWriter] = {}

    async def _build_writer(self, ctx: ToolContext) -> TrajectoryWriter:
        """Override in tests to inject storage."""
        storage = resolve_storage_from_env()
        w = TrajectoryWriter(storage=storage, run_id=ctx.run_id, workspace_id=ctx.workspace_id)
        await w.open()
        return w

    async def on_event(self, ctx: ToolContext, event: AgentEvent) -> None:
        writer = self._writers.get(ctx.run_id)
        if writer is None:
            writer = await self._build_writer(ctx)
            self._writers[ctx.run_id] = writer
        try:
            await writer.emit(event)
        except Exception:
            log.exception("trajectory emit failed — continuing")

        if isinstance(event, (AgentEnd, AgentError)):
            try:
                await writer.close()
            except Exception:
                log.exception("trajectory close failed")
            finally:
                self._writers.pop(ctx.run_id, None)

    # AgentHook
    async def before_agent(self, ctx: ToolContext, input: dict[str, Any]) -> None:
        return None

    async def after_agent(self, ctx: ToolContext, output: dict[str, Any]) -> None:
        return None

    # ModelHook
    async def before_model(self, ctx, request):
        return None

    async def after_model(self, ctx, response):
        return None

    async def on_model_error(self, ctx, error):
        return None

    # ToolHook
    async def before_tool(self, ctx, tool_name, args):
        return None

    async def after_tool(self, ctx, tool_name, result):
        return None

    async def on_tool_error(self, ctx, tool_name, error):
        return None


class TokenCounterHook(AgentHook, ModelHook, ToolHook):
    """Accumulates per-run token + cost totals. Consumed by workspace credit deduction."""

    def __init__(self) -> None:
        self._totals: dict[str, RunTotals] = {}

    async def reset(self, run_id: str) -> None:
        self._totals[run_id] = RunTotals()

    def totals(self, run_id: str) -> RunTotals:
        return self._totals.setdefault(run_id, RunTotals())

    async def on_event(self, ctx: ToolContext, event: AgentEvent) -> None:
        t = self._totals.setdefault(ctx.run_id, RunTotals())
        if isinstance(event, ModelEnd):
            t.prompt_tokens += event.prompt_tokens
            t.completion_tokens += event.completion_tokens
            t.cached_tokens += event.cached_tokens
            t.cost_krw += event.cost_krw
            t.model_call_count += 1

    # AgentHook / ModelHook / ToolHook required methods all return None
    async def before_agent(self, ctx, input): return None
    async def after_agent(self, ctx, output): return None
    async def before_model(self, ctx, request): return None
    async def after_model(self, ctx, response): return None
    async def on_model_error(self, ctx, error): return None
    async def before_tool(self, ctx, tool_name, args): return None
    async def after_tool(self, ctx, tool_name, result): return None
    async def on_tool_error(self, ctx, tool_name, error): return None


class SentryHook(AgentHook, ModelHook, ToolHook):
    """Captures errors to Sentry if SENTRY_DSN is set; otherwise no-op."""

    def __init__(self) -> None:
        self._enabled = bool(os.environ.get("SENTRY_DSN"))
        if self._enabled:
            try:
                import sentry_sdk  # noqa: F401
            except ImportError:
                log.warning("SENTRY_DSN set but sentry-sdk not installed; install 'opencairn-worker[sentry]'")
                self._enabled = False

    async def _capture(self, error: Exception, extra: dict) -> None:
        if not self._enabled:
            return
        import sentry_sdk
        with sentry_sdk.push_scope() as scope:
            for k, v in extra.items():
                scope.set_extra(k, v)
            sentry_sdk.capture_exception(error)

    async def before_agent(self, ctx, input): return None
    async def after_agent(self, ctx, output): return None
    async def before_model(self, ctx, request): return None
    async def after_model(self, ctx, response): return None
    async def before_tool(self, ctx, tool_name, args): return None
    async def after_tool(self, ctx, tool_name, result): return None

    async def on_model_error(self, ctx, error):
        await self._capture(error, {"run_id": ctx.run_id, "layer": "model"})
        return None

    async def on_tool_error(self, ctx, tool_name, error):
        await self._capture(error, {"run_id": ctx.run_id, "tool": tool_name})
        return None


__all__ = ["RunTotals", "SentryHook", "TokenCounterHook", "TrajectoryWriterHook"]
```

- [x] **Step 4: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/test_default_hooks.py -v`
Expected: 2 tests PASS.

- [x] **Step 5: Update `runtime/__init__.py`**

Append:
```python
from runtime.default_hooks import RunTotals, SentryHook, TokenCounterHook, TrajectoryWriterHook
```
Add to `__all__`.

- [x] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/default_hooks.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_default_hooks.py
git commit -m "feat(worker): add default hooks (trajectory writer, token counter, sentry)"
```

---

## Task 12: Temporal Helpers (`make_thread_id`, `AgentAwaitingInputError`)

**Files:**
- Create: `apps/worker/src/runtime/temporal.py`
- Create: `apps/worker/tests/runtime/test_temporal_helpers.py`

- [x] **Step 1: Write the failing test**

```python
"""Tests for Temporal helpers."""
from __future__ import annotations

import pytest

from runtime.temporal import AgentAwaitingInputError, make_thread_id


def test_make_thread_id_standalone() -> None:
    assert make_thread_id("wf-1", "research", None) == "wf-1:research"


def test_make_thread_id_with_parent() -> None:
    assert make_thread_id("wf-1", "research", parent_run_id="r-parent") == "r-parent:research"


def test_awaiting_input_error_fields() -> None:
    err = AgentAwaitingInputError(interrupt_id="int-1", prompt="Approve?")
    assert err.interrupt_id == "int-1"
    assert err.prompt == "Approve?"
    assert str(err).startswith("AgentAwaitingInputError")


def test_awaiting_input_error_is_exception() -> None:
    with pytest.raises(AgentAwaitingInputError):
        raise AgentAwaitingInputError(interrupt_id="i", prompt="?")
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/runtime/test_temporal_helpers.py -v`
Expected: ImportError.

- [x] **Step 3: Implement `src/runtime/temporal.py`**

```python
"""Temporal integration helpers."""
from __future__ import annotations


def make_thread_id(workflow_id: str, agent_name: str, parent_run_id: str | None) -> str:
    """LangGraph thread_id naming convention.

    - Standalone:   "{workflow_id}:{agent_name}"
    - Sub-agent:    "{parent_run_id}:{agent_name}"

    Invariant: at most one Temporal activity writes to a given thread_id concurrently.
    """
    if parent_run_id:
        return f"{parent_run_id}:{agent_name}"
    return f"{workflow_id}:{agent_name}"


class AgentAwaitingInputError(Exception):
    """Raised inside an activity when the agent yields AwaitingInput.

    Must be added to Temporal RetryPolicy.non_retryable_error_types so the
    workflow wrapper catches it and waits for a signal instead of retrying.
    """

    def __init__(self, *, interrupt_id: str, prompt: str) -> None:
        super().__init__(f"AgentAwaitingInputError(interrupt_id={interrupt_id!r})")
        self.interrupt_id = interrupt_id
        self.prompt = prompt


__all__ = ["AgentAwaitingInputError", "make_thread_id"]
```

- [x] **Step 4: Update `runtime/__init__.py`**

Append:
```python
from runtime.temporal import AgentAwaitingInputError, make_thread_id
```
Add to `__all__`.

- [x] **Step 5: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/test_temporal_helpers.py -v`
Expected: 4 tests PASS.

- [x] **Step 6: Commit**

```bash
git add apps/worker/src/runtime/temporal.py apps/worker/src/runtime/__init__.py apps/worker/tests/runtime/test_temporal_helpers.py
git commit -m "feat(worker): add make_thread_id + AgentAwaitingInputError"
```

---

## Task 13: Eval — EvalCase, Metrics, Runner

**Files:**
- Create: `apps/worker/src/runtime/eval/__init__.py`
- Create: `apps/worker/src/runtime/eval/case.py`
- Create: `apps/worker/src/runtime/eval/metrics.py`
- Create: `apps/worker/src/runtime/eval/runner.py`
- Create: `apps/worker/src/runtime/eval/loader.py`
- Create: `apps/worker/tests/runtime/test_eval_case.py`
- Create: `apps/worker/tests/runtime/test_eval_metrics.py`
- Create: `apps/worker/tests/runtime/test_eval_runner.py`
- Create: `apps/worker/eval/research/basic_scope_respect.yaml` (sample)

- [x] **Step 1: Write the failing tests**

`tests/runtime/test_eval_case.py`:
```python
"""EvalCase model + loader tests."""
from __future__ import annotations

from pathlib import Path

import yaml

from runtime.eval.case import EvalCase, ExpectedToolCall
from runtime.eval.loader import load_case_file


def test_eval_case_defaults() -> None:
    c = EvalCase(id="x", description="d", agent="research", scope="page", input={})
    assert c.max_cost_krw == 1000
    assert c.expected_tools == []
    assert c.forbidden_tools == []


def test_expected_tool_call_partial_match() -> None:
    t = ExpectedToolCall(tool_name="search_pages", args_match={"scope": "page"})
    assert t.args_match == {"scope": "page"}


def test_load_yaml_case(tmp_path: Path) -> None:
    f = tmp_path / "c.yaml"
    f.write_text(yaml.safe_dump({
        "id": "r1",
        "description": "sample",
        "agent": "research",
        "scope": "page",
        "input": {"query": "x"},
        "expected_tools": [{"tool_name": "search_pages"}],
    }))
    c = load_case_file(f)
    assert c.id == "r1"
    assert len(c.expected_tools) == 1
```

`tests/runtime/test_eval_metrics.py`:
```python
"""Metric calculation tests."""
from __future__ import annotations

from runtime.eval.case import EvalCase, ExpectedHandoff, ExpectedToolCall
from runtime.eval.metrics import score_trajectory
from runtime.events import AgentEnd, Handoff, ToolUse


def _tool_use(name: str, args: dict, seq: int = 0) -> ToolUse:
    return ToolUse(
        run_id="r", workspace_id="w", agent_name="a", seq=seq, ts=1.0,
        type="tool_use", tool_call_id=f"c{seq}", tool_name=name,
        input_args=args, input_hash="h", concurrency_safe=False,
    )


def _end(output: dict, seq: int = 99) -> AgentEnd:
    return AgentEnd(
        run_id="r", workspace_id="w", agent_name="a", seq=seq, ts=2.0,
        type="agent_end", output=output, duration_ms=100,
    )


def test_perfect_tool_trajectory() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={},
        expected_tools=[ExpectedToolCall(tool_name="search_pages", args_match={"scope": "page"})],
    )
    events = [_tool_use("search_pages", {"scope": "page"}), _end({"answer": "x"})]
    result = score_trajectory(case, events, total_cost_krw=50, duration_ms=500)
    assert result.tool_trajectory_score == 1.0
    assert result.forbidden_tool_score == 1.0


def test_forbidden_tool_penalizes() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={},
        forbidden_tools=["fetch_url"],
    )
    events = [_tool_use("fetch_url", {"url": "https://evil"}), _end({"answer": "x"})]
    result = score_trajectory(case, events, total_cost_krw=50, duration_ms=500)
    assert result.forbidden_tool_score == 0.0


def test_cost_over_budget() -> None:
    case = EvalCase(id="x", description="d", agent="research", scope="page", input={}, max_cost_krw=100)
    events = [_end({})]
    result = score_trajectory(case, events, total_cost_krw=200, duration_ms=500)
    assert result.cost_within_budget == 0.0


def test_response_contains() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={},
        response_contains=["알고리즘"],
    )
    events = [_end({"answer": "프로젝트에서 쓰인 알고리즘은 ..."})]
    result = score_trajectory(case, events, total_cost_krw=0, duration_ms=0)
    assert result.response_contains_score == 1.0


def test_missing_required_tool() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page", input={},
        expected_tools=[ExpectedToolCall(tool_name="search_pages", required=True)],
    )
    events = [_end({})]
    result = score_trajectory(case, events, total_cost_krw=0, duration_ms=0)
    assert result.tool_trajectory_score == 0.0


def test_handoff_score() -> None:
    case = EvalCase(
        id="x", description="d", agent="compiler", scope="project", input={},
        expected_handoffs=[ExpectedHandoff(to_agent="research")],
    )
    events = [
        Handoff(run_id="r", workspace_id="w", agent_name="compiler", seq=0, ts=1.0,
                type="handoff", from_agent="compiler", to_agent="research",
                child_run_id="r2", scope="project", reason="needs search"),
        _end({}),
    ]
    result = score_trajectory(case, events, total_cost_krw=0, duration_ms=0)
    assert result.handoff_score == 1.0
```

`tests/runtime/test_eval_runner.py`:
```python
"""Runner smoke test using a fake Agent."""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from runtime.agent import Agent
from runtime.eval.case import EvalCase, ExpectedToolCall
from runtime.eval.runner import AgentEvaluator, DEFAULT_CRITERIA
from runtime.events import AgentEnd, AgentEvent, AgentStart, ToolResult, ToolUse
from runtime.tools import ToolContext


class FakeResearchAgent(Agent):
    name = "research"
    description = "fake"

    async def run(self, input: dict[str, Any], ctx: ToolContext) -> AsyncGenerator[AgentEvent, None]:
        yield AgentStart(run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                         seq=0, ts=1.0, type="agent_start", scope=ctx.scope, input=input)
        yield ToolUse(run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                      seq=1, ts=1.1, type="tool_use", tool_call_id="c0",
                      tool_name="search_pages", input_args={"scope": "page"},
                      input_hash="h", concurrency_safe=True)
        yield ToolResult(run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                         seq=2, ts=1.2, type="tool_result", tool_call_id="c0",
                         ok=True, output=[{"id": "p1"}], duration_ms=30)
        yield AgentEnd(run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
                       seq=3, ts=1.5, type="agent_end",
                       output={"answer": "결과: 알고리즘"}, duration_ms=500)


async def test_runner_passes_clean_trajectory() -> None:
    case = EvalCase(
        id="x", description="d", agent="research", scope="page",
        input={"query": "알고리즘"},
        expected_tools=[ExpectedToolCall(tool_name="search_pages", args_match={"scope": "page"})],
        response_contains=["알고리즘"],
        max_cost_krw=1000,
    )
    result = await AgentEvaluator.run(case, agent_factory=lambda: FakeResearchAgent())
    result.assert_passed(DEFAULT_CRITERIA)
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd apps/worker && uv run pytest tests/runtime/test_eval_case.py tests/runtime/test_eval_metrics.py tests/runtime/test_eval_runner.py -v`
Expected: ImportError on `runtime.eval`.

- [x] **Step 3: Implement `src/runtime/eval/__init__.py`**

```python
"""Eval framework — trajectory-based agent tests."""
from runtime.eval.case import EvalCase, ExpectedHandoff, ExpectedToolCall
from runtime.eval.loader import load_case_file, load_cases
from runtime.eval.metrics import ScoreResult, score_trajectory
from runtime.eval.runner import DEFAULT_CRITERIA, AgentEvaluator, EvalResult

__all__ = [
    "AgentEvaluator",
    "DEFAULT_CRITERIA",
    "EvalCase",
    "EvalResult",
    "ExpectedHandoff",
    "ExpectedToolCall",
    "ScoreResult",
    "load_case_file",
    "load_cases",
    "score_trajectory",
]
```

- [x] **Step 4: Implement `src/runtime/eval/case.py`**

```python
"""EvalCase data models."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ExpectedToolCall(BaseModel):
    tool_name: str
    args_match: dict[str, Any] | None = None
    args_ignore: list[str] = Field(default_factory=list)
    required: bool = True


class ExpectedHandoff(BaseModel):
    to_agent: str
    required: bool = True


class EvalCase(BaseModel):
    id: str
    description: str
    agent: str
    scope: Literal["page", "project", "workspace"]

    input: dict[str, Any]
    fixture: str | None = None

    expected_tools: list[ExpectedToolCall] = Field(default_factory=list)
    expected_handoffs: list[ExpectedHandoff] = Field(default_factory=list)
    forbidden_tools: list[str] = Field(default_factory=list)

    response_contains: list[str] = Field(default_factory=list)
    response_match_llm: str | None = None

    max_duration_ms: int = 60_000
    max_cost_krw: int = 1000
    max_tool_calls: int = 20


__all__ = ["EvalCase", "ExpectedHandoff", "ExpectedToolCall"]
```

- [x] **Step 5: Implement `src/runtime/eval/loader.py`**

```python
"""YAML case loader."""
from __future__ import annotations

from pathlib import Path

import yaml

from runtime.eval.case import EvalCase


def load_case_file(path: Path) -> EvalCase:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return EvalCase.model_validate(raw)


def load_cases(dir_path: str | Path) -> list[EvalCase]:
    """Load every *.yaml under dir_path recursively."""
    p = Path(dir_path)
    return [load_case_file(f) for f in sorted(p.rglob("*.yaml"))]


__all__ = ["load_case_file", "load_cases"]
```

- [x] **Step 6: Implement `src/runtime/eval/metrics.py`**

```python
"""Trajectory scoring — tool match, forbidden, handoff, response, budgets."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from runtime.eval.case import EvalCase, ExpectedToolCall
from runtime.events import AgentEnd, AgentEvent, Handoff, ToolUse


@dataclass
class ScoreResult:
    tool_trajectory_score: float
    forbidden_tool_score: float
    handoff_score: float
    response_contains_score: float
    cost_within_budget: float
    duration_within_budget: float


def _args_match(expected: ExpectedToolCall, actual: dict[str, Any]) -> bool:
    if expected.args_match is None:
        return True
    for k, v in expected.args_match.items():
        if k in expected.args_ignore:
            continue
        if actual.get(k) != v:
            return False
    return True


def score_trajectory(
    case: EvalCase,
    events: list[AgentEvent],
    *,
    total_cost_krw: int,
    duration_ms: int,
) -> ScoreResult:
    tool_uses = [e for e in events if isinstance(e, ToolUse)]
    handoffs = [e for e in events if isinstance(e, Handoff)]
    ends = [e for e in events if isinstance(e, AgentEnd)]

    # Tool trajectory: each required expected_tool must have at least one matching ToolUse
    required = [t for t in case.expected_tools if t.required]
    if not required:
        tool_score = 1.0
    else:
        hits = 0
        for exp in required:
            if any(u.tool_name == exp.tool_name and _args_match(exp, u.input_args) for u in tool_uses):
                hits += 1
        tool_score = hits / len(required)

    # Forbidden tools: zero-tolerance
    if not case.forbidden_tools:
        forbidden_score = 1.0
    else:
        violated = any(u.tool_name in case.forbidden_tools for u in tool_uses)
        forbidden_score = 0.0 if violated else 1.0

    # Handoff: required ones must appear
    required_h = [h for h in case.expected_handoffs if h.required]
    if not required_h:
        handoff_score = 1.0
    else:
        hits = sum(1 for exp in required_h if any(h.to_agent == exp.to_agent for h in handoffs))
        handoff_score = hits / len(required_h)

    # Response contains: all substrings present in AgentEnd.output (serialized)
    if not case.response_contains:
        response_score = 1.0
    elif not ends:
        response_score = 0.0
    else:
        final_text = str(ends[-1].output)
        hits = sum(1 for sub in case.response_contains if sub in final_text)
        response_score = hits / len(case.response_contains)

    cost_score = 1.0 if total_cost_krw <= case.max_cost_krw else 0.0
    duration_score = 1.0 if duration_ms <= case.max_duration_ms else 0.0

    return ScoreResult(
        tool_trajectory_score=tool_score,
        forbidden_tool_score=forbidden_score,
        handoff_score=handoff_score,
        response_contains_score=response_score,
        cost_within_budget=cost_score,
        duration_within_budget=duration_score,
    )


__all__ = ["ScoreResult", "score_trajectory"]
```

- [x] **Step 7: Implement `src/runtime/eval/runner.py`**

```python
"""AgentEvaluator — runs an Agent against an EvalCase and scores the trajectory."""
from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from runtime.agent import Agent
from runtime.eval.case import EvalCase
from runtime.eval.metrics import ScoreResult, score_trajectory
from runtime.events import AgentEnd, AgentError, AgentEvent, ModelEnd
from runtime.tools import ToolContext


DEFAULT_CRITERIA: dict[str, float] = {
    "tool_trajectory_score": 1.0,
    "forbidden_tool_score": 1.0,
    "handoff_score": 1.0,
    "response_contains_score": 0.8,
    "cost_within_budget": 1.0,
    "duration_within_budget": 1.0,
}


@dataclass
class EvalResult:
    case: EvalCase
    events: list[AgentEvent]
    scores: ScoreResult
    total_cost_krw: int
    duration_ms: int

    def assert_passed(self, criteria: dict[str, float]) -> None:
        failures: list[str] = []
        for key, threshold in criteria.items():
            actual = getattr(self.scores, key, None)
            if actual is None:
                failures.append(f"unknown metric: {key}")
                continue
            if actual < threshold:
                failures.append(f"{key}: {actual:.2f} < {threshold:.2f}")
        if failures:
            raise AssertionError(f"Eval case '{self.case.id}' failed:\n  " + "\n  ".join(failures))


class AgentEvaluator:
    @staticmethod
    async def run(
        case: EvalCase,
        *,
        agent_factory: Callable[[], Agent],
        ctx_factory: Callable[[EvalCase], ToolContext] | None = None,
    ) -> EvalResult:
        agent = agent_factory()
        ctx = ctx_factory(case) if ctx_factory else _default_ctx(case)

        collected: list[AgentEvent] = []
        async for ev in agent.run(case.input, ctx):
            collected.append(ev)
            if isinstance(ev, AgentError):
                break

        total_cost = sum(e.cost_krw for e in collected if isinstance(e, ModelEnd))
        ends = [e for e in collected if isinstance(e, AgentEnd)]
        duration = ends[-1].duration_ms if ends else 0

        scores = score_trajectory(case, collected, total_cost_krw=total_cost, duration_ms=duration)
        return EvalResult(case=case, events=collected, scores=scores, total_cost_krw=total_cost, duration_ms=duration)


def _default_ctx(case: EvalCase) -> ToolContext:
    async def _noop(_ev): pass
    return ToolContext(
        workspace_id="eval-ws",
        project_id="eval-project" if case.scope in ("project", "page") else None,
        page_id="eval-page" if case.scope == "page" else None,
        user_id="eval-user",
        run_id=f"eval-{uuid.uuid4()}",
        scope=case.scope,
        emit=_noop,
    )


__all__ = ["AgentEvaluator", "DEFAULT_CRITERIA", "EvalResult"]
```

- [x] **Step 8: Create sample eval case**

`apps/worker/eval/research/basic_scope_respect.yaml`:
```yaml
id: research-001
description: Page scope basic search uses search_pages with scope=page, no out-of-scope fetches
agent: research
scope: page
input:
  query: "프로젝트에서 쓰인 알고리즘 정리"
  page_id: page-abc
expected_tools:
  - tool_name: search_pages
    args_match:
      scope: page
forbidden_tools:
  - fetch_url
  - call_librarian
response_contains:
  - 알고리즘
max_cost_krw: 200
```

- [x] **Step 9: Update `runtime/__init__.py`**

Append:
```python
from runtime.eval import AgentEvaluator, DEFAULT_CRITERIA, EvalCase, ExpectedToolCall
```
Add to `__all__`.

- [x] **Step 10: Run tests**

Run: `cd apps/worker && uv run pytest tests/runtime/test_eval_case.py tests/runtime/test_eval_metrics.py tests/runtime/test_eval_runner.py -v`
Expected: all pass.

- [x] **Step 11: Commit**

```bash
git add apps/worker/src/runtime/eval/ apps/worker/eval/ apps/worker/tests/runtime/test_eval_case.py apps/worker/tests/runtime/test_eval_metrics.py apps/worker/tests/runtime/test_eval_runner.py apps/worker/src/runtime/__init__.py
git commit -m "feat(worker): add trajectory-based eval framework (case/metrics/runner)"
```

---

## Task 14: Linting Rules + Antipatterns Documentation

**Files:**
- Modify: `apps/worker/pyproject.toml` — add custom ruff rule + import boundary
- Create: `apps/worker/scripts/check_import_boundaries.py`
- Modify: `docs/contributing/llm-antipatterns.md`

- [x] **Step 1: Create import boundary checker**

`apps/worker/scripts/check_import_boundaries.py`:
```python
#!/usr/bin/env python
"""Fail if apps/worker/src/worker/agents/**/*.py imports langgraph or langchain_core directly.

Agents must import only from `runtime`.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

FORBIDDEN_MODULES = {"langgraph", "langchain_core", "langchain"}
AGENTS_DIR = Path(__file__).parent.parent / "src" / "worker" / "agents"


def check_file(path: Path) -> list[str]:
    violations: list[str] = []
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError as e:
        return [f"{path}: syntax error {e}"]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in FORBIDDEN_MODULES:
                    violations.append(f"{path}:{node.lineno}: direct import of {alias.name} — use `from runtime import ...`")
        elif isinstance(node, ast.ImportFrom) and node.module:
            root = node.module.split(".")[0]
            if root in FORBIDDEN_MODULES:
                violations.append(f"{path}:{node.lineno}: direct import from {node.module} — use `from runtime import ...`")
    return violations


def main() -> int:
    if not AGENTS_DIR.exists():
        print(f"agents dir {AGENTS_DIR} does not exist — skipping (Plan 4 hasn't run yet)")
        return 0
    all_violations: list[str] = []
    for py in AGENTS_DIR.rglob("*.py"):
        all_violations.extend(check_file(py))
    if all_violations:
        print("Import boundary violations:")
        for v in all_violations:
            print(f"  {v}")
        return 1
    print("OK — no direct langgraph/langchain imports in agents/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [x] **Step 2: Add script to pyproject**

Edit `apps/worker/pyproject.toml`, add to `[tool.uv]` or as alias via shell. Add shell entry:
```toml
[project.scripts]
check-import-boundaries = "scripts.check_import_boundaries:main"
```

- [x] **Step 3: Run checker (expect skip)**

Run: `cd apps/worker && uv run python scripts/check_import_boundaries.py`
Expected: "agents dir ... does not exist — skipping".

- [x] **Step 4: Update `docs/contributing/llm-antipatterns.md`**

Append section at the end of the file (create file if missing, with a single top heading `# LLM Antipatterns`):

```markdown
## Agent Runtime Rules (spec: 2026-04-20-agent-runtime-standard-design.md)

### ❌ Direct `langgraph` or `langchain_core` imports in agents

Every file under `apps/worker/src/worker/agents/**/*.py` MUST import only from `runtime`.

```python
# ❌ 금지
from langgraph.graph import StateGraph
from langchain_core.messages import HumanMessage

# ✅ 허용
from runtime import Agent, tool, AgentEvent, keep_last_n
```

Enforcement: `apps/worker/scripts/check_import_boundaries.py` runs in CI.

### ❌ Mutating LangGraph channel state

```python
# ❌ 금지 — 전염됨
def node(state):
    state["messages"].append(msg)
    return {}

# ✅ 리듀서에 맡김
def node(state):
    return {"messages": [msg]}
```

### ❌ `operator.add`로 무한 누적 리스트

```python
# ❌ 금지
messages: Annotated[list, operator.add]

# ✅
from runtime import keep_last_n
messages: Annotated[list, keep_last_n(50)]
```

### ❌ `interrupt()` across Temporal activity boundary

LangGraph's `interrupt()` assumes the caller can pause/resume in real time. Activities are isolated execution units — the resume context is lost across activity retries. Use Temporal signals instead:

```python
# Agent yields AwaitingInput → activity raises AgentAwaitingInputError →
# workflow catches, waits for provide_input signal, re-invokes activity with resume value.
```

### ❌ Same `thread_id` in two concurrent activities

LangGraph checkpoint race. Use `make_thread_id(workflow_id, agent_name, parent_run_id)` which is unique per handoff subtree.

### ❌ Registering LangGraph callbacks directly from agent code

OpenCairn's `LangGraphBridgeCallback` is the single attach point. Agents register via `HookRegistry`, not by calling `graph.compile(callbacks=[...])`.
```

- [x] **Step 5: Commit**

```bash
git add apps/worker/scripts/check_import_boundaries.py apps/worker/pyproject.toml docs/contributing/llm-antipatterns.md
git commit -m "chore(worker,docs): add import boundary check + runtime antipatterns doc"
```

---

## Task 15: End-to-end Integration Test (EchoAgent smoke)

**Files:**
- Create: `apps/worker/tests/runtime/test_integration_echo_agent.py`

- [x] **Step 1: Write the integration test**

```python
"""End-to-end: EchoAgent runs with full hook chain, writes trajectory,
tokens are counted, eval case passes. No external services (local filesystem only)."""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

import pytest

from runtime.agent import Agent
from runtime.default_hooks import TokenCounterHook, TrajectoryWriterHook
from runtime.eval.case import EvalCase, ExpectedToolCall
from runtime.eval.runner import DEFAULT_CRITERIA, AgentEvaluator
from runtime.events import AgentEnd, AgentEvent, AgentStart, ModelEnd, ToolResult, ToolUse
from runtime.hooks import HookRegistry
from runtime.tools import ToolContext
from runtime.trajectory import LocalFSTrajectoryStorage, TrajectoryWriter


class EchoAgent(Agent):
    """Echo input back. Emits one ModelEnd + one ToolUse/Result to exercise full event set."""

    name = "echo"
    description = "Echo agent for integration testing."

    async def run(self, input: dict[str, Any], ctx: ToolContext) -> AsyncGenerator[AgentEvent, None]:
        yield AgentStart(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=0, ts=1.0, type="agent_start", scope=ctx.scope, input=input,
        )
        yield ModelEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=1, ts=1.1, type="model_end", model_id="gemini-3-pro",
            prompt_tokens=100, completion_tokens=30, cached_tokens=0,
            cost_krw=8, finish_reason="stop", latency_ms=600,
        )
        yield ToolUse(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=2, ts=1.2, type="tool_use", tool_call_id="c0",
            tool_name="search_pages", input_args={"scope": ctx.scope, "query": input.get("query", "")},
            input_hash="h", concurrency_safe=True,
        )
        yield ToolResult(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=3, ts=1.3, type="tool_result", tool_call_id="c0",
            ok=True, output=[{"id": "p1", "title": "알고리즘 노트"}], duration_ms=40,
        )
        yield AgentEnd(
            run_id=ctx.run_id, workspace_id=ctx.workspace_id, agent_name=self.name,
            seq=4, ts=1.5, type="agent_end",
            output={"answer": f"프로젝트 알고리즘: {input.get('query', '')}"},
            duration_ms=500,
        )


async def test_full_pipeline(tmp_trajectory_dir: Path) -> None:
    # Build hooks with test storage
    storage = LocalFSTrajectoryStorage(base_dir=tmp_trajectory_dir)

    class TestTrajectoryHook(TrajectoryWriterHook):
        async def _build_writer(self, ctx: ToolContext) -> TrajectoryWriter:
            w = TrajectoryWriter(storage=storage, run_id=ctx.run_id, workspace_id=ctx.workspace_id)
            await w.open()
            return w

    traj_hook = TestTrajectoryHook()
    token_hook = TokenCounterHook()

    reg = HookRegistry()
    reg.register(traj_hook, scope="global")
    reg.register(token_hook, scope="global")

    # Build eval case
    case = EvalCase(
        id="echo-1",
        description="EchoAgent emits all events and matches expectations",
        agent="echo",
        scope="page",
        input={"query": "알고리즘"},
        expected_tools=[ExpectedToolCall(tool_name="search_pages", args_match={"scope": "page"})],
        response_contains=["알고리즘"],
        max_cost_krw=100,
    )

    # Wire ctx so hooks observe events
    async def _emit(ev: AgentEvent) -> None:
        await traj_hook.on_event(_ctx, ev)
        await token_hook.on_event(_ctx, ev)

    _ctx = ToolContext(
        workspace_id="ws-1", project_id="proj-1", page_id="page-1",
        user_id="u-1", run_id="run-echo-1", scope="page", emit=_emit,
    )

    async def _factory() -> EchoAgent:
        return EchoAgent()

    # Manually run agent through the same emit so hooks see everything
    agent = EchoAgent()
    events: list[AgentEvent] = []
    async for ev in agent.run(case.input, _ctx):
        events.append(ev)
        await _emit(ev)

    # Verify trajectory file exists
    files = list(tmp_trajectory_dir.rglob("*.ndjson"))
    assert len(files) == 1
    lines = files[0].read_text(encoding="utf-8").splitlines()
    assert len(lines) == 5
    parsed = [json.loads(line) for line in lines]
    assert [p["type"] for p in parsed] == [
        "agent_start", "model_end", "tool_use", "tool_result", "agent_end",
    ]

    # Verify token counter
    totals = token_hook.totals(_ctx.run_id)
    assert totals.prompt_tokens == 100
    assert totals.cost_krw == 8
    assert totals.model_call_count == 1

    # Verify eval scoring
    from runtime.eval.metrics import score_trajectory
    scores = score_trajectory(
        case, events,
        total_cost_krw=totals.cost_krw, duration_ms=500,
    )
    assert scores.tool_trajectory_score == 1.0
    assert scores.forbidden_tool_score == 1.0
    assert scores.response_contains_score == 1.0
    assert scores.cost_within_budget == 1.0
```

- [x] **Step 2: Run the test**

Run: `cd apps/worker && uv run pytest tests/runtime/test_integration_echo_agent.py -v`
Expected: PASS.

- [x] **Step 3: Run full test suite**

Run: `cd apps/worker && uv run pytest tests/runtime/ -v`
Expected: all previous tasks' tests + integration PASS. No failures.

- [x] **Step 4: Commit**

```bash
git add apps/worker/tests/runtime/test_integration_echo_agent.py
git commit -m "test(worker): add end-to-end EchoAgent integration smoke"
```

---

## Task 16: Plan Cross-references — Update Existing Plans

**Files:**
- Modify: `docs/superpowers/plans/2026-04-09-plan-4-agent-core.md`
- Modify: `docs/superpowers/plans/2026-04-13-multi-llm-provider.md`
- Modify: `docs/superpowers/plans/2026-04-09-plan-1-foundation.md`
- Modify: `CLAUDE.md`

- [x] **Step 1: Update Plan 4 Task 0 prerequisites**

Edit `docs/superpowers/plans/2026-04-09-plan-4-agent-core.md` — insert after the existing "Step 4: VECTOR_DIM env 일관성 검증" but before "위 4단계 중 하나라도 실패하면 STOP":

```markdown
- [x] **Step 5: Plan 12 (Agent Runtime) prerequisite 검증**

`apps/worker/src/runtime/` 패키지가 구축되어 있고 `from runtime import Agent, tool, AgentEvent` 가 성공해야 함.

```bash
cd apps/worker && uv run python -c "from runtime import Agent, Tool, tool, AgentEvent, HookRegistry, stream_graph_as_events, AgentEvaluator; print('OK')"
```
Expected: "OK". ImportError면 Plan 12 미완.
```

Change the "위 4단계" to "위 5단계".

- [x] **Step 2: Add Plan 12 reference in Plan 4 header block**

Add to the top-of-file update notes:
```markdown
> **⚠️ Agent Runtime Standard (2026-04-20):** 본 plan의 Compiler/Research/Librarian은 `runtime.Agent` 서브클래스 패턴을 따른다. 직접 `langgraph.StateGraph`를 노출하지 말고 내부 구현으로 숨긴다. Plan 12 (`2026-04-20-plan-12-agent-runtime.md`)를 먼저 완료해야 한다.
```

- [x] **Step 3: Update multi-llm plan**

Edit `docs/superpowers/plans/2026-04-13-multi-llm-provider.md`. Add a Task near the end (after current last task):

```markdown
### Task N+1: Tool Declaration Methods

**Files:**
- Modify: `packages/llm/src/llm/base.py`
- Modify: `packages/llm/src/llm/gemini.py`
- Modify: `packages/llm/src/llm/ollama.py`

Add `build_tool_declarations(tools: list) -> list[dict]` method. Default raises NotImplementedError; Gemini and Ollama implement via `runtime.tool_declarations` (lazy import to avoid circular). See Plan 12 Task 5.
```

- [x] **Step 4: Update Plan 1 to include agent_runs**

Edit `docs/superpowers/plans/2026-04-09-plan-1-foundation.md`. In the DB schema task list, add:

```markdown
Note: `packages/db/src/schema/agent-runs.ts` is built in Plan 12 Task 9 (after Plan 1 establishes workspaces/users/projects/pages tables). Plan 1 does NOT need to create it.
```

- [x] **Step 5: Update CLAUDE.md Implementation Plans table**

Edit `CLAUDE.md` — add row in the Phase 0 section (after multi-llm-provider row):

```markdown
| **0 — Foundation (직렬)** | `plans/2026-04-20-plan-12-agent-runtime.md` | **Agent runtime facade**: Tool/@tool, AgentEvent, Agent ABC, 3-tier hooks, trajectory (Postgres + NDJSON), eval framework, Temporal helpers. **Plan 4/5/6/7/8보다 먼저 필수**. Spec: `2026-04-20-agent-runtime-standard-design.md` |
```

Update the Phase 1 rows that mention Plan 4-dependent plans to note "Plan 12 후" as prerequisite.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-04-09-plan-4-agent-core.md docs/superpowers/plans/2026-04-13-multi-llm-provider.md docs/superpowers/plans/2026-04-09-plan-1-foundation.md CLAUDE.md
git commit -m "docs(plans): cross-reference Plan 12 as prerequisite for Plans 4/5/6/7/8"
```

---

## Final Verification

- [x] **Step 1: Run full test suite**

Run: `cd apps/worker && uv run pytest -v`
Expected: all tests PASS.

- [x] **Step 2: Type check**

Run: `cd apps/worker && uv run pyright src/runtime`
Expected: 0 errors.

- [x] **Step 3: Ruff lint**

Run: `cd apps/worker && uv run ruff check src/runtime tests/runtime`
Expected: 0 violations.

- [x] **Step 4: Import boundary check**

Run: `cd apps/worker && uv run python scripts/check_import_boundaries.py`
Expected: "OK — no direct langgraph/langchain imports" (or "agents dir does not exist — skipping" before Plan 4).

- [x] **Step 5: Public API smoke**

Run:
```bash
cd apps/worker && uv run python -c "
from runtime import (
    Agent, Tool, ToolContext, AgentEvent,
    AgentStart, AgentEnd, AgentError, ModelEnd,
    ToolUse, ToolResult, Handoff, AwaitingInput, CustomEvent,
    tool, get_tools_for_agent,
    AgentHook, ModelHook, ToolHook, HookRegistry,
    keep_last_n,
    make_thread_id, AgentAwaitingInputError,
    AgentEvaluator, EvalCase, DEFAULT_CRITERIA,
    TrajectoryWriterHook, TokenCounterHook,
    stream_graph_as_events,
)
print('Public API OK')
"
```
Expected: "Public API OK".

- [x] **Step 6: Confirm no regressions in packages/llm or packages/db**

Run:
```bash
pnpm --filter @opencairn/db test
pnpm --filter @opencairn/db typecheck
cd packages/llm && uv run pytest && cd ../..
```
Expected: all green.

- [x] **Step 7: Ready for Plan 4**

Update memory:
```bash
# Reminder for future sessions
```

Verify:
```bash
git log --oneline -20
```

Expect to see the commit sequence: scaffold → events → zod → tools → tool_declarations → reducers → hooks → agent → agent_runs → trajectory → default_hooks → temporal → eval → linting → integration → cross-refs.

---

## Self-Review Checklist (skill compliance)

1. **Spec coverage**: Every § of spec has at least one task
   - §1 code location → Task 1
   - §2 tool interface → Tasks 4, 5
   - §3 AgentEvent → Tasks 2, 3
   - §4 Agent base → Task 8
   - §5 hooks → Task 7, 11
   - §6 trajectory → Tasks 9, 10
   - §7 eval → Task 13
   - §8 Temporal → Task 12 (+ reducers in Task 6)
   - §9 Public API → incremental in every task's `__init__.py` update
   - §10 plan impacts → Task 16
   - §11 decisions summary → captured throughout

2. **Placeholder scan**: No "TBD", "TODO", "implement later" in the plan text.

3. **Type consistency**: `Tool`, `ToolContext`, `AgentEvent`, `Agent`, `HookRegistry`, `HookChain`, `AgentEvaluator`, `EvalCase` names match across tasks.

4. **Deferred from spec (explicitly)**:
   - S3/MinIO storage backend: scaffolded via `resolve_storage_from_env` but `trajectory_s3.py` not implemented in this plan. Will be a follow-up plan or added when hosted deployment needs it.
   - `LatencyHook` (OpenTelemetry): not critical for v0.1, deferred.
   - Replay eval mode (`uv run eval replay`): deferred; runner supports fresh runs only. Existing `AgentEvaluator.run` can be driven from stored trajectory in a follow-up.
   - HTML report: deferred.
   - `agent` scope filter by exact agent_name: implemented; see `resolve_for_agent`.
   - Checkpoint pruning activity: belongs in Plan 4 Task 2 (Temporal worker registration).
