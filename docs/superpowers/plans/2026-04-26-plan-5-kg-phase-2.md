# Plan 5 · Knowledge Graph Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 의 `mode='graph'` 단일 Cytoscape 뷰를 5뷰 (graph / mindmap / cards / timeline / board) 인-탭 ViewSwitcher 로 확장하고, Sub-A `run_with_tools` 위에 자연어 입력을 ViewSpec 으로 변환하는 VisualizationAgent + SSE `POST /api/visualize` 표면을 구축한다.

**Architecture:** 결정 경로 (`/api/projects/:id/graph?view=&root=` 확장) 는 즉시·캐시 가능하고 LLM 비용 0; NL 경로 (`POST /api/visualize` SSE) 만 VisualizationAgent 를 거쳐 `emit_structured_output(schema_name="ViewSpec")` 로 종결. Cytoscape (graph/mindmap/board) + React-native (cards/timeline) 스택. DB 변경 0.

**Tech Stack:** Next.js 16, React 19, Hono 4, Drizzle ORM, Cytoscape.js + cytoscape-fcose (Phase 1 기존) + cytoscape-dagre (신규), Pydantic v2, Temporal Python SDK, runtime/loop_runner Sub-A, Zod, TanStack Query, Zustand, next-intl.

**Spec:** [docs/superpowers/specs/2026-04-26-plan-5-kg-phase-2-design.md](../specs/2026-04-26-plan-5-kg-phase-2-design.md)

**Branch / worktree:** `feat/plan-5-kg-phase-2` (이미 생성됨, `.worktrees/plan-5-kg-phase-2`)

**Important codebase notes (memory-derived):**
- `apps/api` ESM imports: `src/` 는 extensionless (`from "./foo"`), `tests/` 는 `.js` 확장자 (`from "./foo.js"`). 실 파일 grep 우선
- `feedback_internal_api_workspace_scope` — `/api/internal/*` 쓰기 라우트 전부 `workspaceId` body 명시 + `projects.workspaceId` 대조
- Phase 1 패턴: cytoscape 라이브러리는 `^` floating 금지, dynamic import + `{ ssr: false }`, regression CI grep guard

---

## Task 1: ViewSpec Zod 스키마 (`packages/shared`)

`POST /api/visualize` SSE 응답과 `GET /api/projects/:id/graph?view=` 응답이 둘 다 ViewSpec shape 이라 shared 가 첫 번째 의존.

**Files:**
- Modify: `packages/shared/src/api-types.ts`
- Test: `packages/shared/src/__tests__/view-spec.test.ts` (신규)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/view-spec.test.ts
import { describe, it, expect } from "vitest";
import {
  ViewType,
  ViewLayout,
  ViewNode,
  ViewEdge,
  ViewSpec,
  GraphViewResponse,
} from "../api-types";

describe("ViewSpec schema", () => {
  it("accepts a minimal valid mindmap ViewSpec", () => {
    const result = ViewSpec.parse({
      viewType: "mindmap",
      layout: "dagre",
      rootId: "11111111-1111-4111-8111-111111111111",
      nodes: [
        { id: "11111111-1111-4111-8111-111111111111", name: "Root" },
      ],
      edges: [],
    });
    expect(result.viewType).toBe("mindmap");
  });

  it("rejects unknown viewType", () => {
    expect(() => ViewType.parse("bogus")).toThrow();
  });

  it("accepts eventYear in nodes", () => {
    const node = ViewNode.parse({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Trans",
      eventYear: 2017,
    });
    expect(node.eventYear).toBe(2017);
  });

  it("rejects edges with weight > 1", () => {
    expect(() =>
      ViewEdge.parse({
        sourceId: "11111111-1111-4111-8111-111111111111",
        targetId: "22222222-2222-4222-8222-222222222222",
        relationType: "uses",
        weight: 2,
      }),
    ).toThrow();
  });

  it("caps nodes at 500", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      name: `n${i}`,
    }));
    expect(() =>
      ViewSpec.parse({
        viewType: "graph",
        layout: "fcose",
        rootId: null,
        nodes: tooMany,
        edges: [],
      }),
    ).toThrow();
  });

  it("GraphViewResponse extends ViewSpec with truncated/totalConcepts", () => {
    const result = GraphViewResponse.parse({
      viewType: "graph",
      layout: "fcose",
      rootId: null,
      nodes: [],
      edges: [],
      truncated: false,
      totalConcepts: 0,
    });
    expect(result.truncated).toBe(false);
    expect(result.totalConcepts).toBe(0);
  });

  it("ViewLayout enum exposes all 4 layouts", () => {
    expect(ViewLayout.options).toEqual([
      "fcose",
      "dagre",
      "preset",
      "cose-bilkent",
    ]);
  });
});
```

- [ ] **Step 2: Run test — should FAIL with "ViewType is not exported"**

```bash
pnpm --filter @opencairn/shared test view-spec
```

- [ ] **Step 3: Add ViewSpec schemas**

`packages/shared/src/api-types.ts` 끝에 추가:

```ts
// ─── Plan 5 Phase 2: ViewSpec ────────────────────────────────────────

export const ViewType = z.enum([
  "graph", "mindmap", "cards", "timeline", "board",
]);
export type ViewType = z.infer<typeof ViewType>;

export const ViewLayout = z.enum(["fcose", "dagre", "preset", "cose-bilkent"]);
export type ViewLayout = z.infer<typeof ViewLayout>;

export const ViewNode = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  degree: z.number().int().min(0).optional(),
  noteCount: z.number().int().min(0).optional(),
  firstNoteId: z.string().uuid().nullable().optional(),
  eventYear: z.number().int().min(-3000).max(3000).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type ViewNode = z.infer<typeof ViewNode>;

export const ViewEdge = z.object({
  id: z.string().uuid().optional(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  relationType: z.string(),
  weight: z.number().min(0).max(1),
});
export type ViewEdge = z.infer<typeof ViewEdge>;

export const ViewSpec = z.object({
  viewType: ViewType,
  layout: ViewLayout,
  rootId: z.string().uuid().nullable(),
  nodes: z.array(ViewNode).max(500),
  edges: z.array(ViewEdge).max(2000),
  rationale: z.string().max(200).optional(),
});
export type ViewSpec = z.infer<typeof ViewSpec>;

export const GraphViewResponse = ViewSpec.extend({
  truncated: z.boolean(),
  totalConcepts: z.number().int().min(0),
});
export type GraphViewResponse = z.infer<typeof GraphViewResponse>;
```

- [ ] **Step 4: Run tests — should PASS**

```bash
pnpm --filter @opencairn/shared test view-spec
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api-types.ts packages/shared/src/__tests__/view-spec.test.ts
git commit -m "feat(shared): add ViewSpec Zod schemas (Plan 5 Phase 2)"
```

---

## Task 2: ViewSpec Pydantic 스키마 + register (worker)

**Files:**
- Create: `apps/worker/src/worker/tools_builtin/view_spec_schema.py`
- Modify: `apps/worker/src/worker/tools_builtin/__init__.py` (import for side-effect)
- Test: `apps/worker/tests/tools_builtin/test_view_spec_schema.py` (신규)

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/tools_builtin/test_view_spec_schema.py
import pytest
from pydantic import ValidationError

from worker.tools_builtin.view_spec_schema import ViewSpec
from worker.tools_builtin.schema_registry import SCHEMA_REGISTRY


def _node(id_: str, **kw):
    return {"id": id_, "name": kw.pop("name", "n"), **kw}


def _edge(s: str, t: str, **kw):
    return {
        "sourceId": s,
        "targetId": t,
        "relationType": kw.pop("relationType", "uses"),
        "weight": kw.pop("weight", 0.5),
        **kw,
    }


U1 = "11111111-1111-4111-8111-111111111111"
U2 = "22222222-2222-4222-8222-222222222222"
U3 = "33333333-3333-4333-8333-333333333333"


def test_view_spec_registered_in_registry():
    assert "ViewSpec" in SCHEMA_REGISTRY
    assert SCHEMA_REGISTRY["ViewSpec"] is ViewSpec


def test_minimal_graph_view_validates():
    spec = ViewSpec.model_validate({
        "viewType": "graph", "layout": "fcose", "rootId": None,
        "nodes": [_node(U1)], "edges": [],
    })
    assert spec.viewType == "graph"


def test_mindmap_requires_root_id():
    with pytest.raises(ValidationError, match="rootId is required"):
        ViewSpec.model_validate({
            "viewType": "mindmap", "layout": "dagre", "rootId": None,
            "nodes": [_node(U1)], "edges": [],
        })


def test_board_requires_root_id():
    with pytest.raises(ValidationError, match="rootId is required"):
        ViewSpec.model_validate({
            "viewType": "board", "layout": "preset", "rootId": None,
            "nodes": [_node(U1)], "edges": [],
        })


def test_dangling_source_edge_rejected():
    with pytest.raises(ValidationError, match="dangling"):
        ViewSpec.model_validate({
            "viewType": "graph", "layout": "fcose", "rootId": None,
            "nodes": [_node(U1)],
            "edges": [_edge(U2, U1)],  # U2 not in nodes
        })


def test_dangling_target_edge_rejected():
    with pytest.raises(ValidationError, match="dangling"):
        ViewSpec.model_validate({
            "viewType": "graph", "layout": "fcose", "rootId": None,
            "nodes": [_node(U1)],
            "edges": [_edge(U1, U3)],
        })


def test_node_cap_per_view_type_mindmap_50():
    nodes = [_node(f"11111111-1111-4111-8111-{i:012d}") for i in range(51)]
    with pytest.raises(ValidationError, match="too many nodes"):
        ViewSpec.model_validate({
            "viewType": "mindmap", "layout": "dagre", "rootId": nodes[0]["id"],
            "nodes": nodes, "edges": [],
        })


def test_node_cap_cards_80():
    nodes = [_node(f"11111111-1111-4111-8111-{i:012d}") for i in range(81)]
    with pytest.raises(ValidationError, match="too many nodes"):
        ViewSpec.model_validate({
            "viewType": "cards", "layout": "preset", "rootId": None,
            "nodes": nodes, "edges": [],
        })


def test_rationale_max_200():
    with pytest.raises(ValidationError):
        ViewSpec.model_validate({
            "viewType": "graph", "layout": "fcose", "rootId": None,
            "nodes": [], "edges": [],
            "rationale": "x" * 201,
        })


def test_event_year_optional():
    spec = ViewSpec.model_validate({
        "viewType": "timeline", "layout": "preset", "rootId": None,
        "nodes": [_node(U1, eventYear=2017)],
        "edges": [],
    })
    assert spec.nodes[0].eventYear == 2017
```

- [ ] **Step 2: Run test — should FAIL (module not found)**

```bash
cd apps/worker && uv run pytest tests/tools_builtin/test_view_spec_schema.py -v
```

- [ ] **Step 3: Create the schema file**

```python
# apps/worker/src/worker/tools_builtin/view_spec_schema.py
"""ViewSpec schema for emit_structured_output (Plan 5 Phase 2).

Registered in SCHEMA_REGISTRY at import time. VisualizationAgent imports
this module purely for its registration side-effect.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from worker.tools_builtin.schema_registry import register_schema

NODE_CAPS = {
    "mindmap": 50, "timeline": 50, "cards": 80, "board": 200, "graph": 200,
}


class ViewSpecNode(BaseModel):
    id: str
    name: str
    description: str | None = None
    degree: int | None = None
    noteCount: int | None = None
    firstNoteId: str | None = None
    eventYear: int | None = Field(default=None, ge=-3000, le=3000)
    position: dict | None = None


class ViewSpecEdge(BaseModel):
    sourceId: str
    targetId: str
    relationType: str
    weight: float = Field(ge=0, le=1)


class ViewSpec(BaseModel):
    viewType: Literal["graph", "mindmap", "cards", "timeline", "board"]
    layout: Literal["fcose", "dagre", "preset", "cose-bilkent"]
    rootId: str | None
    nodes: list[ViewSpecNode] = Field(max_length=500)
    edges: list[ViewSpecEdge] = Field(max_length=2000)
    rationale: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _structural_constraints(self) -> "ViewSpec":
        if self.viewType in ("mindmap", "board") and not self.rootId:
            raise ValueError(f"rootId is required for viewType={self.viewType}")
        cap = NODE_CAPS[self.viewType]
        if len(self.nodes) > cap:
            raise ValueError(
                f"too many nodes for viewType={self.viewType}: "
                f"{len(self.nodes)} > {cap}"
            )
        node_ids = {n.id for n in self.nodes}
        for i, e in enumerate(self.edges):
            if e.sourceId not in node_ids:
                raise ValueError(f"edge[{i}].sourceId dangling: {e.sourceId}")
            if e.targetId not in node_ids:
                raise ValueError(f"edge[{i}].targetId dangling: {e.targetId}")
        return self


register_schema("ViewSpec", ViewSpec)
```

- [ ] **Step 4: Make registration happen on package import**

`apps/worker/src/worker/tools_builtin/__init__.py` 끝에 추가:

```python
# Side-effect import: registers ViewSpec in SCHEMA_REGISTRY (Plan 5 Phase 2).
from . import view_spec_schema  # noqa: F401
```

- [ ] **Step 5: Run tests — should PASS**

```bash
cd apps/worker && uv run pytest tests/tools_builtin/test_view_spec_schema.py -v
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/tools_builtin/view_spec_schema.py \
  apps/worker/src/worker/tools_builtin/__init__.py \
  apps/worker/tests/tools_builtin/test_view_spec_schema.py
git commit -m "feat(worker): register ViewSpec schema for emit_structured_output (Plan 5 Phase 2)"
```

---

## Task 3: `AgentApiClient.expand_concept_graph` 메소드

**Files:**
- Modify: `apps/worker/src/worker/lib/api_client.py`
- Test: `apps/worker/tests/lib/test_api_client_expand.py` (신규)

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/lib/test_api_client_expand.py
from unittest.mock import AsyncMock, patch

import pytest

from worker.lib.api_client import AgentApiClient


@pytest.mark.asyncio
async def test_expand_concept_graph_posts_to_internal_endpoint():
    client = AgentApiClient()
    fake_response = {"nodes": [{"id": "x"}], "edges": []}
    with patch(
        "worker.lib.api_client.post_internal",
        new=AsyncMock(return_value=fake_response),
    ) as post_mock:
        result = await client.expand_concept_graph(
            project_id="proj-1",
            workspace_id="ws-1",
            user_id="user-1",
            concept_id="concept-1",
            hops=2,
        )
    assert result == fake_response
    post_mock.assert_awaited_once_with(
        "/api/internal/projects/proj-1/graph/expand",
        {
            "conceptId": "concept-1",
            "hops": 2,
            "workspaceId": "ws-1",
            "userId": "user-1",
        },
    )


@pytest.mark.asyncio
async def test_expand_concept_graph_default_hops_one():
    client = AgentApiClient()
    with patch(
        "worker.lib.api_client.post_internal",
        new=AsyncMock(return_value={"nodes": [], "edges": []}),
    ) as post_mock:
        await client.expand_concept_graph(
            project_id="p", workspace_id="w", user_id="u", concept_id="c",
        )
    body = post_mock.await_args.args[1]
    assert body["hops"] == 1
```

- [ ] **Step 2: Run test — should FAIL (method missing)**

```bash
cd apps/worker && uv run pytest tests/lib/test_api_client_expand.py -v
```

- [ ] **Step 3: Add the method to AgentApiClient**

`apps/worker/src/worker/lib/api_client.py` 의 `AgentApiClient` 클래스 안에 추가 (적절한 위치 — 기존 `search_concepts` 근처):

```python
async def expand_concept_graph(
    self,
    *,
    project_id: str,
    workspace_id: str,
    user_id: str,
    concept_id: str,
    hops: int = 1,
) -> dict[str, Any]:
    """POST /api/internal/projects/:id/graph/expand.

    Carries workspace_id + user_id in the body so the API can enforce
    the canRead chain + projects.workspaceId match (internal API
    workspace scope memo). Plan 5 Phase 2.
    """
    return await post_internal(
        f"/api/internal/projects/{project_id}/graph/expand",
        {
            "conceptId": concept_id,
            "hops": hops,
            "workspaceId": workspace_id,
            "userId": user_id,
        },
    )
```

- [ ] **Step 4: Run tests — should PASS**

```bash
cd apps/worker && uv run pytest tests/lib/test_api_client_expand.py -v
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/lib/api_client.py apps/worker/tests/lib/test_api_client_expand.py
git commit -m "feat(worker): add AgentApiClient.expand_concept_graph (Plan 5 Phase 2)"
```

---

## Task 4: `get_concept_graph` 빌트인 툴

**Files:**
- Create: `apps/worker/src/worker/tools_builtin/get_concept_graph.py`
- Modify: `apps/worker/src/worker/tools_builtin/__init__.py` (export + BUILTIN_TOOLS)
- Test: `apps/worker/tests/tools_builtin/test_get_concept_graph.py` (신규)

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/tools_builtin/test_get_concept_graph.py
from unittest.mock import AsyncMock, patch

import pytest

from runtime.tools import ToolContext
from worker.tools_builtin.get_concept_graph import get_concept_graph


def _ctx(**kw):
    return ToolContext(
        workspace_id=kw.pop("workspace_id", "ws-1"),
        project_id=kw.pop("project_id", "proj-1"),
        page_id=None,
        user_id=kw.pop("user_id", "user-1"),
        run_id="run-1",
        scope="project",
        emit=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_calls_expand_concept_graph_with_ctx_values():
    ctx = _ctx()
    fake = {"nodes": [{"id": "n1"}], "edges": []}
    with patch(
        "worker.tools_builtin.get_concept_graph.AgentApiClient",
    ) as klass:
        instance = klass.return_value
        instance.expand_concept_graph = AsyncMock(return_value=fake)
        result = await get_concept_graph.run(
            {"concept_id": "c-1", "hops": 2}, ctx,
        )
    assert result == fake
    instance.expand_concept_graph.assert_awaited_once_with(
        project_id="proj-1",
        workspace_id="ws-1",
        user_id="user-1",
        concept_id="c-1",
        hops=2,
    )


@pytest.mark.asyncio
async def test_hops_out_of_range_returns_error_dict():
    ctx = _ctx()
    res_low = await get_concept_graph.run({"concept_id": "c", "hops": 0}, ctx)
    res_high = await get_concept_graph.run({"concept_id": "c", "hops": 4}, ctx)
    assert res_low == {"error": "hops_out_of_range"}
    assert res_high == {"error": "hops_out_of_range"}


@pytest.mark.asyncio
async def test_default_hops_one():
    ctx = _ctx()
    with patch(
        "worker.tools_builtin.get_concept_graph.AgentApiClient",
    ) as klass:
        instance = klass.return_value
        instance.expand_concept_graph = AsyncMock(return_value={})
        await get_concept_graph.run({"concept_id": "c"}, ctx)
    instance.expand_concept_graph.assert_awaited_once()
    assert instance.expand_concept_graph.await_args.kwargs["hops"] == 1


def test_tool_metadata():
    assert get_concept_graph.name == "get_concept_graph"
    assert "project" in get_concept_graph.allowed_scopes
```

- [ ] **Step 2: Run test — should FAIL**

```bash
cd apps/worker && uv run pytest tests/tools_builtin/test_get_concept_graph.py -v
```

- [ ] **Step 3: Implement the tool**

```python
# apps/worker/src/worker/tools_builtin/get_concept_graph.py
"""get_concept_graph — N-hop subgraph fetch tool.

Wraps AgentApiClient.expand_concept_graph against the internal route
/api/internal/projects/:id/graph/expand. Used by VisualizationAgent
and reusable by other agents.

Mirrors `search_concepts.py`: client is instantiated inside the tool
(env-driven), workspace_id/user_id come from `ctx: ToolContext`.
"""
from __future__ import annotations

from runtime.tools import ToolContext, tool
from worker.lib.api_client import AgentApiClient


@tool(name="get_concept_graph", allowed_scopes=("project",))
async def get_concept_graph(
    concept_id: str,
    ctx: ToolContext,
    hops: int = 1,
) -> dict:
    """Return concepts + edges within `hops` of `concept_id`.

    Args:
        concept_id: starting concept (project-scoped).
        hops: 1-3, capped at 3 server-side.
    Returns:
        {"nodes": [{id,name,description,degree,noteCount,firstNoteId}],
         "edges": [{id,sourceId,targetId,relationType,weight}]}
    """
    if hops < 1 or hops > 3:
        return {"error": "hops_out_of_range"}
    client = AgentApiClient()
    return await client.expand_concept_graph(
        project_id=ctx.project_id or "",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user_id,
        concept_id=concept_id,
        hops=hops,
    )
```

- [ ] **Step 4: Export + add to BUILTIN_TOOLS**

`apps/worker/src/worker/tools_builtin/__init__.py` — 기존 import 블록에 추가하고 `BUILTIN_TOOLS` 튜플에 포함:

```python
from .get_concept_graph import get_concept_graph
# ... 기존 imports

BUILTIN_TOOLS = (
    # ... 기존 항목
    get_concept_graph,
)

__all__ = [
    # ... 기존
    "get_concept_graph",
]
```

(정확한 위치는 surrounding imports 패턴에 맞춰서. 알파벳 정렬이면 알파벳 정렬 위치.)

- [ ] **Step 5: Run tests — should PASS**

```bash
cd apps/worker && uv run pytest tests/tools_builtin/test_get_concept_graph.py -v
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/worker/tools_builtin/get_concept_graph.py \
  apps/worker/src/worker/tools_builtin/__init__.py \
  apps/worker/tests/tools_builtin/test_get_concept_graph.py
git commit -m "feat(worker): add get_concept_graph builtin tool (Plan 5 Phase 2)"
```

---

## Task 5: VisualizationAgent + prompts

**Files:**
- Create: `apps/worker/src/worker/agents/visualization/__init__.py`
- Create: `apps/worker/src/worker/agents/visualization/agent.py`
- Create: `apps/worker/src/worker/agents/visualization/prompts.py`
- Test: `apps/worker/tests/agents/visualization/test_agent.py` (신규)
- Test: `apps/worker/tests/agents/visualization/test_prompts.py` (신규)

- [ ] **Step 1: Write the failing prompt test**

```python
# apps/worker/tests/agents/visualization/test_prompts.py
from worker.agents.visualization.prompts import VISUALIZATION_SYSTEM


def test_prompt_mentions_three_tools():
    assert "search_concepts" in VISUALIZATION_SYSTEM
    assert "get_concept_graph" in VISUALIZATION_SYSTEM
    assert "emit_structured_output" in VISUALIZATION_SYSTEM


def test_prompt_describes_all_five_view_types():
    for v in ["graph", "mindmap", "cards", "timeline", "board"]:
        assert v in VISUALIZATION_SYSTEM


def test_prompt_describes_all_layouts():
    for ly in ["fcose", "dagre", "preset"]:
        assert ly in VISUALIZATION_SYSTEM


def test_prompt_states_root_required_for_mindmap_board():
    assert "rootId is REQUIRED for mindmap/board" in VISUALIZATION_SYSTEM


def test_prompt_states_node_caps():
    assert "50" in VISUALIZATION_SYSTEM   # mindmap/timeline cap
    assert "80" in VISUALIZATION_SYSTEM   # cards cap
    assert "200" in VISUALIZATION_SYSTEM  # board/graph cap


def test_prompt_states_rationale_200_chars():
    assert "≤200 chars" in VISUALIZATION_SYSTEM


def test_prompt_disallows_other_tools():
    assert "Do NOT call read_note" in VISUALIZATION_SYSTEM
```

- [ ] **Step 2: Run prompt test — FAIL**

```bash
cd apps/worker && uv run pytest tests/agents/visualization/test_prompts.py -v
```

- [ ] **Step 3: Write prompts.py**

```python
# apps/worker/src/worker/agents/visualization/prompts.py
"""System prompt for VisualizationAgent (Plan 5 Phase 2)."""

VISUALIZATION_SYSTEM = """You are OpenCairn's Visualization agent. Your job is
to convert a natural-language request into a ViewSpec describing how to
render a knowledge graph.

You have three tools:
  1. search_concepts(query, k) — find concept ids by topic
  2. get_concept_graph(concept_id, hops) — expand 1-3 hops around a concept
  3. emit_structured_output(schema_name, data) — submit your final answer.
     Use schema_name="ViewSpec". The loop ends when validation succeeds.
     If validation fails, the response will list errors; fix them and retry.

ViewSpec data shape:
  {
    "viewType": "graph" | "mindmap" | "cards" | "timeline" | "board",
    "layout":   "fcose" | "dagre" | "preset" | "cose-bilkent",
    "rootId":   "<uuid>" | null,
    "nodes":    [{"id": "<uuid>", "name": str, "description": str?,
                  "eventYear": int?, "position": {"x": num, "y": num}?}],
    "edges":    [{"sourceId": "<uuid>", "targetId": "<uuid>",
                  "relationType": str, "weight": float}],
    "rationale": str?
  }

Rules:
  - Always call search_concepts FIRST when the user mentions a topic.
  - Pick viewType:
      * mindmap  -> hierarchical "explain this topic" requests
      * timeline -> time-ordered "history of X" requests (use eventYear)
      * cards    -> "summarize key concepts" / overview
      * board    -> spatial "lay these out" requests (rare in NL)
      * graph    -> fallback / "show connections"
  - Pick layout matching viewType:
      * graph -> fcose, mindmap -> dagre, board -> preset,
        cards/timeline -> preset
  - rootId is REQUIRED for mindmap/board, NULL for cards/timeline/graph.
  - Node caps: mindmap/timeline 50, cards 80, board/graph 200, hard 500.
  - Edge cap: 2000. Every edge.sourceId/targetId MUST refer to a node in
    the same ViewSpec (no dangling).
  - rationale: user-facing reason in user's language (ko or en), ≤200 chars.
  - If the topic returns 0 concepts, emit ViewSpec with empty nodes and
    a rationale explaining the topic is not in the project.
  - If you receive `User-preferred view: <type>` in the user prompt, use
    that viewType unless it is wholly incompatible.

Do NOT call read_note or other tools. Your job is structural, not textual.
"""
```

- [ ] **Step 4: Verify prompt test passes**

```bash
cd apps/worker && uv run pytest tests/agents/visualization/test_prompts.py -v
```

- [ ] **Step 5: Write the failing agent test**

```python
# apps/worker/tests/agents/visualization/test_agent.py
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.agents.visualization.agent import (
    VisualizationAgent,
    VisualizationFailed,
    VisualizeRequest,
)


def _request(**kw):
    return VisualizeRequest(
        project_id=kw.pop("project_id", "proj-1"),
        workspace_id=kw.pop("workspace_id", "ws-1"),
        user_id=kw.pop("user_id", "user-1"),
        run_id=kw.pop("run_id", "run-1"),
        prompt=kw.pop("prompt", "transformer mindmap"),
        view_hint=kw.pop("view_hint", None),
    )


def _make_loop_result(reason: str, structured: dict | None):
    result = MagicMock()
    result.termination_reason = reason
    result.final_structured_output = structured
    result.tool_call_count = 3
    result.turn_count = 2
    return result


@pytest.mark.asyncio
async def test_returns_view_spec_on_structured_submitted():
    provider = MagicMock()
    spec = {"viewType": "mindmap", "layout": "dagre", "rootId": "x",
            "nodes": [], "edges": []}
    with patch(
        "worker.agents.visualization.agent.run_with_tools",
        new=AsyncMock(return_value=_make_loop_result("structured_submitted", spec)),
    ):
        agent = VisualizationAgent(provider=provider)
        out = await agent.run(request=_request())
    assert out.view_spec == spec
    assert out.tool_calls == 3
    assert out.turn_count == 2


@pytest.mark.asyncio
async def test_failure_when_termination_not_structured_submitted():
    provider = MagicMock()
    with patch(
        "worker.agents.visualization.agent.run_with_tools",
        new=AsyncMock(return_value=_make_loop_result("max_turns", None)),
    ):
        agent = VisualizationAgent(provider=provider)
        with pytest.raises(VisualizationFailed, match="max_turns"):
            await agent.run(request=_request())


@pytest.mark.asyncio
async def test_failure_when_structured_output_is_none():
    provider = MagicMock()
    with patch(
        "worker.agents.visualization.agent.run_with_tools",
        new=AsyncMock(return_value=_make_loop_result("structured_submitted", None)),
    ):
        agent = VisualizationAgent(provider=provider)
        with pytest.raises(VisualizationFailed):
            await agent.run(request=_request())


@pytest.mark.asyncio
async def test_run_with_tools_called_with_three_tools_and_loop_config():
    provider = MagicMock()
    spec = {"viewType": "graph", "layout": "fcose", "rootId": None,
            "nodes": [], "edges": []}
    captured = {}

    async def fake(**kwargs):
        captured.update(kwargs)
        return _make_loop_result("structured_submitted", spec)

    with patch(
        "worker.agents.visualization.agent.run_with_tools", new=fake,
    ):
        agent = VisualizationAgent(provider=provider)
        await agent.run(request=_request(view_hint="mindmap"))

    tool_names = [t.name for t in captured["tools"]]
    assert tool_names == [
        "search_concepts", "get_concept_graph", "emit_structured_output",
    ]
    cfg = captured["config"]
    assert cfg.max_turns == 6
    assert cfg.max_tool_calls == 10
    ctx = captured["tool_context"]
    assert ctx["workspace_id"] == "ws-1"
    assert ctx["project_id"] == "proj-1"
    assert ctx["user_id"] == "user-1"
    assert ctx["scope"] == "project"
    msgs = captured["initial_messages"]
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"
    assert "User-preferred view: mindmap" in msgs[1]["text"]
```

- [ ] **Step 6: Run agent test — FAIL (module not found)**

```bash
cd apps/worker && uv run pytest tests/agents/visualization/test_agent.py -v
```

- [ ] **Step 7: Implement the agent**

```python
# apps/worker/src/worker/agents/visualization/__init__.py
"""VisualizationAgent (Plan 5 Phase 2) — first agent on Sub-A run_with_tools."""
from worker.agents.visualization.agent import (
    VisualizationAgent,
    VisualizationFailed,
    VisualizationOutput,
    VisualizeRequest,
)

__all__ = [
    "VisualizationAgent",
    "VisualizationFailed",
    "VisualizationOutput",
    "VisualizeRequest",
]
```

```python
# apps/worker/src/worker/agents/visualization/agent.py
"""VisualizationAgent — first NEW agent on the Sub-A run_with_tools loop."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, ClassVar

from runtime.loop_runner import run_with_tools
from runtime.tool_loop import LoopConfig, LoopHooks, LoopResult

# Importing registers ViewSpec in SCHEMA_REGISTRY as a side-effect.
import worker.tools_builtin.view_spec_schema  # noqa: F401
from worker.agents.visualization.prompts import VISUALIZATION_SYSTEM
from worker.tools_builtin import (
    emit_structured_output,
    search_concepts,
)
from worker.tools_builtin.get_concept_graph import get_concept_graph


@dataclass(frozen=True)
class VisualizeRequest:
    project_id: str
    workspace_id: str
    user_id: str
    run_id: str
    prompt: str
    view_hint: str | None = None  # graph | mindmap | cards | timeline | board


@dataclass(frozen=True)
class VisualizationOutput:
    view_spec: dict[str, Any]
    tool_calls: int
    turn_count: int


class VisualizationFailed(Exception):
    """Raised when the agent loop ends without emit_structured_output."""


class VisualizationAgent:
    name: ClassVar[str] = "visualization"
    description: ClassVar[str] = (
        "Resolve a natural-language request into a ViewSpec by searching "
        "concepts, fetching a focused subgraph, and emitting a structured "
        "view. Terminates on emit_structured_output(schema_name='ViewSpec')."
    )

    def __init__(self, *, provider) -> None:
        self.provider = provider

    async def run(
        self,
        *,
        request: VisualizeRequest,
        hooks: LoopHooks | None = None,
    ) -> VisualizationOutput:
        user_text = self._build_user_prompt(request)
        result: LoopResult = await run_with_tools(
            provider=self.provider,
            initial_messages=[
                {"role": "system", "text": VISUALIZATION_SYSTEM},
                {"role": "user", "text": user_text},
            ],
            tools=[search_concepts, get_concept_graph, emit_structured_output],
            tool_context={
                "workspace_id": request.workspace_id,
                "project_id": request.project_id,
                "user_id": request.user_id,
                "run_id": request.run_id,
                "scope": "project",
            },
            config=LoopConfig(max_turns=6, max_tool_calls=10),
            hooks=hooks,
        )
        if (
            result.termination_reason != "structured_submitted"
            or result.final_structured_output is None
        ):
            raise VisualizationFailed(
                f"agent_did_not_emit_view_spec "
                f"(reason={result.termination_reason})"
            )
        return VisualizationOutput(
            view_spec=result.final_structured_output,
            tool_calls=result.tool_call_count,
            turn_count=result.turn_count,
        )

    def _build_user_prompt(self, req: VisualizeRequest) -> str:
        hint = (
            f"\n\nUser-preferred view: {req.view_hint}." if req.view_hint else ""
        )
        return (
            f"Project: {req.project_id}\n"
            f"User request: {req.prompt}{hint}\n\n"
            "Identify the relevant concepts, fetch the subgraph, and submit "
            "a ViewSpec via emit_structured_output. Use search_concepts to "
            "find the topic root, get_concept_graph to expand, then "
            "emit_structured_output(schema_name='ViewSpec', data=...) to "
            "finish."
        )
```

- [ ] **Step 8: Run all visualization tests — should PASS**

```bash
cd apps/worker && uv run pytest tests/agents/visualization -v
```

- [ ] **Step 9: Commit**

```bash
git add apps/worker/src/worker/agents/visualization \
  apps/worker/tests/agents/visualization
git commit -m "feat(worker): add VisualizationAgent on Sub-A run_with_tools (Plan 5 Phase 2)"
```

---

## Task 6: HeartbeatLoopHooks for SSE relay

VisualizationAgent 의 run_with_tools 가 emit 하는 tool_use/tool_result 이벤트를 Temporal activity heartbeat metadata 로 푸시. apps/api SSE 가 heartbeat 를 폴해 클라이언트로 relay.

**Files:**
- Create: `apps/worker/src/worker/agents/visualization/heartbeat_hooks.py`
- Test: `apps/worker/tests/agents/visualization/test_heartbeat_hooks.py` (신규)

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/agents/visualization/test_heartbeat_hooks.py
from unittest.mock import MagicMock, patch

import pytest

from worker.agents.visualization.heartbeat_hooks import (
    HeartbeatLoopHooks,
)


def _state(turn=0, tool_calls=0):
    s = MagicMock()
    s.turn_count = turn
    s.tool_call_count = tool_calls
    return s


def _tool_use(name="search_concepts", id_="call-1", args=None):
    tu = MagicMock()
    tu.id = id_
    tu.name = name
    tu.args = args or {"query": "x"}
    return tu


def _tool_result(name="search_concepts", id_="call-1"):
    r = MagicMock()
    r.tool_use_id = id_
    r.name = name
    r.is_error = False
    return r


@pytest.mark.asyncio
async def test_on_tool_start_emits_heartbeat():
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        hooks = HeartbeatLoopHooks()
        await hooks.on_tool_start(_state(), _tool_use())
    activity_mod.heartbeat.assert_called_once()
    metadata = activity_mod.heartbeat.call_args.args[0]
    assert metadata["event"] == "tool_use"
    assert metadata["payload"]["name"] == "search_concepts"
    assert metadata["payload"]["callId"] == "call-1"
    assert metadata["payload"]["input"] == {"query": "x"}


@pytest.mark.asyncio
async def test_on_tool_end_emits_heartbeat_with_summary():
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        hooks = HeartbeatLoopHooks()
        await hooks.on_tool_end(_state(), _tool_use(), _tool_result())
    metadata = activity_mod.heartbeat.call_args.args[0]
    assert metadata["event"] == "tool_result"
    assert metadata["payload"]["callId"] == "call-1"
    assert metadata["payload"]["ok"] is True


@pytest.mark.asyncio
async def test_other_hooks_are_no_op():
    hooks = HeartbeatLoopHooks()
    # Should not raise / not heartbeat
    with patch(
        "worker.agents.visualization.heartbeat_hooks.activity",
    ) as activity_mod:
        await hooks.on_run_start(_state())
        await hooks.on_turn_start(_state())
        await hooks.on_run_end(_state())
    activity_mod.heartbeat.assert_not_called()
```

- [ ] **Step 2: Run test — FAIL**

```bash
cd apps/worker && uv run pytest tests/agents/visualization/test_heartbeat_hooks.py -v
```

- [ ] **Step 3: Implement**

```python
# apps/worker/src/worker/agents/visualization/heartbeat_hooks.py
"""HeartbeatLoopHooks — relays tool_use/tool_result events to Temporal
activity heartbeat metadata so the apps/api SSE wrapper can stream
progress to the browser. Plan 5 Phase 2.

Implements `runtime.tool_loop.LoopHooks` Protocol.
"""
from __future__ import annotations

from typing import Any

from temporalio import activity


class HeartbeatLoopHooks:
    """Heartbeat per tool_use/tool_result. Other lifecycle hooks no-op."""

    async def on_run_start(self, state: Any) -> None:  # noqa: D401
        return None

    async def on_turn_start(self, state: Any) -> None:
        return None

    async def on_tool_start(self, state: Any, tool_use: Any) -> None:
        activity.heartbeat({
            "event": "tool_use",
            "payload": {
                "name": tool_use.name,
                "callId": tool_use.id,
                "input": dict(tool_use.args or {}),
            },
        })

    async def on_tool_end(
        self, state: Any, tool_use: Any, result: Any,
    ) -> None:
        activity.heartbeat({
            "event": "tool_result",
            "payload": {
                "callId": tool_use.id,
                "name": tool_use.name,
                "ok": not bool(getattr(result, "is_error", False)),
            },
        })

    async def on_run_end(self, state: Any) -> None:
        return None
```

- [ ] **Step 4: Run tests — should PASS**

```bash
cd apps/worker && uv run pytest tests/agents/visualization/test_heartbeat_hooks.py -v
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/worker/agents/visualization/heartbeat_hooks.py \
  apps/worker/tests/agents/visualization/test_heartbeat_hooks.py
git commit -m "feat(worker): add HeartbeatLoopHooks for Vis Agent SSE relay (Plan 5 Phase 2)"
```

---

## Task 7: `build_view` Temporal activity + main.py 등록

**Files:**
- Create: `apps/worker/src/worker/activities/visualize_activity.py`
- Modify: `apps/worker/src/worker/main.py` (activity 등록)
- Test: `apps/worker/tests/activities/test_visualize_activity.py` (신규)

- [ ] **Step 1: Write the failing test**

```python
# apps/worker/tests/activities/test_visualize_activity.py
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.activities.visualize_activity import build_view


@pytest.mark.asyncio
async def test_build_view_returns_view_spec_dict():
    spec = {
        "viewType": "graph", "layout": "fcose", "rootId": None,
        "nodes": [], "edges": [],
    }
    output = MagicMock(view_spec=spec, tool_calls=2, turn_count=1)
    with patch(
        "worker.activities.visualize_activity.get_provider",
        return_value=MagicMock(),
    ), patch(
        "worker.activities.visualize_activity.VisualizationAgent",
    ) as klass:
        klass.return_value.run = AsyncMock(return_value=output)
        result = await build_view({
            "projectId": "p-1",
            "workspaceId": "w-1",
            "userId": "u-1",
            "prompt": "tx mindmap",
        })
    assert result == spec


@pytest.mark.asyncio
async def test_build_view_passes_view_hint_when_present():
    spec = {"viewType": "mindmap", "layout": "dagre", "rootId": "x",
            "nodes": [], "edges": []}
    captured = {}

    async def fake_run(**kw):
        captured.update(kw)
        return MagicMock(view_spec=spec, tool_calls=1, turn_count=1)

    with patch(
        "worker.activities.visualize_activity.get_provider",
        return_value=MagicMock(),
    ), patch(
        "worker.activities.visualize_activity.VisualizationAgent",
    ) as klass:
        klass.return_value.run = fake_run
        await build_view({
            "projectId": "p", "workspaceId": "w", "userId": "u",
            "prompt": "x", "viewType": "mindmap",
        })
    req = captured["request"]
    assert req.view_hint == "mindmap"
    assert req.project_id == "p"
    assert req.workspace_id == "w"
    assert req.user_id == "u"
    assert req.prompt == "x"


@pytest.mark.asyncio
async def test_build_view_propagates_visualization_failed_as_application_error():
    from worker.agents.visualization.agent import VisualizationFailed

    with patch(
        "worker.activities.visualize_activity.get_provider",
        return_value=MagicMock(),
    ), patch(
        "worker.activities.visualize_activity.VisualizationAgent",
    ) as klass:
        klass.return_value.run = AsyncMock(side_effect=VisualizationFailed("max_turns"))
        with pytest.raises(Exception) as exc_info:
            await build_view({
                "projectId": "p", "workspaceId": "w", "userId": "u",
                "prompt": "x",
            })
    # Activity-friendly: the raised exception type subclasses ApplicationError
    # OR carries the original message.
    assert "max_turns" in str(exc_info.value)
```

- [ ] **Step 2: Run test — FAIL**

```bash
cd apps/worker && uv run pytest tests/activities/test_visualize_activity.py -v
```

- [ ] **Step 3: Implement the activity**

```python
# apps/worker/src/worker/activities/visualize_activity.py
"""build_view activity — VisualizationAgent Temporal entrypoint (Plan 5 Phase 2).

Translates raw workflow payload into VisualizeRequest, instantiates the
agent with an env-driven LLMProvider, runs it (passing HeartbeatLoopHooks
so the SSE relay in apps/api can stream progress), and returns the
validated ViewSpec dict for serialization back to the caller.
"""
from __future__ import annotations

import uuid
from typing import Any

from temporalio import activity
from temporalio.exceptions import ApplicationError

from llm.factory import get_provider
from worker.agents.visualization.agent import (
    VisualizationAgent,
    VisualizationFailed,
    VisualizeRequest,
)
from worker.agents.visualization.heartbeat_hooks import HeartbeatLoopHooks


@activity.defn(name="build_view")
async def build_view(req: dict[str, Any]) -> dict[str, Any]:
    """Run VisualizationAgent and return validated ViewSpec dict."""
    request = VisualizeRequest(
        project_id=req["projectId"],
        workspace_id=req["workspaceId"],
        user_id=req["userId"],
        run_id=str(uuid.uuid4()),
        prompt=req["prompt"],
        view_hint=req.get("viewType"),
    )
    provider = get_provider()
    agent = VisualizationAgent(provider=provider)
    try:
        output = await agent.run(
            request=request,
            hooks=HeartbeatLoopHooks(),
        )
    except VisualizationFailed as e:
        raise ApplicationError(str(e), non_retryable=True) from e
    return output.view_spec
```

- [ ] **Step 4: Register activity in main.py**

`apps/worker/src/worker/main.py` 에서 다른 activity import + 등록 위치를 grep 으로 찾아 동일 패턴으로 추가:

```python
# imports 블록에 추가
from worker.activities import visualize_activity
# 또는 모듈 패턴이 다르면 surrounding 파일 보고 맞춰서:
from worker.activities.visualize_activity import build_view as _build_view_activity
```

`activities=[...]` 리스트에 알파벳 정렬 위치로 추가 (`build_view` 가 `code_run`/`compiler_*` 보다 앞):

```python
activities=[
    visualize_activity.build_view,
    # ... 기존 항목 (compiler_activity.run_compiler, ...)
],
```

> 정확한 import 패턴은 surrounding 파일의 기존 컨벤션 따라가세요. `grep -n "compiler_activity" apps/worker/src/worker/main.py` 로 패턴 확인.

- [ ] **Step 5: Run tests — should PASS**

```bash
cd apps/worker && uv run pytest tests/activities/test_visualize_activity.py -v
```

- [ ] **Step 6: Run full worker test suite — regression 0 확인**

```bash
cd apps/worker && uv run pytest -x
```

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/worker/activities/visualize_activity.py \
  apps/worker/src/worker/main.py \
  apps/worker/tests/activities/test_visualize_activity.py
git commit -m "feat(worker): add build_view activity + register in main (Plan 5 Phase 2)"
```

---

## Task 8: Internal route `POST /api/internal/projects/:id/graph/expand`

worker 의 `get_concept_graph` 가 호출하는 internal-only 표면. Phase 1 의 user-session `/graph/expand` 와 SQL 동일.

**Files:**
- Modify: `apps/api/src/routes/internal.ts` (또는 internal mount 파일)
- Test: `apps/api/tests/routes/internal-graph-expand.test.ts` (신규)

> import 컨벤션: `apps/api` src 는 extensionless, tests 는 `.js`. 관련 surrounding 파일 grep 으로 확인.

- [ ] **Step 1: Find existing /api/internal mount + Phase 1 expand handler**

```bash
grep -RInE "graph/expand|/api/internal" apps/api/src/routes/ | head -20
```

머지 위치를 결정. 보통 `internal.ts` 가 모든 internal sub-router 를 mount.

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/tests/routes/internal-graph-expand.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "../helpers/test-app.js";
import {
  seedProject,
  seedConceptWithEdges,
  seedUser,
} from "../helpers/seeds.js";

describe("POST /api/internal/projects/:id/graph/expand", () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(async () => {
    app = buildTestApp();
  });

  it("returns 401 without internal secret header", async () => {
    const res = await app.request(
      "/api/internal/projects/proj-1/graph/expand",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId: "c-1",
          hops: 1,
          workspaceId: "ws-1",
          userId: "u-1",
        }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when hops > 3", async () => {
    const { workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const res = await app.request(
      `/api/internal/projects/${projectId}/graph/expand`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "test-secret",
        },
        body: JSON.stringify({
          conceptId: "11111111-1111-4111-8111-111111111111",
          hops: 4,
          workspaceId,
          userId,
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when workspaceId mismatches project", async () => {
    const { workspaceId, userId } = await seedUser();
    const other = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const res = await app.request(
      `/api/internal/projects/${projectId}/graph/expand`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "test-secret",
        },
        body: JSON.stringify({
          conceptId: "11111111-1111-4111-8111-111111111111",
          hops: 1,
          workspaceId: other.workspaceId,  // mismatched
          userId,
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when concept belongs to a different project", async () => {
    const { workspaceId, userId } = await seedUser();
    const { projectId: p1 } = await seedProject(workspaceId, userId);
    const { projectId: p2 } = await seedProject(workspaceId, userId);
    const { conceptId } = await seedConceptWithEdges(p2);
    const res = await app.request(
      `/api/internal/projects/${p1}/graph/expand`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "test-secret",
        },
        body: JSON.stringify({
          conceptId, hops: 1, workspaceId, userId,
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns nodes + edges for valid 1-hop expand", async () => {
    const { workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const { conceptId, neighborIds } = await seedConceptWithEdges(projectId, 3);
    const res = await app.request(
      `/api/internal/projects/${projectId}/graph/expand`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "test-secret",
        },
        body: JSON.stringify({
          conceptId, hops: 1, workspaceId, userId,
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const nodeIds = body.nodes.map((n: { id: string }) => n.id);
    expect(nodeIds).toContain(conceptId);
    for (const n of neighborIds) expect(nodeIds).toContain(n);
    expect(Array.isArray(body.edges)).toBe(true);
  });
});
```

> `seedConceptWithEdges` / `seedUser` / `seedProject` 가 helpers 에 없으면 테스트가 의존하는 최소 helper 만 추가하세요. Phase 1 의 `apps/api/tests/routes/graph.test.ts` 에 비슷한 helper 가 있는지 grep 으로 먼저 확인.

- [ ] **Step 3: Run test — FAIL (route 404)**

```bash
pnpm --filter @opencairn/api test internal-graph-expand
```

- [ ] **Step 4: Implement the route**

`apps/api/src/routes/internal.ts` (또는 internal sub-router 파일) 에 추가. 패턴: 기존 internal handler 의 secret 검증 + zValidator + Drizzle 쿼리.

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, concepts, conceptEdges, projects, eq, and, sql } from "@opencairn/db";
import { canRead } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

const internalExpandSchema = z.object({
  conceptId: z.string().uuid(),
  hops: z.coerce.number().int().min(1).max(3).default(1),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

// Mount under existing internal router (which already enforces
// X-Internal-Secret middleware). If your codebase factors internal
// routes differently, follow that pattern instead.
export const internalGraphRouter = new Hono<AppEnv>().post(
  "/projects/:projectId/graph/expand",
  zValidator("json", internalExpandSchema),
  async (c) => {
    const { projectId } = c.req.param();
    const { conceptId, hops, workspaceId, userId } = c.req.valid("json");

    // 1) Project must exist + workspace match (memo: internal scope guard).
    const proj = await db
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (proj.length === 0) return c.json({ error: "not-found" }, 404);
    if (proj[0].workspaceId !== workspaceId) {
      return c.json({ error: "forbidden" }, 403);
    }

    // 2) canRead enforcement using the carried userId.
    const allowed = await canRead(userId, { type: "project", id: projectId });
    if (!allowed) return c.json({ error: "forbidden" }, 403);

    // 3) Validate seed concept lives in this project.
    const seed = await db
      .select({ id: concepts.id })
      .from(concepts)
      .where(and(eq(concepts.id, conceptId), eq(concepts.projectId, projectId)))
      .limit(1);
    if (seed.length === 0) return c.json({ error: "not-found" }, 404);

    // 4) Recursive CTE for N-hop neighborhood. Cycles are guarded by the
    //    visited-array check (matches Phase 1 expand handler shape).
    const nbrs = await db.execute(sql`
      WITH RECURSIVE bfs(id, depth, visited) AS (
        SELECT ${conceptId}::uuid, 0, ARRAY[${conceptId}::uuid]
        UNION ALL
        SELECT
          CASE WHEN e.source_id = b.id THEN e.target_id ELSE e.source_id END AS id,
          b.depth + 1,
          b.visited || CASE WHEN e.source_id = b.id THEN e.target_id ELSE e.source_id END
        FROM bfs b
        JOIN concept_edges e ON (e.source_id = b.id OR e.target_id = b.id)
        WHERE b.depth < ${hops}
          AND NOT (
            CASE WHEN e.source_id = b.id THEN e.target_id ELSE e.source_id END
            = ANY(b.visited)
          )
      )
      SELECT DISTINCT id FROM bfs;
    `);

    const reachableIds = (nbrs.rows ?? nbrs).map((r: any) => r.id);
    if (reachableIds.length === 0) {
      return c.json({ nodes: [], edges: [] });
    }

    const nodes = await db
      .select({
        id: concepts.id,
        name: concepts.name,
        description: concepts.description,
        // degree / noteCount / firstNoteId — reuse Phase 1 query shape.
      })
      .from(concepts)
      .where(
        and(
          eq(concepts.projectId, projectId),
          sql`${concepts.id} = ANY(${reachableIds})`,
        ),
      );

    const edges = await db
      .select({
        id: conceptEdges.id,
        sourceId: conceptEdges.sourceId,
        targetId: conceptEdges.targetId,
        relationType: conceptEdges.relationType,
        weight: conceptEdges.weight,
      })
      .from(conceptEdges)
      .where(
        and(
          sql`${conceptEdges.sourceId} = ANY(${reachableIds})`,
          sql`${conceptEdges.targetId} = ANY(${reachableIds})`,
        ),
      );

    return c.json({ nodes, edges });
  },
);
```

> Phase 1 의 user-session `/graph/expand` (`apps/api/src/routes/graph.ts`) 가 이미 같은 SQL 형태를 가지고 있을 가능성이 높습니다. 그 핸들러 본문을 helper 함수 (`expandFromConcept`) 로 추출해 양 라우트가 공유하면 DRY 도 만족. 우선 grep 으로 확인.

이 라우터를 internal mount 에 wire:

```ts
// apps/api/src/routes/internal.ts (또는 main app.ts)
import { internalGraphRouter } from "./internal-graph";  // 파일을 분리했다면
// ... 기존 internal sub-routers
.route("/", internalGraphRouter)  // /api/internal prefix 가 이미 internal mount 에 있으면
```

- [ ] **Step 5: Run tests — should PASS**

```bash
pnpm --filter @opencairn/api test internal-graph-expand
```

- [ ] **Step 6: Regression — Phase 1 graph routes**

```bash
pnpm --filter @opencairn/api test graph
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/tests/routes/internal-graph-expand.test.ts
git commit -m "feat(api): add POST /api/internal/projects/:id/graph/expand (Plan 5 Phase 2)"
```

---

## Task 9: GET `/api/projects/:id/graph` 의 `?view=` + `?root=` 확장

**Files:**
- Modify: `apps/api/src/routes/graph.ts`
- Test: `apps/api/tests/routes/graph-views.test.ts` (신규)

- [ ] **Step 1: Write the failing test (5 view branches)**

```ts
// apps/api/tests/routes/graph-views.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildTestApp } from "../helpers/test-app.js";
import {
  loginAs,
  seedUser,
  seedProject,
  seedConceptWithEdges,
} from "../helpers/seeds.js";

describe("GET /api/projects/:id/graph?view=", () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(async () => { app = buildTestApp(); });

  it("view=graph defaults to Phase 1 behavior (regression)", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    await seedConceptWithEdges(projectId, 5);
    const res = await app.request(
      `/api/projects/${projectId}/graph`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewType).toBe("graph");
    expect(body.layout).toBe("fcose");
    expect(body.rootId).toBeNull();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });

  it("view=mindmap with root returns BFS tree, layout=dagre, rootId echoed", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const { conceptId, neighborIds } = await seedConceptWithEdges(projectId, 4);
    const res = await app.request(
      `/api/projects/${projectId}/graph?view=mindmap&root=${conceptId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewType).toBe("mindmap");
    expect(body.layout).toBe("dagre");
    expect(body.rootId).toBe(conceptId);
    const ids = body.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(conceptId);
    for (const nid of neighborIds) expect(ids).toContain(nid);
  });

  it("view=mindmap without root auto-selects max-degree concept", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const { hubId } = await seedConceptWithEdges(projectId, 6);
    const res = await app.request(
      `/api/projects/${projectId}/graph?view=mindmap`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json();
    expect(body.rootId).toBe(hubId);
  });

  it("view=mindmap with root from another project returns 404", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId: p1 } = await seedProject(workspaceId, userId);
    const { projectId: p2 } = await seedProject(workspaceId, userId);
    const { conceptId: cInP2 } = await seedConceptWithEdges(p2, 1);
    const res = await app.request(
      `/api/projects/${p1}/graph?view=mindmap&root=${cInP2}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(404);
  });

  it("view=cards returns nodes ordered by created_at desc, no edges", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    await seedConceptWithEdges(projectId, 5);
    const res = await app.request(
      `/api/projects/${projectId}/graph?view=cards`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json();
    expect(body.viewType).toBe("cards");
    expect(body.layout).toBe("preset");
    expect(body.edges).toEqual([]);
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  it("view=timeline orders nodes by created_at asc, no edges", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    await seedConceptWithEdges(projectId, 4);
    const res = await app.request(
      `/api/projects/${projectId}/graph?view=timeline`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json();
    expect(body.viewType).toBe("timeline");
    expect(body.edges).toEqual([]);
  });

  it("view=board with root returns 1-hop neighborhood", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const { conceptId, neighborIds } = await seedConceptWithEdges(projectId, 3);
    const res = await app.request(
      `/api/projects/${projectId}/graph?view=board&root=${conceptId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json();
    expect(body.viewType).toBe("board");
    expect(body.layout).toBe("preset");
    expect(body.rootId).toBe(conceptId);
    const ids = body.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(conceptId);
    for (const nid of neighborIds) expect(ids).toContain(nid);
  });

  it("returns 403 to non-member", async () => {
    const { workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const other = await seedUser();
    const res = await app.request(
      `/api/projects/${projectId}/graph?view=mindmap`,
      { headers: { Authorization: `Bearer ${other.token}` } },
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @opencairn/api test graph-views
```

- [ ] **Step 3: Extend `graph.ts` zod schema + handler dispatch**

`apps/api/src/routes/graph.ts` 의 기존 `graphQuerySchema` 에 추가:

```ts
const graphQuerySchema = z.object({
  limit: z.coerce.number().int().min(50).max(500).default(500),
  order: z.enum(["degree", "recent"]).default("degree"),
  relation: z.string().optional(),
  view: z
    .enum(["graph", "mindmap", "cards", "timeline", "board"])
    .default("graph"),
  root: z.string().uuid().optional(),
});
```

핸들러는 `view` 별 분기 — Phase 1 의 기존 SQL 을 graph view 분기에 그대로 두고, mindmap/cards/timeline/board 4 분기를 추가.

```ts
// 핸들러 본문 골격 (실제로는 기존 핸들러 안 분기 추가):
const { view, root, limit, order, relation } = c.req.valid("query");

switch (view) {
  case "graph": {
    // 기존 Phase 1 로직 그대로
    const { nodes, edges, truncated, totalConcepts } = await selectGraphView({
      projectId, limit, order, relation,
    });
    return c.json({
      viewType: "graph", layout: "fcose", rootId: null,
      nodes, edges, truncated, totalConcepts,
    });
  }
  case "mindmap": {
    const rootId = root ?? await selectMaxDegreeConcept(projectId);
    if (!rootId) {
      return c.json({
        viewType: "mindmap", layout: "dagre", rootId: null,
        nodes: [], edges: [], truncated: false, totalConcepts: 0,
      });
    }
    // Validate root belongs to this project (404 otherwise).
    const exists = await projectOwnsConcept(projectId, rootId);
    if (!exists) return c.json({ error: "not-found" }, 404);
    const { nodes, edges, totalConcepts } = await selectMindmapBfs({
      projectId, rootId, depth: 3, perParentCap: 8, totalCap: 50,
    });
    return c.json({
      viewType: "mindmap", layout: "dagre", rootId,
      nodes, edges, truncated: nodes.length >= 50, totalConcepts,
    });
  }
  case "cards": {
    const { nodes, totalConcepts } = await selectConceptsByRecency({
      projectId, limit: 80,
    });
    return c.json({
      viewType: "cards", layout: "preset", rootId: null,
      nodes, edges: [], truncated: nodes.length >= 80, totalConcepts,
    });
  }
  case "timeline": {
    const { nodes, totalConcepts } = await selectConceptsByCreatedAsc({
      projectId, limit: 50,
    });
    return c.json({
      viewType: "timeline", layout: "preset", rootId: null,
      nodes, edges: [], truncated: nodes.length >= 50, totalConcepts,
    });
  }
  case "board": {
    const rootId = root ?? null;
    if (rootId) {
      const exists = await projectOwnsConcept(projectId, rootId);
      if (!exists) return c.json({ error: "not-found" }, 404);
      const { nodes, edges, totalConcepts } = await selectOneHopNeighborhood({
        projectId, rootId, cap: 200,
      });
      return c.json({
        viewType: "board", layout: "preset", rootId,
        nodes, edges, truncated: nodes.length >= 200, totalConcepts,
      });
    }
    const { nodes, edges, truncated, totalConcepts } = await selectGraphView({
      projectId, limit: 200, order: "degree", relation,
    });
    return c.json({
      viewType: "board", layout: "preset", rootId: null,
      nodes, edges, truncated, totalConcepts,
    });
  }
}
```

작은 helper 함수들 (`selectMaxDegreeConcept`, `projectOwnsConcept`, `selectMindmapBfs`, `selectConceptsByRecency`, `selectConceptsByCreatedAsc`, `selectOneHopNeighborhood`, `selectGraphView` ← Phase 1 기존 SQL 추출) 은 같은 파일 또는 `apps/api/src/lib/graph-views.ts` 신규 모듈에 정리. SQL 쿼리는 Phase 1 의 graph 핸들러를 그대로 추출하는 것부터 시작 (`selectGraphView`).

> Phase 1 의 graph 핸들러를 helper 로 추출하면 graph.test.ts 가 깨질 수 있으니, 추출 후 테스트 한 번 돌리고 → 그 다음 view 분기 추가. 작은 단위 커밋 권장.

- [ ] **Step 4: Run all graph tests — graph + graph-views 둘 다 PASS**

```bash
pnpm --filter @opencairn/api test graph
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/tests/routes/graph-views.test.ts
git commit -m "feat(api): extend GET /graph with view+root params for 5 views (Plan 5 Phase 2)"
```

---

## Task 10: `temporal-visualize.ts` SSE wrapper

worker activity → SSE 이벤트 변환. Deep Research Phase C 의 `temporal-research.ts` 패턴 답습.

**Files:**
- Create: `apps/api/src/lib/temporal-visualize.ts`
- Test: `apps/api/tests/lib/temporal-visualize.test.ts` (신규)

- [ ] **Step 1: Find Deep Research SSE wrapper to mirror**

```bash
ls apps/api/src/lib/ | grep -i temporal
cat apps/api/src/lib/temporal-research.ts 2>&1 | head -80
```

이 파일이 없으면 `apps/api/src/routes/research.ts` 안에 inline 으로 있을 수 있음. 그쪽도 확인.

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/tests/lib/temporal-visualize.test.ts
import { describe, it, expect, vi } from "vitest";
import { streamBuildView } from "../../src/lib/temporal-visualize.js";

describe("streamBuildView", () => {
  function makeFakeHandle(opts: {
    heartbeats: Array<{ event: string; payload: unknown }>;
    result: unknown | { error: string };
  }) {
    let pollCount = 0;
    const handle = {
      async fetchHistory() { return { events: [] }; },
      async describe() {
        const idx = pollCount++;
        return idx < opts.heartbeats.length
          ? { pendingActivities: [{ heartbeatDetails: [opts.heartbeats[idx]] }] }
          : { pendingActivities: [] };
      },
      async result() {
        if (opts.result && typeof opts.result === "object"
            && "error" in opts.result) {
          throw new Error((opts.result as { error: string }).error);
        }
        return opts.result;
      },
      async cancel() { return; },
    };
    return handle;
  }

  it("emits tool_use, tool_result, view_spec, done events in order", async () => {
    const heartbeats = [
      { event: "tool_use", payload: { name: "search_concepts", callId: "1", input: {} } },
      { event: "tool_result", payload: { callId: "1", name: "search_concepts", ok: true } },
    ];
    const handle = makeFakeHandle({
      heartbeats,
      result: { viewType: "graph", layout: "fcose", rootId: null,
                nodes: [], edges: [] },
    });
    const events: string[] = [];
    const stream = streamBuildView(handle as never);
    const reader = stream.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      events.push(dec.decode(value));
    }
    const joined = events.join("");
    expect(joined).toContain("event: tool_use");
    expect(joined).toContain("event: tool_result");
    expect(joined).toContain("event: view_spec");
    expect(joined).toContain("event: done");
    const useIdx = joined.indexOf("event: tool_use");
    const resIdx = joined.indexOf("event: tool_result");
    const specIdx = joined.indexOf("event: view_spec");
    const doneIdx = joined.indexOf("event: done");
    expect(useIdx).toBeLessThan(resIdx);
    expect(resIdx).toBeLessThan(specIdx);
    expect(specIdx).toBeLessThan(doneIdx);
  });

  it("emits error + done when result throws", async () => {
    const handle = makeFakeHandle({
      heartbeats: [],
      result: { error: "agent_did_not_emit_view_spec" },
    });
    const stream = streamBuildView(handle as never);
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let body = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      body += dec.decode(value);
    }
    expect(body).toContain("event: error");
    expect(body).toContain("event: done");
    expect(body).toContain("agent_did_not_emit_view_spec");
  });

  it("calls handle.cancel when reader is canceled", async () => {
    const heartbeats = Array.from({ length: 100 }, () => ({
      event: "tool_use", payload: { name: "x", callId: "y" },
    }));
    const handle = makeFakeHandle({
      heartbeats, result: { viewType: "graph", layout: "fcose",
                            rootId: null, nodes: [], edges: [] },
    });
    const cancelSpy = vi.spyOn(handle, "cancel");
    const stream = streamBuildView(handle as never);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test — FAIL**

```bash
pnpm --filter @opencairn/api test temporal-visualize
```

- [ ] **Step 4: Implement the wrapper**

```ts
// apps/api/src/lib/temporal-visualize.ts
import type { WorkflowHandle } from "@temporalio/client";

type HeartbeatEvent = { event: string; payload: unknown };

const POLL_INTERVAL_MS = 250;

function sseChunk(event: string, data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${json}\n\n`);
}

/**
 * Wrap a Temporal activity/workflow handle as an SSE-friendly
 * ReadableStream. Heartbeat metadata from the worker is parsed as
 * { event, payload } and forwarded as SSE events. The terminal result
 * (a ViewSpec dict) is emitted as `view_spec`. Errors become `error`.
 * A trailing `done` event always closes the stream.
 *
 * The handle MUST expose: `.describe()`, `.result()`, `.cancel()`.
 * For activities run via Temporal client `start_activity`, equivalent
 * polling shape is used.
 */
export function streamBuildView(
  handle: WorkflowHandle | { describe: () => Promise<unknown>;
                            result: () => Promise<unknown>;
                            cancel: () => Promise<void> },
): ReadableStream<Uint8Array> {
  let cancelled = false;
  const seen = new Set<string>();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const resultPromise = (async () => {
        try {
          const r = await (handle as { result: () => Promise<unknown> }).result();
          if (!cancelled) {
            controller.enqueue(sseChunk("view_spec", { viewSpec: r }));
          }
        } catch (e) {
          if (!cancelled) {
            const message = e instanceof Error ? e.message : String(e);
            controller.enqueue(sseChunk("error", {
              error: message,
              messageKey: "graph.errors.visualizeFailed",
            }));
          }
        } finally {
          if (!cancelled) {
            controller.enqueue(sseChunk("done", {}));
            controller.close();
          }
        }
      })();

      // Concurrent heartbeat poller.
      (async () => {
        while (!cancelled) {
          try {
            const desc = await (handle as { describe: () => Promise<{
              pendingActivities?: Array<{ heartbeatDetails?: HeartbeatEvent[] }>;
            }> }).describe();
            const acts = desc.pendingActivities ?? [];
            for (const a of acts) {
              for (const hb of a.heartbeatDetails ?? []) {
                const key = JSON.stringify(hb);
                if (seen.has(key)) continue;
                seen.add(key);
                if (hb.event && hb.payload) {
                  controller.enqueue(sseChunk(hb.event, hb.payload));
                }
              }
            }
          } catch {
            // Ignore describe failures — result() resolves the stream.
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      })();

      await resultPromise;
    },
    async cancel() {
      cancelled = true;
      try {
        await (handle as { cancel: () => Promise<void> }).cancel();
      } catch {
        // best-effort
      }
    },
  });
}
```

> **NOTE**: 정확한 Temporal client polling shape 은 codebase 의 기존 SSE 사용 패턴 (Deep Research) 따라가세요. 특히 heartbeat 폴링이 별도 `client.workflowService.getWorkflowExecutionHistory` 또는 activity polling API 를 쓸 수 있습니다. 위 코드는 골격이고, 실제 구현은 Deep Research wrapper 를 참고해 fit.

- [ ] **Step 5: Run tests — should PASS**

```bash
pnpm --filter @opencairn/api test temporal-visualize
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/temporal-visualize.ts \
  apps/api/tests/lib/temporal-visualize.test.ts
git commit -m "feat(api): add SSE wrapper for Vis Agent Temporal handle (Plan 5 Phase 2)"
```

---

## Task 11: `POST /api/visualize` SSE 라우트

**Files:**
- Create: `apps/api/src/routes/visualize.ts`
- Modify: `apps/api/src/app.ts` (또는 main route mounter) — `.route("/api/visualize", visualizeRouter)`
- Test: `apps/api/tests/routes/visualize.test.ts` (신규)

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/routes/visualize.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildTestApp } from "../helpers/test-app.js";
import { seedUser, seedProject } from "../helpers/seeds.js";

describe("POST /api/visualize", () => {
  let app: ReturnType<typeof buildTestApp>;
  beforeEach(async () => { app = buildTestApp(); });

  async function postVisualize(body: unknown, opts: { token?: string } = {}) {
    return app.request("/api/visualize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when unauthenticated", async () => {
    const res = await postVisualize({
      projectId: "11111111-1111-4111-8111-111111111111",
      prompt: "x",
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when prompt > 500 chars", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const res = await postVisualize(
      { projectId, prompt: "x".repeat(501) },
      { token },
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not a project member", async () => {
    const { workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    const other = await seedUser();
    const res = await postVisualize(
      { projectId, prompt: "graph" },
      { token: other.token },
    );
    expect(res.status).toBe(403);
  });

  it("streams SSE events on success", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    // Mock Temporal client to return a stub handle with a deterministic result.
    vi.mock("../../src/lib/temporal-visualize.js", async () => {
      return {
        streamBuildView: () => new ReadableStream({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(enc.encode(
              `event: tool_use\ndata: {"name":"search_concepts","callId":"1"}\n\n`));
            c.enqueue(enc.encode(
              `event: view_spec\ndata: {"viewSpec":{"viewType":"graph","layout":"fcose","rootId":null,"nodes":[],"edges":[]}}\n\n`));
            c.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
            c.close();
          },
        }),
      };
    });
    const res = await postVisualize(
      { projectId, prompt: "show graph" },
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: tool_use");
    expect(body).toContain("event: view_spec");
    expect(body).toContain("event: done");
  });

  it("returns 429 when same user has an active visualize", async () => {
    const { token, workspaceId, userId } = await seedUser();
    const { projectId } = await seedProject(workspaceId, userId);
    // Seed Redis flag to simulate concurrency lock held.
    // (Use existing test helper or stub the lock module.)
    const r1 = postVisualize({ projectId, prompt: "a" }, { token });
    const r2 = postVisualize({ projectId, prompt: "b" }, { token });
    const [res1, res2] = await Promise.all([r1, r2]);
    const codes = [res1.status, res2.status].sort();
    expect(codes).toContain(429);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @opencairn/api test visualize
```

- [ ] **Step 3: Implement the route**

```ts
// apps/api/src/routes/visualize.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ViewType } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { streamBuildView } from "../lib/temporal-visualize";
import { getTemporalClient } from "../lib/temporal-client";
import { getRedisClient } from "../lib/redis";
import type { AppEnv } from "../lib/types";

const visualizeBodySchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(500),
  viewType: ViewType.optional(),
});

const CONCURRENCY_TTL_SEC = 120;

export const visualizeRouter = new Hono<AppEnv>().post(
  "/",
  requireAuth,
  zValidator("json", visualizeBodySchema),
  async (c) => {
    const user = c.get("user");
    const { projectId, prompt, viewType } = c.req.valid("json");

    const allowed = await canRead(user.id, { type: "project", id: projectId });
    if (!allowed) return c.json({ error: "forbidden" }, 403);

    const redis = getRedisClient();
    const lockKey = `visualize:user:${user.id}`;
    const acquired = await redis.set(lockKey, "1", {
      NX: true, EX: CONCURRENCY_TTL_SEC,
    });
    if (acquired === null) {
      return c.json({
        error: "concurrent-visualize",
        messageKey: "graph.errors.concurrentVisualize",
      }, 429);
    }

    try {
      const client = await getTemporalClient();
      const handle = await client.workflow.start("VisualizeWorkflow", {
        // OR: client.activity.execute via a lightweight VisualizeWorkflow that
        //     calls a single build_view activity. Match the codebase's existing
        //     pattern for short-running activities (Deep Research Phase C).
        args: [{
          projectId,
          workspaceId: user.workspaceId,
          userId: user.id,
          prompt,
          viewType,
        }],
        taskQueue: "opencairn-default",
        workflowId: `visualize-${user.id}-${Date.now()}`,
      });

      const stream = streamBuildView(handle);

      // Release the Redis lock when the stream closes (end-of-stream or
      // client cancel). We do this by wrapping the stream in a transform
      // that calls `redis.del(lockKey)` in `flush`/`abort`.
      const wrapped = stream.pipeThrough(new TransformStream({
        flush: async () => { await redis.del(lockKey).catch(() => {}); },
      }));

      return new Response(wrapped, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (e) {
      await redis.del(lockKey).catch(() => {});
      throw e;
    }
  },
);
```

> **VisualizeWorkflow** vs activity-direct: 본 spec §5 는 "activity 직접 호출" 을 합의했습니다. 그러나 Temporal client API 는 activity 를 직접 client 에서 시작하는 경로가 제한적이라 실제로는 1-activity 짜리 workflow 를 써야 할 수 있습니다. Deep Research codebase 의 패턴을 grep 해 동일 형식 따라가세요. 본 task 의 구현 디테일은 codebase fit 우선.

`apps/api/src/app.ts` 또는 main router 파일에 mount 추가:

```ts
import { visualizeRouter } from "./routes/visualize";
// ...
.route("/api/visualize", visualizeRouter)
```

- [ ] **Step 4: VisualizeWorkflow 가 필요하다면 worker 에 추가**

`apps/worker/src/worker/workflows/visualize_workflow.py` (필요 시):

```python
"""1-activity workflow wrapping build_view (Plan 5 Phase 2)."""
from datetime import timedelta
from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    pass


@workflow.defn(name="VisualizeWorkflow")
class VisualizeWorkflow:
    @workflow.run
    async def run(self, req: dict) -> dict:
        return await workflow.execute_activity(
            "build_view",
            req,
            start_to_close_timeout=timedelta(seconds=60),
            heartbeat_timeout=timedelta(seconds=30),
        )
```

`apps/worker/src/worker/main.py` 의 `workflows=[...]` 리스트에 등록.

- [ ] **Step 5: Run tests — should PASS**

```bash
pnpm --filter @opencairn/api test visualize
cd apps/worker && uv run pytest -x
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/tests/routes/visualize.test.ts \
  apps/worker/src/worker/workflows/visualize_workflow.py \
  apps/worker/src/worker/main.py
git commit -m "feat(api,worker): add POST /api/visualize SSE + VisualizeWorkflow (Plan 5 Phase 2)"
```

---

## Task 12: `cytoscape-dagre` 의존 추가 + 회귀 가드

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml` (자동)

- [ ] **Step 1: Add dep**

```bash
pnpm --filter @opencairn/web add cytoscape-dagre@^2.5
pnpm --filter @opencairn/web add -D @types/cytoscape-dagre@^2.3 || true
```

`@types/cytoscape-dagre` 가 없으면 inline ambient declaration 또는 `// @ts-expect-error` 로 우회 (Phase 1 cytoscape-fcose 패턴 grep). 이 경우 추가:

```ts
// apps/web/src/types/cytoscape-dagre.d.ts (필요 시만)
declare module "cytoscape-dagre" {
  const ext: cytoscape.Ext;
  export = ext;
}
```

- [ ] **Step 2: Verify install + lockfile pinned**

```bash
grep -A1 "cytoscape-dagre" apps/web/package.json
# Expected: "^2.5" (or current latest 2.x), NOT "*" or "latest"
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/types/cytoscape-dagre.d.ts
git commit -m "chore(web): add cytoscape-dagre@^2.5 for mindmap view (Plan 5 Phase 2)"
```

---

## Task 13: `view-state-store.ts` (Zustand inline ViewSpec 캐시)

**Files:**
- Create: `apps/web/src/components/graph/view-state-store.ts`
- Test: `apps/web/src/components/graph/__tests__/view-state-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/components/graph/__tests__/view-state-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useViewStateStore } from "../view-state-store";
import type { ViewSpec } from "@opencairn/shared";

const sampleSpec: ViewSpec = {
  viewType: "mindmap",
  layout: "dagre",
  rootId: "11111111-1111-4111-8111-111111111111",
  nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "Root" }],
  edges: [],
};

describe("useViewStateStore", () => {
  beforeEach(() => {
    useViewStateStore.setState({ inline: {} });
  });

  it("setInline stores ViewSpec keyed by projectId+viewType+rootId", () => {
    useViewStateStore.getState().setInline("proj-1", sampleSpec);
    const got = useViewStateStore.getState().getInline(
      "proj-1", "mindmap", sampleSpec.rootId,
    );
    expect(got).toEqual(sampleSpec);
  });

  it("getInline returns null when no entry", () => {
    expect(
      useViewStateStore.getState().getInline("proj-1", "graph", null),
    ).toBeNull();
  });

  it("setInline overwrites prior entry for same key", () => {
    useViewStateStore.getState().setInline("proj-1", sampleSpec);
    const updated = { ...sampleSpec, rationale: "new" };
    useViewStateStore.getState().setInline("proj-1", updated);
    const got = useViewStateStore.getState().getInline(
      "proj-1", "mindmap", sampleSpec.rootId,
    );
    expect(got?.rationale).toBe("new");
  });

  it("clearProject removes only that project's entries", () => {
    useViewStateStore.getState().setInline("proj-1", sampleSpec);
    useViewStateStore.getState().setInline("proj-2", sampleSpec);
    useViewStateStore.getState().clearProject("proj-1");
    expect(
      useViewStateStore.getState().getInline(
        "proj-1", "mindmap", sampleSpec.rootId,
      ),
    ).toBeNull();
    expect(
      useViewStateStore.getState().getInline(
        "proj-2", "mindmap", sampleSpec.rootId,
      ),
    ).toEqual(sampleSpec);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

```bash
pnpm --filter @opencairn/web test view-state-store
```

- [ ] **Step 3: Implement the store**

```ts
// apps/web/src/components/graph/view-state-store.ts
"use client";
import { create } from "zustand";
import type { ViewSpec, ViewType } from "@opencairn/shared";

type Key = string;
function keyOf(projectId: string, viewType: ViewType, rootId: string | null): Key {
  return `${projectId}::${viewType}::${rootId ?? ""}`;
}

interface ViewStateStore {
  inline: Record<Key, ViewSpec>;
  setInline: (projectId: string, spec: ViewSpec) => void;
  getInline: (
    projectId: string,
    viewType: ViewType,
    rootId: string | null,
  ) => ViewSpec | null;
  clearProject: (projectId: string) => void;
}

export const useViewStateStore = create<ViewStateStore>((set, get) => ({
  inline: {},
  setInline: (projectId, spec) =>
    set((s) => ({
      inline: { ...s.inline, [keyOf(projectId, spec.viewType, spec.rootId)]: spec },
    })),
  getInline: (projectId, viewType, rootId) =>
    get().inline[keyOf(projectId, viewType, rootId)] ?? null,
  clearProject: (projectId) =>
    set((s) => {
      const next: Record<Key, ViewSpec> = {};
      for (const [k, v] of Object.entries(s.inline)) {
        if (!k.startsWith(`${projectId}::`)) next[k] = v;
      }
      return { inline: next };
    }),
}));
```

- [ ] **Step 4: Run tests — should PASS**

```bash
pnpm --filter @opencairn/web test view-state-store
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/view-state-store.ts \
  apps/web/src/components/graph/__tests__/view-state-store.test.ts
git commit -m "feat(web): add view-state-store for AI-emitted ViewSpec cache (Plan 5 Phase 2)"
```

---

## Task 14: `useProjectGraph` 훅 확장 (`?view`/`?root` + store inline 우선)

**Files:**
- Modify: `apps/web/src/components/graph/useProjectGraph.ts`
- Test: `apps/web/src/components/graph/__tests__/useProjectGraph.test.ts` (확장)

- [ ] **Step 1: Read existing hook to understand current shape**

```bash
cat apps/web/src/components/graph/useProjectGraph.ts | head -80
cat apps/web/src/components/graph/__tests__/useProjectGraph.test.ts | head -80
```

- [ ] **Step 2: Write the failing test (extension)**

```ts
// apps/web/src/components/graph/__tests__/useProjectGraph.test.ts (added cases)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProjectGraph } from "../useProjectGraph";
import { useViewStateStore } from "../view-state-store";
import type { ViewSpec } from "@opencairn/shared";

function wrap() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useProjectGraph view+root extension", () => {
  beforeEach(() => {
    useViewStateStore.setState({ inline: {} });
    vi.restoreAllMocks();
  });

  it("includes ?view=mindmap&root=<id> in fetch URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        viewType: "mindmap", layout: "dagre", rootId: "x",
        nodes: [], edges: [], truncated: false, totalConcepts: 0,
      })),
    );
    const { result } = renderHook(
      () => useProjectGraph("proj-1", { view: "mindmap", root: "x" }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const url = (fetchSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(url).toContain("view=mindmap");
    expect(url).toContain("root=x");
  });

  it("uses inline ViewSpec from store when present, skips fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const spec: ViewSpec = {
      viewType: "mindmap", layout: "dagre",
      rootId: "11111111-1111-4111-8111-111111111111",
      nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "x" }],
      edges: [],
    };
    useViewStateStore.getState().setInline("proj-1", spec);
    const { result } = renderHook(
      () => useProjectGraph("proj-1", { view: "mindmap", root: spec.rootId! }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.nodes).toEqual(spec.nodes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("query key includes view + root for cache separation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        viewType: "graph", layout: "fcose", rootId: null,
        nodes: [], edges: [], truncated: false, totalConcepts: 0,
      })),
    );
    const { result, rerender } = renderHook(
      ({ view }: { view: "graph" | "mindmap" }) =>
        useProjectGraph("proj-1", { view }),
      { wrapper: wrap(), initialProps: { view: "graph" } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ view: "mindmap" });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // 2 fetches — separate cache keys per view
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run test — FAIL**

- [ ] **Step 4: Extend the hook**

```ts
// apps/web/src/components/graph/useProjectGraph.ts (extended)
"use client";
import { useQuery } from "@tanstack/react-query";
import type { GraphViewResponse, ViewType } from "@opencairn/shared";
import { useViewStateStore } from "./view-state-store";

interface Options {
  view?: ViewType;
  root?: string;
}

async function fetchGraphView(
  projectId: string, opts: Options,
): Promise<GraphViewResponse> {
  const params = new URLSearchParams();
  params.set("view", opts.view ?? "graph");
  if (opts.root) params.set("root", opts.root);
  const res = await fetch(
    `/api/projects/${projectId}/graph?${params.toString()}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`graph fetch failed: ${res.status}`);
  return res.json();
}

export function useProjectGraph(projectId: string, opts: Options = {}) {
  const view = opts.view ?? "graph";
  const root = opts.root ?? null;
  const inline = useViewStateStore(
    (s) => s.getInline(projectId, view, root),
  );
  return useQuery<GraphViewResponse>({
    queryKey: ["project-graph", projectId, view, root],
    queryFn: async () => {
      // Inline cache (AI-emitted ViewSpec) takes priority — skip network.
      if (inline) {
        return {
          ...inline,
          truncated: false,
          totalConcepts: inline.nodes.length,
        };
      }
      return fetchGraphView(projectId, opts);
    },
    staleTime: 30_000,
    enabled: !!projectId,
  });
}
```

> 기존 훅이 `expand` 같은 추가 메소드를 노출하면 그 부분은 그대로 둡니다. Phase 1 호환성 우선.

- [ ] **Step 5: Run tests — Phase 1 useProjectGraph tests + 신규 모두 PASS**

```bash
pnpm --filter @opencairn/web test useProjectGraph
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/graph/useProjectGraph.ts \
  apps/web/src/components/graph/__tests__/useProjectGraph.test.ts
git commit -m "feat(web): extend useProjectGraph with view+root + inline-spec priority (Plan 5 Phase 2)"
```

---

## Task 15: 기존 `ProjectGraph` 본문을 `GraphView` 로 추출

ViewSwitcher + ViewRenderer 가 들어올 자리를 만들기 위해 Phase 1 의 단일 cytoscape 뷰를 단일 책임 컴포넌트로 옮긴다.

**Files:**
- Create: `apps/web/src/components/graph/views/GraphView.tsx`
- Modify: `apps/web/src/components/graph/ProjectGraph.tsx` (얇은 래퍼로 변경)
- Test: 기존 `ProjectGraph.test.tsx` 가 GraphView 로 이동, 회귀 0

- [ ] **Step 1: Snapshot Phase 1 ProjectGraph 동작**

```bash
pnpm --filter @opencairn/web test ProjectGraph
```

모두 PASS 인 상태 기록.

- [ ] **Step 2: Move Phase 1 logic into `GraphView.tsx`**

`apps/web/src/components/graph/ProjectGraph.tsx` 의 본문을 그대로 `views/GraphView.tsx` 로 옮기되 export name 만 `default function GraphView`.

```tsx
// apps/web/src/components/graph/views/GraphView.tsx
"use client";
// ... Phase 1 ProjectGraph.tsx 와 동일한 imports + 본문
// 단, 마지막 export 만:
//   export default function GraphView({ projectId }: { projectId: string }) { ... }
```

- [ ] **Step 3: 임시 ProjectGraph 를 GraphView 로 위임**

```tsx
// apps/web/src/components/graph/ProjectGraph.tsx (this task only)
"use client";
import GraphView from "./views/GraphView";
export function ProjectGraph({ projectId }: { projectId: string }) {
  return <GraphView projectId={projectId} />;
}
```

(다음 Task 16/17 에서 ViewSwitcher + ViewRenderer 로 대체됨)

- [ ] **Step 4: Move/update tests**

```bash
mv apps/web/src/components/graph/__tests__/ProjectGraph.test.tsx \
   apps/web/src/components/graph/views/__tests__/GraphView.test.tsx
```

테스트 안의 import 만 `import { ProjectGraph }` → `import GraphView` (default) 로 변경.

- [ ] **Step 5: Run all graph tests — 회귀 0**

```bash
pnpm --filter @opencairn/web test src/components/graph
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/graph
git commit -m "refactor(web): extract Phase 1 cytoscape view into GraphView (Plan 5 Phase 2)"
```

---

## Task 16: `ViewSwitcher` 컴포넌트

**Files:**
- Create: `apps/web/src/components/graph/ViewSwitcher.tsx`
- Test: `apps/web/src/components/graph/__tests__/ViewSwitcher.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/graph/__tests__/ViewSwitcher.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { ViewSwitcher } from "../ViewSwitcher";
import koGraph from "@/messages/ko/graph.json";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ViewSwitcher", () => {
  let replace: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    replace = vi.fn();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ replace });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams(),
    );
  });

  it("renders 5 view buttons + AI trigger", () => {
    renderWithIntl(<ViewSwitcher onAiClick={() => {}} />);
    for (const v of ["graph", "mindmap", "cards", "timeline", "board"]) {
      expect(screen.getByRole("button", {
        name: koGraph.views[v as keyof typeof koGraph.views],
      })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", {
      name: new RegExp(koGraph.ai.trigger),
    })).toBeInTheDocument();
  });

  it("clicking a view replaces ?view= and preserves other params", () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("relation=uses&view=graph"),
    );
    renderWithIntl(<ViewSwitcher onAiClick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: koGraph.views.cards }));
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("view=cards"),
      expect.objectContaining({ scroll: false }),
    );
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain("relation=uses");
  });

  it("switching to non-mindmap/board drops ?root", () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("view=mindmap&root=abc"),
    );
    renderWithIntl(<ViewSwitcher onAiClick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: koGraph.views.cards }));
    const url = replace.mock.calls[0][0] as string;
    expect(url).not.toContain("root=");
  });

  it("AI trigger calls onAiClick", () => {
    const onAi = vi.fn();
    renderWithIntl(<ViewSwitcher onAiClick={onAi} />);
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(koGraph.ai.trigger) }),
    );
    expect(onAi).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement the component**

```tsx
// apps/web/src/components/graph/ViewSwitcher.tsx
"use client";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import type { ViewType } from "@opencairn/shared";

const VIEW_KEYS: ViewType[] = ["graph", "mindmap", "cards", "timeline", "board"];

interface Props {
  onAiClick: () => void;
}

export function ViewSwitcher({ onAiClick }: Props) {
  const tViews = useTranslations("graph.views");
  const tAi = useTranslations("graph.ai");
  const router = useRouter();
  const params = useSearchParams();
  const current = (params.get("view") as ViewType | null) ?? "graph";

  function setView(v: ViewType) {
    const next = new URLSearchParams(params.toString());
    next.set("view", v);
    if (v !== "mindmap" && v !== "board") next.delete("root");
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  return (
    <div
      className="flex items-center justify-between border-b px-3 py-2"
      role="group"
      aria-label={tViews("switcherAria")}
    >
      <div className="flex gap-1">
        {VIEW_KEYS.map((v) => (
          <button
            key={v}
            type="button"
            data-active={current === v ? "true" : "false"}
            onClick={() => setView(v)}
            className={
              current === v
                ? "rounded bg-accent px-3 py-1 text-sm font-medium"
                : "rounded px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
            }
          >
            {tViews(v)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAiClick}
        className="rounded text-sm text-accent-foreground hover:underline"
      >
        🤖 {tAi("trigger")}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test — should PASS**

(아직 i18n 키 없으면 Task 27 의 i18n 작업을 먼저 하거나 stub 키 추가. Task 27 이전엔 ko/en `graph.json` 의 `views.*`/`ai.*` 가 없으므로 `next-intl` 가 throw 함. 임시로 messages json 에 키 stub 만 추가하고 Task 27 에서 정식 카피 확정.)

```bash
pnpm --filter @opencairn/web test ViewSwitcher
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/ViewSwitcher.tsx \
  apps/web/src/components/graph/__tests__/ViewSwitcher.test.tsx
git commit -m "feat(web): add ViewSwitcher segmented control + AI trigger (Plan 5 Phase 2)"
```

---

## Task 17: `ViewRenderer` 컴포넌트 (`?view=` 분기)

**Files:**
- Create: `apps/web/src/components/graph/ViewRenderer.tsx`
- Test: `apps/web/src/components/graph/__tests__/ViewRenderer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/graph/__tests__/ViewRenderer.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSearchParams } from "next/navigation";
import { ViewRenderer } from "../ViewRenderer";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

vi.mock("../views/GraphView", () => ({
  default: () => <div data-testid="graph-view" />,
}));
vi.mock("../views/MindmapView", () => ({
  default: () => <div data-testid="mindmap-view" />,
}));
vi.mock("../views/BoardView", () => ({
  default: () => <div data-testid="board-view" />,
}));
vi.mock("../views/CardsView", () => ({
  default: () => <div data-testid="cards-view" />,
}));
vi.mock("../views/TimelineView", () => ({
  default: () => <div data-testid="timeline-view" />,
}));

function setView(view: string | null, root: string | null = null) {
  const sp = new URLSearchParams();
  if (view) sp.set("view", view);
  if (root) sp.set("root", root);
  (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(sp);
}

describe("ViewRenderer", () => {
  it("default view=graph mounts GraphView", () => {
    setView(null);
    render(<ViewRenderer projectId="p-1" />);
    expect(screen.getByTestId("graph-view")).toBeInTheDocument();
  });

  it("?view=mindmap mounts MindmapView", () => {
    setView("mindmap", "abc");
    render(<ViewRenderer projectId="p-1" />);
    expect(screen.getByTestId("mindmap-view")).toBeInTheDocument();
  });

  it("?view=board mounts BoardView", () => {
    setView("board");
    render(<ViewRenderer projectId="p-1" />);
    expect(screen.getByTestId("board-view")).toBeInTheDocument();
  });

  it("?view=cards mounts CardsView", () => {
    setView("cards");
    render(<ViewRenderer projectId="p-1" />);
    expect(screen.getByTestId("cards-view")).toBeInTheDocument();
  });

  it("?view=timeline mounts TimelineView", () => {
    setView("timeline");
    render(<ViewRenderer projectId="p-1" />);
    expect(screen.getByTestId("timeline-view")).toBeInTheDocument();
  });

  it("unknown ?view= falls back to graph", () => {
    setView("unknown");
    render(<ViewRenderer projectId="p-1" />);
    expect(screen.getByTestId("graph-view")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/graph/ViewRenderer.tsx
"use client";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { ViewType } from "@opencairn/shared";

// Cytoscape views need DOM — disable SSR (Phase 1 pattern).
const GraphView = dynamic(() => import("./views/GraphView"), { ssr: false });
const MindmapView = dynamic(() => import("./views/MindmapView"), { ssr: false });
const BoardView = dynamic(() => import("./views/BoardView"), { ssr: false });
// Pure-React views — SSR-safe.
const CardsView = dynamic(() => import("./views/CardsView"));
const TimelineView = dynamic(() => import("./views/TimelineView"));

interface Props { projectId: string; }

export function ViewRenderer({ projectId }: Props) {
  const params = useSearchParams();
  const view = (params.get("view") as ViewType | null) ?? "graph";
  const root = params.get("root") ?? undefined;

  switch (view) {
    case "mindmap": return <MindmapView projectId={projectId} root={root} />;
    case "board":   return <BoardView projectId={projectId} root={root} />;
    case "cards":   return <CardsView projectId={projectId} />;
    case "timeline":return <TimelineView projectId={projectId} />;
    case "graph":
    default:        return <GraphView projectId={projectId} />;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @opencairn/web test ViewRenderer
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/ViewRenderer.tsx \
  apps/web/src/components/graph/__tests__/ViewRenderer.test.tsx
git commit -m "feat(web): add ViewRenderer for ?view= dispatch (Plan 5 Phase 2)"
```

---

## Task 18: `MindmapView` (cytoscape-dagre)

**Files:**
- Create: `apps/web/src/components/graph/views/MindmapView.tsx`
- Test: `apps/web/src/components/graph/views/__tests__/MindmapView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/graph/views/__tests__/MindmapView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import MindmapView from "../MindmapView";
import koGraph from "@/messages/ko/graph.json";

vi.mock("react-cytoscapejs", () => ({
  default: ({ layout }: { layout: { name: string } }) => (
    <div data-testid="cy" data-layout={layout?.name} />
  ),
}));

vi.mock("../../useProjectGraph", () => ({
  useProjectGraph: vi.fn(),
}));

import { useProjectGraph } from "../../useProjectGraph";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("MindmapView", () => {
  it("renders 'needsRoot' empty state when data has no nodes", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { nodes: [], edges: [], rootId: null,
              viewType: "mindmap", layout: "dagre",
              truncated: false, totalConcepts: 0 },
      isLoading: false, error: null,
    });
    wrap(<MindmapView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.needsRoot)).toBeInTheDocument();
  });

  it("renders cytoscape with layout=dagre when nodes exist", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "mindmap", layout: "dagre",
        rootId: "11111111-1111-4111-8111-111111111111",
        nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "Root" }],
        edges: [], truncated: false, totalConcepts: 1,
      },
      isLoading: false, error: null,
    });
    wrap(<MindmapView projectId="p-1" root="11111111-1111-4111-8111-111111111111" />);
    expect(screen.getByTestId("cy").getAttribute("data-layout")).toBe("dagre");
  });

  it("calls useProjectGraph with view='mindmap' + root", () => {
    const spy = vi.fn().mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    (useProjectGraph as ReturnType<typeof vi.fn>).mockImplementation(spy);
    wrap(<MindmapView projectId="p-1" root="abc" />);
    expect(spy).toHaveBeenCalledWith("p-1", { view: "mindmap", root: "abc" });
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/graph/views/MindmapView.tsx
"use client";
import { useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectGraph } from "../useProjectGraph";

const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
});

if (typeof window !== "undefined") {
  cytoscape.use(dagre);
}

interface Props { projectId: string; root?: string; }

export default function MindmapView({ projectId, root }: Props) {
  const t = useTranslations("graph");
  const router = useRouter();
  const params = useSearchParams();
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "mindmap", root,
  });

  const elements = useMemo(() => {
    if (!data) return [];
    return [
      ...data.nodes.map((n) => ({
        data: { id: n.id, label: n.name, type: "node", isRoot: n.id === data.rootId },
      })),
      ...data.edges.map((e) => ({
        data: {
          id: `${e.sourceId}-${e.targetId}`,
          source: e.sourceId, target: e.targetId, type: "edge",
        },
      })),
    ];
  }, [data]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{t("errors.loadFailed")}</div>;
  if (!data || data.nodes.length === 0) {
    return (
      <div data-testid="mindmap-needs-root" className="p-6 text-sm text-muted-foreground">
        {t("views.needsRoot")}
      </div>
    );
  }

  return (
    <CytoscapeComponent
      elements={elements}
      layout={{
        name: "dagre", rankDir: "LR",
        spacingFactor: 1.2, fit: true, padding: 30,
      }}
      stylesheet={[
        { selector: "node", style: { label: "data(label)", "font-size": 12 } },
        { selector: 'node[?isRoot]', style: { "border-width": 2, "background-color": "#666" } },
        { selector: "edge", style: {
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "target-arrow-color": "#888",
          "line-color": "#bbb",
        } },
      ]}
      cy={(cy) => {
        cy.removeAllListeners();
        cy.on("tap", "node", (evt) => {
          const id = evt.target.id();
          if (id === data.rootId) return;
          const next = new URLSearchParams(params.toString());
          next.set("view", "mindmap");
          next.set("root", id);
          router.replace(`?${next.toString()}`, { scroll: false });
        });
      }}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
```

> 더블클릭 → 노트 점프 (Phase 1 패턴) 등 추가 인터랙션은 GraphView 와 일관성 있게 별도 follow-up 으로. Phase 2 mindmap 의 핵심 인터랙션은 *root 변경*.

- [ ] **Step 4: Run tests — should PASS**

```bash
pnpm --filter @opencairn/web test MindmapView
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/views/MindmapView.tsx \
  apps/web/src/components/graph/views/__tests__/MindmapView.test.tsx
git commit -m "feat(web): add MindmapView with cytoscape-dagre + root-change UX (Plan 5 Phase 2)"
```

---

## Task 19: `BoardView` (cytoscape preset)

**Files:**
- Create: `apps/web/src/components/graph/views/BoardView.tsx`
- Test: `apps/web/src/components/graph/views/__tests__/BoardView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/graph/views/__tests__/BoardView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import BoardView from "../BoardView";
import koGraph from "@/messages/ko/graph.json";

vi.mock("react-cytoscapejs", () => ({
  default: ({ layout }: { layout: { name: string } }) => (
    <div data-testid="cy" data-layout={layout?.name} />
  ),
}));

vi.mock("../../useProjectGraph", () => ({
  useProjectGraph: vi.fn(),
}));
import { useProjectGraph } from "../../useProjectGraph";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>{ui}</NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BoardView", () => {
  it("renders cytoscape with layout=preset", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "board", layout: "preset", rootId: null,
        nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "n" }],
        edges: [], truncated: false, totalConcepts: 1,
      },
      isLoading: false, error: null,
    });
    wrap(<BoardView projectId="p-1" />);
    expect(screen.getByTestId("cy").getAttribute("data-layout")).toBe("preset");
  });

  it("renders empty state when no nodes", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { viewType: "board", layout: "preset", rootId: null,
              nodes: [], edges: [], truncated: false, totalConcepts: 0 },
      isLoading: false, error: null,
    });
    wrap(<BoardView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.noConcepts)).toBeInTheDocument();
  });

  it("calls useProjectGraph with view='board' + optional root", () => {
    const spy = vi.fn().mockReturnValue({ data: undefined, isLoading: true, error: null });
    (useProjectGraph as ReturnType<typeof vi.fn>).mockImplementation(spy);
    wrap(<BoardView projectId="p-1" root="abc" />);
    expect(spy).toHaveBeenCalledWith("p-1", { view: "board", root: "abc" });
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/graph/views/BoardView.tsx
"use client";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useProjectGraph } from "../useProjectGraph";

const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
});

interface Props { projectId: string; root?: string; }

export default function BoardView({ projectId, root }: Props) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "board", root,
  });

  const elements = useMemo(() => {
    if (!data) return [];
    return [
      ...data.nodes.map((n, i) => ({
        data: { id: n.id, label: n.name, type: "node" },
        position: n.position ?? autoConcentric(i, data.nodes.length),
      })),
      ...data.edges.map((e) => ({
        data: { id: `${e.sourceId}-${e.targetId}`,
                source: e.sourceId, target: e.targetId, type: "edge" },
      })),
    ];
  }, [data]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{t("errors.loadFailed")}</div>;
  if (!data || data.nodes.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">{t("views.noConcepts")}</div>;
  }

  return (
    <CytoscapeComponent
      elements={elements}
      layout={{ name: "preset", fit: true, padding: 30 }}
      stylesheet={[
        { selector: "node", style: { label: "data(label)", "font-size": 12 } },
        { selector: "edge", style: {
          "curve-style": "bezier", "line-color": "#bbb",
        } },
      ]}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function autoConcentric(i: number, n: number) {
  const radius = 200 + Math.floor(i / 12) * 120;
  const theta = (i % 12) * (2 * Math.PI / 12);
  return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
}
```

- [ ] **Step 4: Run tests — should PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/views/BoardView.tsx \
  apps/web/src/components/graph/views/__tests__/BoardView.test.tsx
git commit -m "feat(web): add BoardView with cytoscape preset layout (Plan 5 Phase 2)"
```

---

## Task 20: `CardsView` (CSS grid + ConceptCard)

**Files:**
- Create: `apps/web/src/components/graph/views/CardsView.tsx`
- Create: `apps/web/src/components/graph/views/ConceptCard.tsx`
- Test: `apps/web/src/components/graph/views/__tests__/CardsView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/graph/views/__tests__/CardsView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import CardsView from "../CardsView";
import koGraph from "@/messages/ko/graph.json";

vi.mock("../../useProjectGraph", () => ({ useProjectGraph: vi.fn() }));
vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (sel: any) => sel({ addOrReplacePreview: tabsAddOrReplace }),
}));

import { useProjectGraph } from "../../useProjectGraph";
const tabsAddOrReplace = vi.fn();

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>{ui}</NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("CardsView", () => {
  it("renders empty state when total=0", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { nodes: [], edges: [], rootId: null,
              viewType: "cards", layout: "preset",
              truncated: false, totalConcepts: 0 },
      isLoading: false, error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.noConcepts)).toBeInTheDocument();
  });

  it("renders one card per node with name + description", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "cards", layout: "preset", rootId: null,
        nodes: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Trans", description: "model" },
          { id: "22222222-2222-4222-8222-222222222222", name: "BERT", description: "encoder" },
        ],
        edges: [], truncated: false, totalConcepts: 2,
      },
      isLoading: false, error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    expect(screen.getByText("Trans")).toBeInTheDocument();
    expect(screen.getByText("BERT")).toBeInTheDocument();
    expect(screen.getByText("model")).toBeInTheDocument();
  });

  it("clicking a card with firstNoteId opens preview tab", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "cards", layout: "preset", rootId: null,
        nodes: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Trans",
            firstNoteId: "33333333-3333-4333-8333-333333333333" },
        ],
        edges: [], truncated: false, totalConcepts: 1,
      },
      isLoading: false, error: null,
    });
    wrap(<CardsView projectId="p-1" />);
    fireEvent.click(screen.getByText("Trans"));
    expect(tabsAddOrReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "note",
        targetId: "33333333-3333-4333-8333-333333333333",
        mode: "plate",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/graph/views/ConceptCard.tsx
"use client";
import { useTabsStore } from "@/stores/tabs-store";
import type { ViewNode } from "@opencairn/shared";

export function ConceptCard({ node }: { node: ViewNode }) {
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);
  function open() {
    if (!node.firstNoteId) return;
    addOrReplacePreview({
      id: crypto.randomUUID(),
      kind: "note",
      targetId: node.firstNoteId,
      mode: "plate",
      title: node.name,
      pinned: false,
      preview: true,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={!node.firstNoteId}
      className="flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left hover:bg-accent disabled:opacity-50"
    >
      <span className="text-sm font-medium">{node.name}</span>
      {node.description && (
        <span className="line-clamp-3 text-xs text-muted-foreground">
          {node.description}
        </span>
      )}
      {typeof node.degree === "number" && (
        <span className="text-xs text-muted-foreground">🔗 {node.degree}</span>
      )}
    </button>
  );
}
```

```tsx
// apps/web/src/components/graph/views/CardsView.tsx
"use client";
import { useTranslations } from "next-intl";
import { useProjectGraph } from "../useProjectGraph";
import { ConceptCard } from "./ConceptCard";

interface Props { projectId: string; }

export default function CardsView({ projectId }: Props) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "cards",
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{t("errors.loadFailed")}</div>;
  if (!data || data.nodes.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">{t("views.noConcepts")}</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 overflow-y-auto p-4 lg:grid-cols-3 xl:grid-cols-4">
      {data.nodes.map((n) => <ConceptCard key={n.id} node={n} />)}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — should PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/views/CardsView.tsx \
  apps/web/src/components/graph/views/ConceptCard.tsx \
  apps/web/src/components/graph/views/__tests__/CardsView.test.tsx
git commit -m "feat(web): add CardsView with concept grid (Plan 5 Phase 2)"
```

---

## Task 21: `TimelineView` (custom React + SVG)

**Files:**
- Create: `apps/web/src/components/graph/views/TimelineView.tsx`
- Create: `apps/web/src/components/graph/views/timeline-layout.ts`
- Test: `apps/web/src/components/graph/views/__tests__/TimelineView.test.tsx`
- Test: `apps/web/src/components/graph/views/__tests__/timeline-layout.test.ts`

- [ ] **Step 1: Write the failing layout test**

```ts
// apps/web/src/components/graph/views/__tests__/timeline-layout.test.ts
import { describe, it, expect } from "vitest";
import { layoutTimeline } from "../timeline-layout";
import type { ViewNode } from "@opencairn/shared";

const nodes = (xs: Array<Partial<ViewNode> & { id: string; name: string }>) =>
  xs as ViewNode[];

describe("layoutTimeline", () => {
  it("returns empty positions for empty input", () => {
    const out = layoutTimeline(nodes([]));
    expect(out.nodes).toEqual([]);
    expect(out.ticks).toEqual([]);
    expect(out.width).toBeGreaterThan(0);
  });

  it("uses eventYear when available, otherwise falls back to createdAt", () => {
    const out = layoutTimeline(nodes([
      { id: "a", name: "Trans", eventYear: 2017 },
      { id: "b", name: "BERT", eventYear: 2018 },
    ]));
    const xa = out.nodes.find((n) => n.id === "a")!.x;
    const xb = out.nodes.find((n) => n.id === "b")!.x;
    expect(xa).toBeLessThan(xb);
  });

  it("x-coordinates are monotonically non-decreasing in input order if sorted", () => {
    const out = layoutTimeline(nodes([
      { id: "a", name: "1", eventYear: 1990 },
      { id: "b", name: "2", eventYear: 2000 },
      { id: "c", name: "3", eventYear: 2010 },
    ]));
    const xs = out.nodes.map((n) => n.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    }
  });

  it("ticks span min/max year", () => {
    const out = layoutTimeline(nodes([
      { id: "a", name: "1", eventYear: 1990 },
      { id: "b", name: "2", eventYear: 2010 },
    ]));
    expect(out.ticks.length).toBeGreaterThan(0);
    const tickYears = out.ticks.map((t) => t.label);
    expect(tickYears[0]).toContain("1990");
    expect(tickYears[tickYears.length - 1]).toContain("2010");
  });
});
```

- [ ] **Step 2: Run layout test — FAIL**

- [ ] **Step 3: Implement layout helper**

```ts
// apps/web/src/components/graph/views/timeline-layout.ts
import type { ViewNode } from "@opencairn/shared";

const NODE_RADIUS = 8;
const NODE_PADDING_X = 80;
const HEIGHT = 200;
const MIN_WIDTH = 800;

export interface PositionedNode {
  id: string;
  name: string;
  description?: string;
  x: number;
  y: number;
  firstNoteId?: string | null;
}

export interface TimelineTick {
  x: number;
  label: string;
}

export interface TimelineLayout {
  nodes: PositionedNode[];
  ticks: TimelineTick[];
  width: number;
  height: number;
}

function nodeYear(n: ViewNode): number | null {
  if (typeof n.eventYear === "number") return n.eventYear;
  // Fallback to createdAt encoded in node metadata if present (server adds
  // it in cards/timeline branches). Without it, treat as missing.
  const created = (n as ViewNode & { createdAt?: string }).createdAt;
  if (typeof created === "string") {
    const yr = new Date(created).getFullYear();
    if (Number.isFinite(yr)) return yr;
  }
  return null;
}

export function layoutTimeline(input: ViewNode[]): TimelineLayout {
  if (input.length === 0) {
    return { nodes: [], ticks: [], width: MIN_WIDTH, height: HEIGHT };
  }
  const sorted = [...input].sort((a, b) => {
    const ya = nodeYear(a) ?? 0;
    const yb = nodeYear(b) ?? 0;
    return ya - yb;
  });
  const years = sorted
    .map((n) => nodeYear(n))
    .filter((y): y is number => y !== null);
  const minYear = years[0] ?? 0;
  const maxYear = years[years.length - 1] ?? minYear;
  const span = Math.max(1, maxYear - minYear);
  const width = Math.max(MIN_WIDTH, sorted.length * NODE_PADDING_X);

  const positionedNodes: PositionedNode[] = sorted.map((n) => {
    const y = nodeYear(n);
    const ratio = y === null ? 0.5 : (y - minYear) / span;
    return {
      id: n.id,
      name: n.name,
      description: n.description,
      firstNoteId: n.firstNoteId ?? null,
      x: NODE_PADDING_X / 2 + ratio * (width - NODE_PADDING_X),
      y: HEIGHT / 2,
    };
  });

  const tickCount = Math.min(8, Math.max(2, span < 20 ? span + 1 : 8));
  const ticks: TimelineTick[] = Array.from({ length: tickCount }, (_, i) => {
    const ratio = tickCount === 1 ? 0 : i / (tickCount - 1);
    const year = Math.round(minYear + ratio * span);
    return {
      x: NODE_PADDING_X / 2 + ratio * (width - NODE_PADDING_X),
      label: String(year),
    };
  });

  return { nodes: positionedNodes, ticks, width, height: HEIGHT };
}

export const TIMELINE_NODE_RADIUS = NODE_RADIUS;
```

- [ ] **Step 4: Run layout test — should PASS**

- [ ] **Step 5: Write the failing view test**

```tsx
// apps/web/src/components/graph/views/__tests__/TimelineView.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import TimelineView from "../TimelineView";
import koGraph from "@/messages/ko/graph.json";

vi.mock("../../useProjectGraph", () => ({ useProjectGraph: vi.fn() }));
vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (sel: any) => sel({ addOrReplacePreview: openPreview }),
}));

import { useProjectGraph } from "../../useProjectGraph";
const openPreview = vi.fn();

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>{ui}</NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("TimelineView", () => {
  it("renders empty state when no nodes", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { nodes: [], edges: [], rootId: null,
              viewType: "timeline", layout: "preset",
              truncated: false, totalConcepts: 0 },
      isLoading: false, error: null,
    });
    wrap(<TimelineView projectId="p-1" />);
    expect(screen.getByText(koGraph.views.noConcepts)).toBeInTheDocument();
  });

  it("renders 1 SVG circle per node", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "timeline", layout: "preset", rootId: null,
        nodes: [
          { id: "a", name: "1", eventYear: 1990 },
          { id: "b", name: "2", eventYear: 2000 },
        ],
        edges: [], truncated: false, totalConcepts: 2,
      },
      isLoading: false, error: null,
    });
    const { container } = wrap(<TimelineView projectId="p-1" />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("clicking a node with firstNoteId opens preview", () => {
    (useProjectGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        viewType: "timeline", layout: "preset", rootId: null,
        nodes: [
          { id: "a", name: "Trans", eventYear: 2017,
            firstNoteId: "33333333-3333-4333-8333-333333333333" },
        ],
        edges: [], truncated: false, totalConcepts: 1,
      },
      isLoading: false, error: null,
    });
    wrap(<TimelineView projectId="p-1" />);
    fireEvent.click(screen.getByText("Trans"));
    expect(openPreview).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "33333333-3333-4333-8333-333333333333" }),
    );
  });
});
```

- [ ] **Step 6: Run view test — FAIL**

- [ ] **Step 7: Implement TimelineView**

```tsx
// apps/web/src/components/graph/views/TimelineView.tsx
"use client";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useProjectGraph } from "../useProjectGraph";
import { useTabsStore } from "@/stores/tabs-store";
import {
  layoutTimeline,
  TIMELINE_NODE_RADIUS,
  type PositionedNode,
} from "./timeline-layout";

interface Props { projectId: string; }

export default function TimelineView({ projectId }: Props) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, {
    view: "timeline",
  });
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);

  const layout = useMemo(
    () => layoutTimeline(data?.nodes ?? []),
    [data],
  );

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{t("errors.loadFailed")}</div>;
  if (!data || data.nodes.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">{t("views.noConcepts")}</div>;
  }

  function openNote(n: PositionedNode) {
    if (!n.firstNoteId) return;
    addOrReplacePreview({
      id: crypto.randomUUID(),
      kind: "note",
      targetId: n.firstNoteId,
      mode: "plate",
      title: n.name,
      pinned: false, preview: true, dirty: false,
      splitWith: null, splitSide: null, scrollY: 0,
    });
  }

  return (
    <div className="h-full overflow-x-auto p-4">
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={t("views.timeline")}
      >
        <line
          x1={0} x2={layout.width}
          y1={layout.height / 2} y2={layout.height / 2}
          className="stroke-muted-foreground"
        />
        {layout.ticks.map((tk) => (
          <g key={tk.x}>
            <line
              x1={tk.x} x2={tk.x}
              y1={layout.height / 2 - 6} y2={layout.height / 2 + 6}
              className="stroke-muted-foreground"
            />
            <text
              x={tk.x} y={layout.height / 2 + 24}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {tk.label}
            </text>
          </g>
        ))}
        {layout.nodes.map((n) => (
          <g key={n.id} onClick={() => openNote(n)} style={{ cursor: n.firstNoteId ? "pointer" : "default" }}>
            <circle
              cx={n.x} cy={n.y}
              r={TIMELINE_NODE_RADIUS}
              className="fill-primary"
            />
            <text
              x={n.x} y={n.y - 16}
              textAnchor="middle"
              className="fill-foreground text-xs"
            >
              {n.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 8: Run all timeline tests — should PASS**

```bash
pnpm --filter @opencairn/web test TimelineView timeline-layout
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/graph/views/TimelineView.tsx \
  apps/web/src/components/graph/views/timeline-layout.ts \
  apps/web/src/components/graph/views/__tests__/TimelineView.test.tsx \
  apps/web/src/components/graph/views/__tests__/timeline-layout.test.ts
git commit -m "feat(web): add TimelineView with custom SVG layout (Plan 5 Phase 2)"
```

---

## Task 22: `useVisualizeMutation` (SSE 클라이언트)

**Files:**
- Create: `apps/web/src/components/graph/ai/useVisualizeMutation.ts`
- Create: `apps/web/src/components/graph/ai/sse-parser.ts`
- Test: `apps/web/src/components/graph/ai/__tests__/useVisualizeMutation.test.ts`
- Test: `apps/web/src/components/graph/ai/__tests__/sse-parser.test.ts`

- [ ] **Step 1: Write the failing parser test**

```ts
// apps/web/src/components/graph/ai/__tests__/sse-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseSseChunks } from "../sse-parser";

describe("parseSseChunks", () => {
  it("parses a single complete event from buffer, returns remainder", () => {
    const { events, remainder } = parseSseChunks(
      "event: tool_use\ndata: {\"name\":\"x\"}\n\nevent: in",
    );
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("tool_use");
    expect(events[0].data).toEqual({ name: "x" });
    expect(remainder).toBe("event: in");
  });

  it("handles multi-line data fields", () => {
    const { events } = parseSseChunks(
      "event: view_spec\ndata: {\"viewSpec\":{\"viewType\":\"graph\",\"layout\":\"fcose\",\"rootId\":null,\"nodes\":[],\"edges\":[]}}\n\n",
    );
    expect(events[0].event).toBe("view_spec");
    expect((events[0].data as any).viewSpec.viewType).toBe("graph");
  });

  it("returns empty events when buffer has no terminator", () => {
    const { events, remainder } = parseSseChunks("event: tool_use\ndata: {}");
    expect(events).toHaveLength(0);
    expect(remainder).toBe("event: tool_use\ndata: {}");
  });

  it("ignores invalid JSON gracefully", () => {
    const { events } = parseSseChunks("event: tool_use\ndata: not-json\n\n");
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement parser**

```ts
// apps/web/src/components/graph/ai/sse-parser.ts
export interface SseEvent {
  event: string;
  data: unknown;
}

export function parseSseChunks(
  buffer: string,
): { events: SseEvent[]; remainder: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split("\n\n");
  // Last block may be incomplete — keep as remainder.
  const remainder = blocks.pop() ?? "";
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }
    if (dataLines.length === 0) continue;
    try {
      events.push({ event, data: JSON.parse(dataLines.join("\n")) });
    } catch {
      // skip invalid block
    }
  }
  return { events, remainder };
}
```

- [ ] **Step 4: Run parser test — should PASS**

- [ ] **Step 5: Write the failing mutation hook test**

```ts
// apps/web/src/components/graph/ai/__tests__/useVisualizeMutation.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVisualizeMutation } from "../useVisualizeMutation";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe("useVisualizeMutation", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("collects progress events and viewSpec on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(streamFromChunks([
        `event: tool_use\ndata: {"name":"search_concepts","callId":"1"}\n\n`,
        `event: tool_result\ndata: {"callId":"1","ok":true}\n\n`,
        `event: view_spec\ndata: {"viewSpec":{"viewType":"graph","layout":"fcose","rootId":null,"nodes":[],"edges":[]}}\n\n`,
        `event: done\ndata: {}\n\n`,
      ]), { headers: { "Content-Type": "text/event-stream" } }),
    );
    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      await result.current.submit({ projectId: "p", prompt: "graph" });
    });
    await waitFor(() => expect(result.current.viewSpec?.viewType).toBe("graph"));
    expect(result.current.progress.length).toBeGreaterThanOrEqual(2);
    expect(result.current.error).toBeNull();
  });

  it("captures error event", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(streamFromChunks([
        `event: error\ndata: {"error":"agent_did_not_emit_view_spec","messageKey":"graph.errors.visualizeFailed"}\n\n`,
        `event: done\ndata: {}\n\n`,
      ]), { headers: { "Content-Type": "text/event-stream" } }),
    );
    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      await result.current.submit({ projectId: "p", prompt: "x" });
    });
    await waitFor(() =>
      expect(result.current.error).toBe("agent_did_not_emit_view_spec"));
  });

  it("cancel aborts the in-flight fetch", async () => {
    let abortReason: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) => new Promise((_resolve, reject) => {
        (init?.signal as AbortSignal | undefined)?.addEventListener(
          "abort",
          () => {
            abortReason = (init!.signal as AbortSignal).reason;
            reject(new Error("aborted"));
          },
        );
      }),
    );
    const { result } = renderHook(() => useVisualizeMutation());
    await act(async () => {
      void result.current.submit({ projectId: "p", prompt: "x" });
      await new Promise((r) => setTimeout(r, 5));
      result.current.cancel();
    });
    await waitFor(() => expect(abortReason).toBeDefined());
  });
});
```

- [ ] **Step 6: Run hook test — FAIL**

- [ ] **Step 7: Implement the hook**

```ts
// apps/web/src/components/graph/ai/useVisualizeMutation.ts
"use client";
import { useCallback, useRef, useState } from "react";
import type { ViewSpec, ViewType } from "@opencairn/shared";
import { parseSseChunks, type SseEvent } from "./sse-parser";

export interface ProgressEvent {
  event: "tool_use" | "tool_result";
  payload: Record<string, unknown>;
}

interface SubmitArgs {
  projectId: string;
  prompt: string;
  viewType?: ViewType;
}

export function useVisualizeMutation() {
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [viewSpec, setViewSpec] = useState<ViewSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const submit = useCallback(async (args: SubmitArgs) => {
    setProgress([]);
    setViewSpec(null);
    setError(null);
    setSubmitting(true);
    abortRef.current = new AbortController();
    try {
      const resp = await fetch("/api/visualize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: abortRef.current.signal,
      });
      if (!resp.ok) {
        const code = resp.status === 429 ? "concurrent-visualize" : "visualizeFailed";
        setError(code);
        return;
      }
      if (!resp.body) {
        setError("visualizeFailed");
        return;
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { events, remainder } = parseSseChunks(buf);
        buf = remainder;
        for (const ev of events) handleEvent(ev);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError("visualizeFailed");
    } finally {
      setSubmitting(false);
    }

    function handleEvent(ev: SseEvent) {
      if (ev.event === "tool_use" || ev.event === "tool_result") {
        setProgress((prev) => [
          ...prev,
          { event: ev.event, payload: ev.data as Record<string, unknown> },
        ]);
      } else if (ev.event === "view_spec") {
        const data = ev.data as { viewSpec: ViewSpec };
        setViewSpec(data.viewSpec);
      } else if (ev.event === "error") {
        const data = ev.data as { error: string };
        setError(data.error);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { submit, cancel, progress, viewSpec, error, submitting };
}
```

- [ ] **Step 8: Run all SSE tests — should PASS**

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/graph/ai/useVisualizeMutation.ts \
  apps/web/src/components/graph/ai/sse-parser.ts \
  apps/web/src/components/graph/ai/__tests__
git commit -m "feat(web): add useVisualizeMutation SSE client + parser (Plan 5 Phase 2)"
```

---

## Task 23: `useViewSpecApply` 훅

**Files:**
- Create: `apps/web/src/components/graph/useViewSpecApply.ts`
- Test: `apps/web/src/components/graph/__tests__/useViewSpecApply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/components/graph/__tests__/useViewSpecApply.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useViewSpecApply } from "../useViewSpecApply";
import { useViewStateStore } from "../view-state-store";
import type { ViewSpec } from "@opencairn/shared";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

const baseSpec: ViewSpec = {
  viewType: "mindmap", layout: "dagre",
  rootId: "11111111-1111-4111-8111-111111111111",
  nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "n" }],
  edges: [], rationale: "test",
};

describe("useViewSpecApply", () => {
  let replace: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    replace = vi.fn();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ replace });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("relation=uses"),
    );
    useViewStateStore.setState({ inline: {} });
  });

  it("stores spec in view-state-store keyed by projectId", () => {
    const { result } = renderHook(() => useViewSpecApply());
    act(() => result.current(baseSpec, "proj-1"));
    const got = useViewStateStore.getState().getInline(
      "proj-1", "mindmap", baseSpec.rootId,
    );
    expect(got).toEqual(baseSpec);
  });

  it("navigates with view + root + preserves other params", () => {
    const { result } = renderHook(() => useViewSpecApply());
    act(() => result.current(baseSpec, "proj-1"));
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain("view=mindmap");
    expect(url).toContain(`root=${baseSpec.rootId}`);
    expect(url).toContain("relation=uses");
  });

  it("drops root when spec.rootId is null", () => {
    const { result } = renderHook(() => useViewSpecApply());
    act(() => result.current(
      { ...baseSpec, viewType: "cards", rootId: null }, "proj-1",
    ));
    const url = replace.mock.calls[0][0] as string;
    expect(url).not.toContain("root=");
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement**

```ts
// apps/web/src/components/graph/useViewSpecApply.ts
"use client";
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ViewSpec } from "@opencairn/shared";
import { useViewStateStore } from "./view-state-store";

export function useViewSpecApply() {
  const router = useRouter();
  const params = useSearchParams();
  const setInline = useViewStateStore((s) => s.setInline);

  return useCallback(
    (spec: ViewSpec, projectId: string) => {
      setInline(projectId, spec);
      const next = new URLSearchParams(params.toString());
      next.set("view", spec.viewType);
      if (spec.rootId) next.set("root", spec.rootId);
      else next.delete("root");
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, params, setInline],
  );
}
```

- [ ] **Step 4: Run tests — should PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/useViewSpecApply.ts \
  apps/web/src/components/graph/__tests__/useViewSpecApply.test.ts
git commit -m "feat(web): add useViewSpecApply for AI ViewSpec → URL+store (Plan 5 Phase 2)"
```

---

## Task 24: `VisualizeDialog` 컴포넌트

**Files:**
- Create: `apps/web/src/components/graph/ai/VisualizeDialog.tsx`
- Create: `apps/web/src/components/graph/ai/VisualizeProgress.tsx`
- Test: `apps/web/src/components/graph/ai/__tests__/VisualizeDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/graph/ai/__tests__/VisualizeDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { VisualizeDialog } from "../VisualizeDialog";
import koGraph from "@/messages/ko/graph.json";

vi.mock("../useVisualizeMutation", () => ({ useVisualizeMutation: vi.fn() }));
vi.mock("../../useViewSpecApply", () => ({ useViewSpecApply: vi.fn() }));

import { useVisualizeMutation } from "../useVisualizeMutation";
import { useViewSpecApply } from "../../useViewSpecApply";

const renderD = (props: Partial<React.ComponentProps<typeof VisualizeDialog>> = {}) =>
  render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
      <VisualizeDialog open onClose={() => {}} projectId="p-1" {...props} />
    </NextIntlClientProvider>,
  );

describe("VisualizeDialog", () => {
  let submit: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  let apply: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    submit = vi.fn();
    cancel = vi.fn();
    apply = vi.fn();
    (useViewSpecApply as ReturnType<typeof vi.fn>).mockReturnValue(apply);
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit, cancel,
      progress: [], viewSpec: null, error: null, submitting: false,
    });
  });

  it("renders title + prompt textarea + submit button", () => {
    renderD();
    expect(screen.getByText(koGraph.ai.dialogTitle)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(koGraph.ai.promptPlaceholder)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: koGraph.ai.submit })).toBeInTheDocument();
  });

  it("submit calls mutation with prompt + projectId", () => {
    renderD();
    fireEvent.change(screen.getByPlaceholderText(koGraph.ai.promptPlaceholder), {
      target: { value: "transformer mindmap" },
    });
    fireEvent.click(screen.getByRole("button", { name: koGraph.ai.submit }));
    expect(submit).toHaveBeenCalledWith({
      projectId: "p-1",
      prompt: "transformer mindmap",
      viewType: undefined,
    });
  });

  it("when viewSpec arrives, applies it and closes", async () => {
    const onClose = vi.fn();
    const spec = {
      viewType: "graph", layout: "fcose", rootId: null,
      nodes: [], edges: [],
    };
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit, cancel,
      progress: [], viewSpec: spec, error: null, submitting: false,
    });
    renderD({ onClose });
    await waitFor(() => {
      expect(apply).toHaveBeenCalledWith(spec, "p-1");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("renders error message when error present", () => {
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit, cancel, progress: [], viewSpec: null,
      error: "visualizeFailed", submitting: false,
    });
    renderD();
    expect(screen.getByText(koGraph.errors.visualizeFailed)).toBeInTheDocument();
  });

  it("cancel button cancels mutation", () => {
    (useVisualizeMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      submit, cancel, progress: [],
      viewSpec: null, error: null, submitting: true,
    });
    renderD();
    fireEvent.click(screen.getByRole("button", { name: /취소|Cancel/ }));
    expect(cancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement progress sub-component**

```tsx
// apps/web/src/components/graph/ai/VisualizeProgress.tsx
"use client";
import { useTranslations } from "next-intl";
import type { ProgressEvent } from "./useVisualizeMutation";

export function VisualizeProgress({ events }: { events: ProgressEvent[] }) {
  const t = useTranslations("graph.ai.progress");
  if (events.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
      {events.map((ev, i) => {
        const name = (ev.payload as { name?: string }).name ?? "";
        const ok = (ev.payload as { ok?: boolean }).ok;
        const label = name && t.has(name) ? t(name) : name || ev.event;
        const icon = ev.event === "tool_use" ? "▸"
                     : ok === false ? "⚠" : "✓";
        return <li key={i}>{icon} {label}</li>;
      })}
    </ul>
  );
}
```

> `t.has(name)` 가 next-intl 에서 미지원이면 try/catch 또는 상수 lookup 으로 fallback. 정확한 API 는 surrounding 사용처 grep.

- [ ] **Step 4: Implement VisualizeDialog**

```tsx
// apps/web/src/components/graph/ai/VisualizeDialog.tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";  // shadcn
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { ViewType } from "@opencairn/shared";
import { useVisualizeMutation } from "./useVisualizeMutation";
import { useViewSpecApply } from "../useViewSpecApply";
import { VisualizeProgress } from "./VisualizeProgress";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

const VIEW_OPTIONS: ReadonlyArray<ViewType | undefined> = [
  undefined, "graph", "mindmap", "cards", "timeline", "board",
];

export function VisualizeDialog({ open, onClose, projectId }: Props) {
  const tAi = useTranslations("graph.ai");
  const tErr = useTranslations("graph.errors");
  const tCommon = useTranslations("common");
  const apply = useViewSpecApply();
  const { submit, cancel, progress, viewSpec, error, submitting } =
    useVisualizeMutation();
  const [prompt, setPrompt] = useState("");
  const [viewType, setViewType] = useState<ViewType | undefined>(undefined);

  useEffect(() => {
    if (viewSpec) {
      apply(viewSpec, projectId);
      onClose();
    }
  }, [viewSpec, apply, projectId, onClose]);

  function onSubmit() {
    if (!prompt.trim()) return;
    submit({ projectId, prompt: prompt.trim(), viewType });
  }
  function onCancel() {
    cancel();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tAi("dialogTitle")}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={tAi("promptPlaceholder")}
          maxLength={500}
          disabled={submitting}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {VIEW_OPTIONS.map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setViewType(v)}
              data-active={viewType === v ? "true" : "false"}
              className={
                viewType === v
                  ? "rounded bg-accent px-2 py-1 text-xs font-medium"
                  : "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              }
            >
              {v ? tAi(`viewType_${v}` as never, {} as never).toString() :
                   tAi("viewTypeAuto")}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {tErr(error as never)}
          </p>
        )}
        <VisualizeProgress events={progress} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={!prompt.trim() || submitting}>
            {submitting ? tAi("submitting") : tAi("submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

> `viewType_<v>` 키 매핑은 `tAi(v as never)` 처럼 단순화 가능 (i18n 키가 `graph.ai.<viewType>` 이면). 정확한 키 구조는 Task 27 i18n 작업과 정합 — 둘 중 하나에 맞춰 일관.

- [ ] **Step 5: Run tests — should PASS**

```bash
pnpm --filter @opencairn/web test VisualizeDialog
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/graph/ai/VisualizeDialog.tsx \
  apps/web/src/components/graph/ai/VisualizeProgress.tsx \
  apps/web/src/components/graph/ai/__tests__/VisualizeDialog.test.tsx
git commit -m "feat(web): add VisualizeDialog with NL input + SSE progress (Plan 5 Phase 2)"
```

---

## Task 25: `ProjectGraph` 를 ViewSwitcher + ViewRenderer + VisualizeDialog 구조로 재조립

Tasks 16/17 의 컴포넌트를 합쳐 `mode='graph'` 탭의 진입점 (`ProjectGraphViewer` 가 mount 하는 컴포넌트) 을 만든다.

**Files:**
- Modify: `apps/web/src/components/graph/ProjectGraph.tsx`
- Test: `apps/web/src/components/graph/__tests__/ProjectGraph.test.tsx` (재작성)

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/graph/__tests__/ProjectGraph.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProjectGraph } from "../ProjectGraph";
import koGraph from "@/messages/ko/graph.json";

vi.mock("../ViewSwitcher", () => ({
  ViewSwitcher: ({ onAiClick }: { onAiClick: () => void }) => (
    <button data-testid="switcher-ai" onClick={onAiClick}>ai</button>
  ),
}));
vi.mock("../ViewRenderer", () => ({
  ViewRenderer: ({ projectId }: { projectId: string }) => (
    <div data-testid="renderer">{projectId}</div>
  ),
}));
vi.mock("../ai/VisualizeDialog", () => ({
  VisualizeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dialog" /> : null,
}));

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>{ui}</NextIntlClientProvider>,
  );
}

describe("ProjectGraph (assembled)", () => {
  it("mounts ViewSwitcher + ViewRenderer with projectId", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    expect(screen.getByTestId("renderer").textContent).toBe("p-1");
    expect(screen.getByTestId("switcher-ai")).toBeInTheDocument();
  });

  it("AI button opens VisualizeDialog", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("switcher-ai"));
    expect(screen.getByTestId("dialog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Reassemble**

```tsx
// apps/web/src/components/graph/ProjectGraph.tsx
"use client";
import { useState } from "react";
import { ViewSwitcher } from "./ViewSwitcher";
import { ViewRenderer } from "./ViewRenderer";
import { VisualizeDialog } from "./ai/VisualizeDialog";

interface Props { projectId: string; }

export function ProjectGraph({ projectId }: Props) {
  const [aiOpen, setAiOpen] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <ViewSwitcher onAiClick={() => setAiOpen(true)} />
      <div className="min-h-0 flex-1">
        <ViewRenderer projectId={projectId} />
      </div>
      <VisualizeDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests — should PASS, Phase 1 GraphView 회귀 0**

```bash
pnpm --filter @opencairn/web test src/components/graph
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/ProjectGraph.tsx \
  apps/web/src/components/graph/__tests__/ProjectGraph.test.tsx
git commit -m "feat(web): assemble ProjectGraph from switcher+renderer+dialog (Plan 5 Phase 2)"
```

---

## Task 26: 키보드 단축키 1-5 (탭 활성 시 view 전환)

**Files:**
- Modify: `apps/web/src/components/graph/ProjectGraph.tsx` (effect 추가)
- Test: `apps/web/src/components/graph/__tests__/ProjectGraph-shortcuts.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/graph/__tests__/ProjectGraph-shortcuts.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ProjectGraph } from "../ProjectGraph";
import koGraph from "@/messages/ko/graph.json";
import { useRouter, useSearchParams } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));
vi.mock("../ViewRenderer", () => ({ ViewRenderer: () => <div /> }));
vi.mock("../ai/VisualizeDialog", () => ({ VisualizeDialog: () => null }));
vi.mock("../ViewSwitcher", () => ({ ViewSwitcher: () => <div /> }));

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>{ui}</NextIntlClientProvider>,
  );
}

describe("ProjectGraph keyboard shortcuts", () => {
  let replace: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    replace = vi.fn();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ replace });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams(),
    );
  });

  it("pressing 2 switches to mindmap when no input is focused", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    const url = replace.mock.calls[0]?.[0] as string | undefined;
    expect(url).toContain("view=mindmap");
  });

  it("pressing 3 switches to cards", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" }));
    expect((replace.mock.calls[0]?.[0] as string)).toContain("view=cards");
  });

  it("ignores number keys when an input is focused", () => {
    const { container } = wrap(<ProjectGraph projectId="p-1" />);
    const input = document.createElement("input");
    container.appendChild(input);
    input.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    expect(replace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement shortcut effect**

`ProjectGraph.tsx` 본문에 추가:

```tsx
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ViewType } from "@opencairn/shared";

const VIEW_BY_KEY: Record<string, ViewType> = {
  "1": "graph", "2": "mindmap", "3": "cards", "4": "timeline", "5": "board",
};

export function ProjectGraph({ projectId }: Props) {
  const [aiOpen, setAiOpen] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === "input" || tag === "textarea" ||
        target?.isContentEditable
      ) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const view = VIEW_BY_KEY[e.key];
      if (!view) return;
      const next = new URLSearchParams(params.toString());
      next.set("view", view);
      if (view !== "mindmap" && view !== "board") next.delete("root");
      router.replace(`?${next.toString()}`, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, params]);

  // ... 기존 JSX
}
```

- [ ] **Step 4: Run tests — should PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/graph/ProjectGraph.tsx \
  apps/web/src/components/graph/__tests__/ProjectGraph-shortcuts.test.tsx
git commit -m "feat(web): add 1-5 keyboard shortcuts for view switching (Plan 5 Phase 2)"
```

---

## Task 27: i18n 키 (`messages/{ko,en}/graph.json`)

**Files:**
- Modify: `apps/web/messages/ko/graph.json`
- Modify: `apps/web/messages/en/graph.json`

- [ ] **Step 1: Add ko keys**

기존 `messages/ko/graph.json` (Phase 1) 에 추가:

```jsonc
{
  // ... Phase 1 viewer / filters / nodeMenu / empty / errors 유지
  "views": {
    "graph": "그래프",
    "mindmap": "마인드맵",
    "cards": "카드",
    "timeline": "타임라인",
    "board": "보드",
    "switcherAria": "뷰 전환",
    "needsRoot": "이 뷰는 중심 개념이 필요합니다. 검색에서 개념을 선택하거나 'AI로 만들기'를 사용하세요.",
    "noConcepts": "이 프로젝트에는 아직 개념이 없습니다."
  },
  "ai": {
    "trigger": "AI로 만들기",
    "dialogTitle": "AI로 뷰 만들기",
    "promptPlaceholder": "예) 트랜스포머 주제로 마인드맵, 딥러닝 역사 타임라인…",
    "viewTypeAuto": "자동",
    "viewType_graph": "그래프",
    "viewType_mindmap": "마인드맵",
    "viewType_cards": "카드",
    "viewType_timeline": "타임라인",
    "viewType_board": "보드",
    "submit": "생성하기",
    "submitting": "생성 중…",
    "progress": {
      "search_concepts": "개념 검색 중…",
      "get_concept_graph": "관계 가져오는 중…",
      "emit_structured_output": "뷰 구성 중…"
    },
    "rationale": "AI 추천 근거"
  },
  "errors": {
    // Phase 1 errors 키들 유지
    "loadFailed": "그래프를 불러오지 못했습니다.",
    "tooManyHops": "이웃 펼치기 단계는 최대 3까지 가능합니다.",
    "forbidden": "이 프로젝트에 접근 권한이 없습니다.",
    "notFound": "찾을 수 없는 개념입니다.",
    "visualizeFailed": "AI 뷰 생성에 실패했습니다.",
    "visualizeTimeout": "AI 뷰 생성 시간이 초과되었습니다. 다시 시도해주세요.",
    "concurrent-visualize": "이미 진행 중인 AI 뷰 생성이 있습니다.",
    "promptTooLong": "요청은 500자 이내로 작성해주세요.",
    "missingRoot": "이 뷰는 중심 개념이 필요합니다.",
    "agent_did_not_emit_view_spec": "AI 뷰 생성에 실패했습니다."
  }
}
```

- [ ] **Step 2: Add en keys (parity)**

```jsonc
{
  "views": {
    "graph": "Graph",
    "mindmap": "Mindmap",
    "cards": "Cards",
    "timeline": "Timeline",
    "board": "Board",
    "switcherAria": "Switch view",
    "needsRoot": "This view needs a focus concept. Pick one from search or use 'Generate with AI'.",
    "noConcepts": "This project has no concepts yet."
  },
  "ai": {
    "trigger": "Generate with AI",
    "dialogTitle": "Generate a view with AI",
    "promptPlaceholder": "e.g. transformer mindmap, history of deep learning timeline…",
    "viewTypeAuto": "Auto",
    "viewType_graph": "Graph",
    "viewType_mindmap": "Mindmap",
    "viewType_cards": "Cards",
    "viewType_timeline": "Timeline",
    "viewType_board": "Board",
    "submit": "Generate",
    "submitting": "Generating…",
    "progress": {
      "search_concepts": "Searching concepts…",
      "get_concept_graph": "Fetching relations…",
      "emit_structured_output": "Composing the view…"
    },
    "rationale": "Why this view"
  },
  "errors": {
    "loadFailed": "Failed to load graph.",
    "tooManyHops": "Neighbor expansion is capped at 3 hops.",
    "forbidden": "You don't have access to this project.",
    "notFound": "Concept not found.",
    "visualizeFailed": "AI view generation failed.",
    "visualizeTimeout": "AI view generation timed out. Please try again.",
    "concurrent-visualize": "An AI view generation is already in progress.",
    "promptTooLong": "Request must be 500 characters or fewer.",
    "missingRoot": "This view needs a focus concept.",
    "agent_did_not_emit_view_spec": "AI view generation failed."
  }
}
```

- [ ] **Step 3: Verify i18n parity**

```bash
pnpm --filter @opencairn/web i18n:parity
```

Phase 1 키들이 빠지지 않도록 양쪽 파일 모두 추가 (Phase 1 viewer/filters/nodeMenu/empty 키 유지).

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/ko/graph.json apps/web/messages/en/graph.json
git commit -m "i18n(web): add views/ai/error keys for Plan 5 Phase 2 (ko/en parity)"
```

---

## Task 28: CI 회귀 가드

**Files:**
- Modify: `.github/workflows/ci.yml` (또는 동급 lint job)

- [ ] **Step 1: Find existing Phase 1 cytoscape grep guards**

```bash
grep -n "cytoscape" .github/workflows/ci.yml
```

Phase 1 가드 위치 파악 후 같은 step 에 추가.

- [ ] **Step 2: Add Phase 2 guards**

기존 grep 가드 step 에 다음 라인 추가:

```yaml
- name: Phase 2 regression guards
  run: |
    # cytoscape-dagre floating 차단
    ! grep -RE "cytoscape-dagre:?\\s*\\^?(latest|\\*)" \
      apps/web/package.json apps/web/src/

    # ViewSpec 스키마가 SCHEMA_REGISTRY 에 등록되어 있어야 함
    grep -q 'register_schema("ViewSpec"' \
      apps/worker/src/worker/tools_builtin/view_spec_schema.py

    # SSE event 토큰 (클라이언트 파서 의존)
    grep -q "event: view_spec" apps/api/src/routes/visualize.ts
    grep -q "event: tool_use" apps/api/src/routes/visualize.ts
    grep -q "event: done" apps/api/src/routes/visualize.ts || \
      grep -q "event: done" apps/api/src/lib/temporal-visualize.ts

    # ViewSpec enum 5뷰
    grep -q "graph.*mindmap.*cards.*timeline.*board" \
      packages/shared/src/api-types.ts
```

- [ ] **Step 3: Run guards locally**

```bash
bash -c '
! grep -RE "cytoscape-dagre:?\s*\^?(latest|\*)" apps/web/package.json apps/web/src/ &&
grep -q "register_schema(\"ViewSpec\"" apps/worker/src/worker/tools_builtin/view_spec_schema.py &&
grep -q "event: view_spec" apps/api/src/lib/temporal-visualize.ts &&
grep -q "graph.*mindmap.*cards.*timeline.*board" packages/shared/src/api-types.ts &&
echo "all guards pass"
'
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Plan 5 Phase 2 regression guards (Plan 5 Phase 2)"
```

---

## Task 29: Playwright E2E

**Files:**
- Create: `apps/web/tests/e2e/graph-views.spec.ts`

- [ ] **Step 1: Find Phase 1 graph.spec.ts to mirror auth + seed pattern**

```bash
ls apps/web/tests/e2e/ | grep -i graph
cat apps/web/tests/e2e/graph.spec.ts | head -80
```

- [ ] **Step 2: Write the E2E**

```ts
// apps/web/tests/e2e/graph-views.spec.ts
import { test, expect } from "@playwright/test";
import { signInAsTestUser, seedProjectWithConcepts } from "./helpers/auth";

test.describe("Plan 5 Phase 2 — view switcher + AI dialog", () => {
  test("toggling view buttons changes URL ?view= and renders the right body", async ({ page }) => {
    const { projectId, wsSlug } = await seedProjectWithConcepts({
      conceptCount: 5, withEdges: true,
    });
    await signInAsTestUser(page);
    await page.goto(`/w/${wsSlug}/p/${projectId}/graph`);

    // graph 뷰 — Phase 1 회귀
    await expect(page.getByRole("button", { name: /그래프|Graph/ }))
      .toHaveAttribute("data-active", "true");

    // 카드 뷰 토글
    await page.getByRole("button", { name: /카드|Cards/ }).click();
    await expect(page).toHaveURL(/view=cards/);
    await expect(page.locator("[data-testid=concept-card]")).not.toHaveCount(0);

    // 마인드맵 뷰 (root 미지정) → needsRoot 빈 상태
    await page.getByRole("button", { name: /마인드맵|Mindmap/ }).click();
    await expect(page).toHaveURL(/view=mindmap/);
    await expect(
      page.getByText(/중심 개념이 필요합니다|This view needs a focus concept/),
    ).toBeVisible();

    // 그래프로 돌아가서 노드 더블클릭 → root 지정 → 마인드맵 뷰 → 트리
    await page.getByRole("button", { name: /그래프|Graph/ }).click();
    // (실제 노드 클릭 흐름은 Phase 1 spec 패턴 답습.)
  });

  test("AI dialog: prompt → SSE progress → ViewSpec → URL navigate", async ({ page }) => {
    const { projectId, wsSlug } = await seedProjectWithConcepts({
      conceptCount: 5,
    });
    await signInAsTestUser(page);
    await page.goto(`/w/${wsSlug}/p/${projectId}/graph`);

    await page.getByRole("button", { name: /AI|AI로 만들기|Generate with AI/ }).click();
    await page.getByPlaceholder(/마인드맵|Mindmap|timeline/).fill("show me a graph");
    await page.getByRole("button", { name: /생성하기|Generate/ }).click();

    // dev 환경에서는 Vis Agent activity 가 mock provider 로 동작 (deterministic ViewSpec).
    // 종결 후 URL 이 ?view=… 로 변경되었는지 확인.
    await expect.poll(async () => page.url(), { timeout: 20_000 })
      .toMatch(/view=/);
  });

  test("?view= direct URL access mounts the correct view", async ({ page }) => {
    const { projectId, wsSlug } = await seedProjectWithConcepts({
      conceptCount: 4,
    });
    await signInAsTestUser(page);
    await page.goto(`/w/${wsSlug}/p/${projectId}/graph?view=cards`);
    await expect(page.locator("[data-testid=concept-card]")).not.toHaveCount(0);
  });
});
```

> `seedProjectWithConcepts`, `signInAsTestUser` 가 e2e helpers 에 없으면 Phase 1 의 동등 helper grep 후 동일 패턴으로 추가. 본 task 의 핵심은 Vis Agent mock 이 dev 환경에서 deterministic 응답을 줄 수 있도록 worker fixture 구성. Real Gemini 호출은 unit/integration 만 사용.

- [ ] **Step 3: Run E2E (local; CI 는 별도)**

```bash
pnpm --filter @opencairn/web playwright test graph-views
```

dev 서버 + worker fixture 가 동시에 떠 있어야 함. Phase 1 graph.spec.ts 와 동일한 setup 패턴.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/graph-views.spec.ts
git commit -m "test(web): add Plan 5 Phase 2 Playwright E2E (5 views + AI dialog)"
```

---

## Task 30: Verification + 수동 스모크 + spec verification 체크박스 통과

**Files:**
- 없음 (검증만, 결과를 PR description 에 기록)

- [ ] **Step 1: 모든 자동 테스트 + i18n parity + build 통과**

```bash
# DB
pnpm --filter @opencairn/db test
# API
pnpm --filter @opencairn/api test
# Web
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web i18n:parity
pnpm --filter @opencairn/web build
# Worker
cd apps/worker && uv run pytest -x
```

각 명령 출력에서 0 fail / 0 skip-unexpected 확인.

- [ ] **Step 2: 회귀 가드 grep 0 hit**

```bash
bash -c '
! grep -RE "cytoscape-dagre:?\s*\^?(latest|\*)" apps/web/package.json apps/web/src/ &&
grep -q "register_schema(\"ViewSpec\"" apps/worker/src/worker/tools_builtin/view_spec_schema.py &&
grep -q "event: view_spec" apps/api/src/lib/temporal-visualize.ts &&
grep -q "graph.*mindmap.*cards.*timeline.*board" packages/shared/src/api-types.ts &&
echo "all guards pass"
'
```

- [ ] **Step 3: 수동 스모크 (dev 환경, 5뷰 + AI)**

```bash
docker-compose up -d
pnpm dev
```

브라우저에서:
1. `/w/<slug>/p/<projectId>/graph` 진입 → Phase 1 graph 뷰 마운트 (Phase 1 회귀 확인)
2. ViewSwitcher 5 버튼 모두 클릭 → 즉시 (≤500ms) 뷰 변경 확인
3. graph 뷰 노드 클릭 → root 지정 → mindmap 뷰 클릭 → root 가 지정된 트리
4. cards 뷰 → ConceptCard 클릭 → preview tab 으로 노트 열림
5. timeline 뷰 → 빈 timeline 또는 정상 timeline 표시
6. board 뷰 → preset 레이아웃 + 드래그 가능
7. AI 버튼 → dialog → "이 프로젝트 그래프" prompt → SSE progress 라벨 순차 표시 → ViewSpec 수신 → 새 뷰 마운트 (≤15s)
8. 동일 user 동시 AI dialog 2개 열고 동시 submit → 두 번째 429 토스트 (`graph.errors.concurrent-visualize`)
9. AI dialog submit 중 dialog 닫기 → SSE abort → 워커 activity heartbeat cancel
10. 직접 URL `?view=mindmap&root=<id>` 입력 → mindmap 자동 마운트

- [ ] **Step 4: Spec verification 체크박스 모두 통과 확인**

`docs/superpowers/specs/2026-04-26-plan-5-kg-phase-2-design.md` §9 의 11개 체크박스가 모두 ✅ 인지 PR description 에 명시.

- [ ] **Step 5: PR 생성**

```bash
git push -u origin feat/plan-5-kg-phase-2
gh pr create --title "Plan 5 Phase 2 — 4-view expansion + Visualization Agent (NL)" \
  --body "$(cat <<'EOF'
## Summary
- 단일 `mode='graph'` 탭 안에 인-탭 ViewSwitcher + 4 신규 뷰 (mindmap/cards/timeline/board) 추가
- VisualizationAgent on Sub-A `run_with_tools` + ViewSpec Pydantic 스키마 (SCHEMA_REGISTRY 등록) + 3-tool inventory (search_concepts / get_concept_graph / emit_structured_output)
- 결정 경로: GET `/api/projects/:id/graph?view=&root=` 확장
- NL 경로: POST `/api/visualize` SSE
- DB 변경 0; 5뷰의 `canvas` → `board` 재명명 (Plan 7 충돌 회피)

## Test plan
- [x] DB / API / Web / Worker 자동 테스트 0 fail
- [x] i18n parity ko/en
- [x] CI 회귀 가드 (cytoscape-dagre / SSE 토큰 / SCHEMA_REGISTRY / 5뷰 enum)
- [x] Playwright E2E (5뷰 토글 + AI dialog + URL direct)
- [x] 수동: 5뷰 토글 즉시 (≤500ms), AI ViewSpec 종결 (≤15s), 동시성 429
- [x] Phase 1 회귀 0 (graph 뷰 + Backlinks)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: PR URL 출력**

PR URL 을 사용자에게 보고.

---

## Self-Review

### Spec coverage 매핑

| spec §1.1 in-scope 항목 | 구현 task |
|---|---|
| 1. ViewSwitcher + ViewRenderer 추가, URL `?view=` | Task 16, 17, 25, 26 |
| 2. 5뷰 컴포넌트 (graph/mindmap/board/cards/timeline) | Task 15 (extract), 18, 19, 20, 21 |
| 3. `/graph?view=&root=` 확장 + 응답 shape | Task 9 |
| 4. POST `/api/visualize` SSE 라우트 | Task 11 |
| 5. VisualizationAgent (Sub-A `run_with_tools`) | Task 5 |
| 6. 신규 빌트인 툴 1개 + 스키마 1개 | Task 2 (schema), 4 (get_concept_graph) |
| 7. Temporal `build_view` activity + main.py 등록 | Task 7 |
| 8. POST `/api/internal/projects/:id/graph/expand` | Task 8 |
| 9. ViewSpec Zod 스키마 (packages/shared) | Task 1 |
| 10. VisualizeDialog + useVisualizeMutation | Task 22, 23, 24 |
| 11. i18n (ko/en parity) | Task 27 |
| 12. 회귀 가드 | Task 28 |
| 13. Vitest + API + worker pytest + Playwright E2E | Task 1-26 (각 task TDD), 29 |

추가 작업:
- AgentApiClient.expand_concept_graph 메소드: Task 3
- HeartbeatLoopHooks (SSE relay): Task 6
- view-state-store (zustand inline 캐시): Task 13
- useProjectGraph 확장: Task 14
- cytoscape-dagre 의존: Task 12
- 키보드 단축키 1-5: Task 26
- Verification + PR: Task 30

### 빠진 게 있는지 체크

- ✅ DB 변경 0 — Tasks 에 db migration 없음, OK
- ✅ Phase 1 회귀 — Task 15 (extract GraphView) + Task 25 (reassemble) 후 기존 GraphView.test.tsx + Phase 1 E2E 모두 PASS 확인 필요. Task 30 verification 에 포함됨
- ✅ internal API workspace scope memo — Task 8 의 zod schema 가 workspaceId 강제, handler 가 projects.workspaceId 대조
- ✅ apps/api ESM import 컨벤션 — plan에 명시 (header + Task 8/9/10/11 메모)

### Type consistency

- `ViewType` enum: `graph | mindmap | cards | timeline | board` — Task 1 (Zod), Task 2 (Pydantic Literal), Task 27 (i18n keys), Task 16/17 (UI) 모두 동일 5뷰
- `ViewLayout`: `fcose | dagre | preset | cose-bilkent` — Task 1 + Task 2 + prompts (Task 5) 일치
- `LoopResult.final_structured_output` (`final_structured_output: dict | None`) — Task 5 의 agent.run + Task 7 의 activity 가 일관 사용
- `LoopConfig(max_turns=6, max_tool_calls=10)` — Task 5 agent + Task 5 spec test 일관
- `terminate_*` 류 시그니처는 spec/plan 모두 미사용 (실제 Sub-A에는 없음)

### Placeholder scan

플랜 본문에서 다음 류는 의도적으로 남겨둔 codebase fit 포인트만 표기:
- Task 8: "Phase 1 의 user-session `/graph/expand` ... helper 함수로 추출" — codebase grep 결과에 따라 결정. 추출하면 DRY, 안 하면 인라인. 실제 작업 시 결정.
- Task 9: helper 함수들 (`selectMaxDegreeConcept` 등) — 같은 파일 inline vs 신규 모듈 — 실제 graph.ts 사이즈 보고 결정.
- Task 10: Temporal client polling shape — Deep Research 의 `temporal-research.ts` 패턴 참고. 정확한 API 는 codebase 의 기존 SSE 사용처 grep.
- Task 11: VisualizeWorkflow vs activity-direct — Temporal client API 제한 시 1-activity workflow 로. Deep Research 패턴 참고.

이 4개는 "codebase 기존 패턴 grep 후 결정" 류로, 본 plan 의 spec 합의 영역이 아니라 구현 detail. 각 task 본문에 명시함.

### 변경 이력

- 2026-04-26: 최초 작성. Spec [docs/superpowers/specs/2026-04-26-plan-5-kg-phase-2-design.md](../specs/2026-04-26-plan-5-kg-phase-2-design.md) 의 6 섹션 합의를 30 task TDD 로 분해. apps/api ESM 컨벤션 (memo) 준수.

