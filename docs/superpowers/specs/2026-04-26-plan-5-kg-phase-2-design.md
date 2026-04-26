# Plan 5 · Knowledge Graph Phase 2 — 4뷰 확장 + Visualization Agent (NL)

**Date:** 2026-04-26
**Status:** Draft (브레인스토밍 합의 완료, 구현 plan 작성 대기)
**Builds on:** [Plan 5 Phase 1 design](2026-04-25-plan-5-knowledge-graph-design.md) (mode='graph' Cytoscape + Backlinks + wiki_links + GET /api/notes/:id/backlinks + GET /api/projects/:id/graph(/expand))

**Related:**
- [Agent Runtime v2 Sub-A — Core Tool Loop](2026-04-22-agent-runtime-v2a-core-tool-loop-design.md) — VisualizationAgent 의 토대 (`run_with_tools`, `LoopConfig`, `LoopHooks`, hardcoded `emit_structured_output` 종결 경로, `SCHEMA_REGISTRY`)
- [Agent Runtime v2 — Umbrella](2026-04-22-agent-runtime-v2-umbrella.md) §Sub-B — Compiler/Research/Librarian retrofit. 본 Phase 는 Sub-B 의존을 분리, VisualizationAgent 가 Sub-A 첫 외부 소비자 + Sub-B reference impl 역할
- [Tab System Design](2026-04-20-tab-system-design.md) §URL 동기화 — `mode='graph'` 단일 탭 안의 `?view=` 인-탭 라우팅
- [App Shell Redesign](2026-04-23-app-shell-redesign-design.md) §탭 모드 라우터 — Phase 1 의 `'graph'` mode 추가 위에 인-탭 view 분기 신설
- [Deep Research Phase C](2026-04-23-plan-deep-research-phase-c-design.md) — SSE infra (`apps/api/src/lib/temporal-research.ts`, `text/event-stream`) 답습 대상
- `docs/architecture/api-contract.md` — 본 PR 에서 `?view=` 파라미터 + `POST /api/visualize` 추가
- `docs/architecture/billing-routing.md` — Vis Agent 의 LLM 라우팅 (BYOK→크레딧→Admin) 따름

---

## 0. 요약 한 단락

Phase 1 은 `mode='graph'` 탭 + Cytoscape force-directed 단일 뷰 + wiki-link Backlinks 만 깔았다. Phase 2 는 같은 탭 안에 **인-탭 ViewSwitcher** 를 더해 **5뷰** (graph / mindmap / cards / timeline / board) 를 호스팅한다. 4뷰 데이터 fetch 는 기존 `/api/projects/:id/graph` 의 `?view=&root=` 파라미터 확장으로 결정적·즉시 처리 (LLM 비용 0). 추가로 신규 `POST /api/visualize` SSE 라우트 + **VisualizationAgent** (Sub-A `run_with_tools` 위, 3-tool inventory) 가 자연어 입력("트랜스포머 주제로 mindmap")을 ViewSpec 으로 변환해 풍부한 NL 경로를 제공한다. Cytoscape 는 graph/mindmap/board 에만, cards/timeline 은 pure React. DB 변경 0, board 위치 영속화 / 클러스터링 (Louvain) / 이해도 색상 (Plan 6 SM-2 의존) / 크로스-프로젝트 / KG 편집은 모두 Phase 3 으로 이연. 5뷰의 `canvas` 명칭은 Plan 7 Canvas (Pyodide 코드 실행) 와 충돌해 본 Phase 시작 시 `board` 로 재명명 확정.

---

## 1. Goal & Scope

### 1.1 In-scope

1. `apps/web/src/components/graph/` 에 **`ViewSwitcher`** + **`ViewRenderer`** 추가. URL `?view=mindmap|cards|timeline|board` 로 인-탭 라우팅. tabs-store TabMode 변경 0 (`'graph'` 단일 유지)
2. **5뷰 컴포넌트** (각 단일 책임, 단일 file):
   - `views/GraphView.tsx` — Phase 1 cytoscape fcose 추출 (회귀 0)
   - `views/MindmapView.tsx` — `cytoscape-dagre`, root concept BFS 트리, 자녀 클릭 시 root 변경
   - `views/BoardView.tsx` — cytoscape preset, 인-세션 드래그 (위치 영속화는 Phase 3)
   - `views/CardsView.tsx` — pure React + Tailwind grid, ConceptCard
   - `views/TimelineView.tsx` — custom SVG/CSS, 좌→우 시간축 (concepts.created_at 기본, ViewSpec.eventYear 우선)
3. **`/api/projects/:id/graph` 확장** — 기존 zod schema 에 `view` enum + `root` uuid 추가. view 별 정렬·필터 핸들러 분기. 응답 shape 호환 유지 (`rootId` + `viewType` echo 필드만 추가)
4. **`POST /api/visualize` 신규 SSE 라우트** — `text/event-stream`, 4 이벤트 (`tool_use` / `tool_result` / `view_spec` / `error`), 종결 시 `event: done`. Deep Research SSE infra 패턴 답습
5. **`VisualizationAgent`** (`apps/worker/src/worker/agents/visualization/`) — Sub-A `run_with_tools` 첫 외부 소비자. **기존 `emit_structured_output` + 신규 ViewSpec Pydantic 모델 등록 패턴**으로 ViewSpec 종결 (ToolLoopExecutor 가 `emit_structured_output` 만 hardcoded 로 종결 인식 — 신규 terminal tool 추가 불필요)
6. **신규 빌트인 툴 1개 + 스키마 1개** (`apps/worker/src/worker/tools_builtin/`):
   - `get_concept_graph` — N-hop 서브그래프 fetch, `AgentApiClient.expand_concept_graph` 호출
   - `view_spec_schema.py` — `ViewSpec` Pydantic 모델 + `register_schema("ViewSpec", ViewSpec)`. 기존 `schema_registry.py` 패턴 답습
7. **Temporal `build_view` activity** — workflow 없이 activity 직접 호출 (`apps/worker/src/worker/activities/visualize_activity.py`). `apps/worker/src/worker/main.py` 에 등록
8. **신규 internal 라우트 `/api/internal/projects/:id/graph/expand`** — worker 가 `get_concept_graph` 툴에서 호출. user-session `/graph/expand` 와 권한 모델 동일 + body 에 `workspaceId` 명시 (internal API workspace scope memo 준수)
9. **`packages/shared/src/api-types.ts`** — `ViewType`, `Layout`, `ViewNode`, `ViewEdge`, `ViewSpec` Zod 스키마
10. **`VisualizeDialog`** + **`useVisualizeMutation`** — NL 입력 모달 + SSE 클라이언트 훅, ViewSpec 종결 시 URL navigate + view-state store inject
11. **i18n** — `messages/{ko,en}/graph.json` 에 `views.*` (5뷰 라벨 + 빈 상태) + `ai.*` (dialog + progress) + `errors.*` 신규 키. ko/en parity
12. **회귀 가드** — `cytoscape-dagre@^2.5` floating 차단, `register_schema("ViewSpec", ...)` 회귀 차단, SSE event 토큰 회귀 차단 (`event: view_spec`)
13. **Vitest 단위/컴포넌트 + API + worker pytest + Playwright E2E 1 spec**

### 1.2 Out-of-scope (Phase 3+)

- **Board 위치 영속화** — `concept_positions` 테이블 또는 `notes.layout_json`. 권한 범위 (per-user vs per-project) 결정 필요. Phase 2 board 는 매번 fresh 결정적 초기 레이아웃 (Phase 1 graph 정책 답습)
- **클러스터링 오버레이 (Louvain)** — 서버 사전계산 (concepts 변경 시 background job) vs 클라 cytoscape-leiden 결정
- **이해도 점수 노드 색상** — Plan 6 SM-2 review 데이터 의존, Plan 6 미완 → 데이터 자체 없음
- **크로스-프로젝트 워크스페이스 KG** — 워크스페이스 단위 통합, 권한 필터 + 노드 폭발 별도 spec
- **KG 편집 UI** — concept rename / merge / split / 수동 edge 추가, Compiler 자동 추출과 정합성 정책
- **Inline graph Plate block** — Plan 10B 영역
- **Sub-B Agent Retrofit** — 본 Phase 의 VisualizationAgent 가 reference impl. Compiler/Research/Librarian 의 retrofit 은 별도 plan (Sub-B umbrella 항목)
- **Vis Agent 고도화** — `eventYear` 추출 정확도, multi-topic ViewSpec, 역질의 ("이 노트들로 mindmap"), thought signature
- **`?view=` 별 탭 즐겨찾기** — Phase 1 Cmd+D bookmark 기능 자체가 부재. 본 Phase 는 URL 만 공유
- **5뷰 데이터 동시 prefetch** — 토글 시점 fetch (`staleTime: 30s` 캐시로 충분)

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  App Shell  (Phase 1 머지 완료)                                       │
│   Sidebar          Tab Mode Router                  Agent Panel       │
│   ────────         ─────────────────                ───────────       │
│   ProjectGraphLink (mode='graph' tab push, ?view= 쿼리 보존)          │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
            ┌────────────────────────────────────────────┐
            │  ProjectGraphViewer  (Phase 1 어댑터, 변경) │
            │   ┌────────────────────────────────────┐   │
            │   │ <ViewSwitcher>                     │   │  ← MOD
            │   │  graph | mindmap | cards |         │   │
            │   │  timeline | board   [🤖 AI]        │   │
            │   └────────────────────────────────────┘   │
            │   ┌────────────────────────────────────┐   │
            │   │ <ViewRenderer>  ?view= 분기:       │   │  ← NEW
            │   │  - GraphView    (Phase 1 추출)     │   │
            │   │  - MindmapView  (cytoscape-dagre)  │   │
            │   │  - BoardView    (cytoscape preset) │   │
            │   │  - CardsView    (CSS grid React)   │   │
            │   │  - TimelineView (custom React)     │   │
            │   └────────────────────────────────────┘   │
            └────────────────────────────────────────────┘
                            │            │
                            │            └─── NL 입력 ──┐
                            │ 결정 fetch                │
                            ▼                           ▼
        GET /api/projects/:id/graph         POST /api/visualize  (SSE)
        ?view=<type>&root=<conceptId>       { projectId, prompt, viewType? }
            (MOD: ?view + ?root)                (NEW)
                            │                           │
                            │                           ▼
                            │              Temporal client → activity('build_view')
                            │                           │
                            │                           ▼
                            │       VisualizationAgent (apps/worker/.../agents/visualization/)
                            │       run_with_tools(provider, tools=[
                            │           search_concepts,        ← 기존 (재사용)
                            │           get_concept_graph,      ← 신규
                            │           emit_structured_output, ← 기존 (ViewSpec 스키마로)
                            │       ])
                            │                           │
                            ▼                           ▼
                  ┌──────────────────────────────────────────────┐
                  │ Postgres                                      │
                  │   concepts / concept_edges / concept_notes    │
                  │   (Compiler 가 채우는 기존 테이블, 변경 0)     │
                  └──────────────────────────────────────────────┘
```

### 2.1 컴포넌트 경계

1. **`ViewSwitcher`** — segmented control + AI 버튼. `useRouter`/`useSearchParams` 만 알고 데이터 모름. 클릭 → `router.replace('?view=...', { scroll: false })`. 다른 쿼리 (`root`, `relation`) 보존
2. **`ViewRenderer`** — `?view=` 읽고 view 컴포넌트 dynamic import + 마운트만. 데이터 fetch 안 함
3. **각 view 컴포넌트** — `useProjectGraph(projectId, { view, root })` 훅으로 자체 fetch. 다른 view 정보 모름. 단일 책임
4. **`VisualizeDialog`** — NL 입력 + `useVisualizeMutation` SSE 호출. ViewSpec 종결 시 `useViewSpecApply`:
   - URL navigate `?view=<viewType>&root=<rootId>` (브라우저 히스토리 +1)
   - View-state store 에 inline ViewSpec 캐시 (key = `<projectId>:<rootId>:<viewType>`)
   - ViewRenderer 내부의 view 가 query 응답 대신 inline ViewSpec 사용 (`useProjectGraph` 가 store 우선 확인)
5. **`VisualizationAgent`** — `run_with_tools` 만 호출. 자체 LLM 호출 X. ToolLoopExecutor 의 hardcoded `emit_structured_output` 종결 경로를 활용 (`tu.name == "emit_structured_output" and result.data["accepted"] is True` → `LoopResult.final_structured_output` 에 검증된 ViewSpec dict 저장 + `termination_reason="structured_submitted"`). LLM 은 `emit_structured_output(schema_name="ViewSpec", data={...})` 형태로 호출
6. **`get_concept_graph` 툴** — 함수 내부에서 `AgentApiClient()` 인스턴스화 (search_concepts 패턴 답습), `client.expand_concept_graph()` 호출 → 신규 internal route `/api/internal/projects/:id/graph/expand`. workspace_id/user_id 는 `ctx: ToolContext` 에서 추출해 메소드 인자로 전달

### 2.2 불변식

- `mode='graph'` 탭은 `?view=graph` 가 기본. 다른 view 는 명시적 사용자 액션 (ViewSwitcher 클릭 또는 VisualizeDialog 종결) 으로만 진입
- `view=mindmap|board` 는 `root` 가 필요 (없으면 서버가 max-degree concept 자동 선택, 응답 `rootId` 에 echo)
- ViewSpec.nodes 길이 ≤ 500 (서버 + ViewSpec Pydantic model_validator 이중 가드), edges ≤ 2000. view_type 별 더 엄격한 cap: mindmap/timeline 50, cards 80, board/graph 200
- VisualizationAgent loop: `LoopConfig(max_turns=6, max_tool_calls=10)` — terminal 은 hardcoded `emit_structured_output` 만 (Sub-A 메커니즘)
- SSE 응답은 항상 `event: done\ndata: {}\n\n` 으로 명시 종결 (브라우저 fetch reader 가 stream end 외에도 기댐)
- 동일 user 동시 활성 `/api/visualize` 1개 (Redis flag, 2분 TTL)
- Cytoscape extension floating 버전 금지: `cytoscape-dagre@^2.5` (회귀 가드)
- Vis Agent 의 SSE relay 는 Temporal activity heartbeat metadata 경로만 사용. 별도 message broker 없음 (Deep Research 패턴)
- Vis Agent 가 `emit_structured_output` 도달 전 종료 (max_turns/max_tool_calls/provider_error/loop_detected_hard 등) → activity 가 `VisualizationFailed` 발생 → SSE `error` 이벤트 + `done`. 클라이언트 toast + dialog 유지

### 2.3 의도적 단순화

- **5뷰 데이터 prefetch X** — 토글 시점 fetch + TanStack Query staleTime 30s. 첫 토글 ~200ms latency 수용
- **board 위치 영속화 X (Phase 3)** — 매 마운트마다 fresh preset. 사용자가 드래그한 위치는 탭 활성 동안만 유지 (Cytoscape 기본)
- **VisualizationAgent 단일 LLM 라운드** — multi-step planning X. 평균 1-3 tool call (search_concepts → get_concept_graph → emit_structured_output)
- **Vis Agent workflow 미사용** — short-running (≤60s) → activity 직접 호출. Compiler/Research 처럼 long-running workflow 불필요
- **timeline edges 미반영** — 시간 관계만 표시. 같은 timeline 안에서 노드 사이 의미 관계는 graph view 토글로 확인

---

## 3. ViewSpec 스키마 (`packages/shared/src/api-types.ts`)

기존 파일에 추가 (existing 타입과 충돌 0). worker / api / web 3-way 계약.

```ts
import { z } from "zod";

// ─── Plan 5 Phase 2: ViewSpec ──────────────────────────────────────────

export const ViewType = z.enum(["graph", "mindmap", "cards", "timeline", "board"]);
export type ViewType = z.infer<typeof ViewType>;

export const ViewLayout = z.enum(["fcose", "dagre", "preset", "cose-bilkent"]);
export type ViewLayout = z.infer<typeof ViewLayout>;

export const ViewNode = z.object({
  id: z.string().uuid(),                      // concept.id
  name: z.string().min(1),
  description: z.string().optional(),
  degree: z.number().int().min(0).optional(),
  noteCount: z.number().int().min(0).optional(),
  firstNoteId: z.string().uuid().nullable().optional(),  // Phase 1 호환 — 노드 더블클릭 점프
  // Timeline NL 경로 전용. 결정 timeline 은 concepts.created_at 사용 (필드 비포함).
  // Vis Agent 가 LLM 으로 추출 시 채움. 클라이언트는 필드 존재 시 우선.
  eventYear: z.number().int().min(-3000).max(3000).optional(),
  // Board 의 결정 초기 레이아웃 / Vis Agent 추천 위치 (옵셔널, 없으면 layout 알고리즘이 계산)
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type ViewNode = z.infer<typeof ViewNode>;

export const ViewEdge = z.object({
  id: z.string().uuid().optional(),           // 결정 경로에서 응답, NL 경로에서 생략 가능
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  relationType: z.string(),
  weight: z.number().min(0).max(1),
});
export type ViewEdge = z.infer<typeof ViewEdge>;

export const ViewSpec = z.object({
  viewType: ViewType,
  layout: ViewLayout,
  rootId: z.string().uuid().nullable(),       // mindmap/board 필수, 그 외 null
  nodes: z.array(ViewNode).max(500),
  edges: z.array(ViewEdge).max(2000),
  rationale: z.string().max(200).optional(),  // user-facing, ko 또는 en — Vis Agent NL 경로에서만
});
export type ViewSpec = z.infer<typeof ViewSpec>;

// /api/projects/:id/graph 응답 — ViewSpec 의 superset (truncated/totalConcepts 추가)
export const GraphViewResponse = ViewSpec.extend({
  truncated: z.boolean(),
  totalConcepts: z.number().int().min(0),
});
export type GraphViewResponse = z.infer<typeof GraphViewResponse>;
```

**불변식:**

- `ViewSpec.viewType ∈ ['mindmap', 'board']` ⟹ `rootId !== null`. ViewSpec Pydantic model_validator + apps/api 양쪽이 검증
- 모든 edge 의 sourceId/targetId 는 nodes 안에 존재 (dangling 0). ViewSpec Pydantic model_validator 검증
- Phase 1 의 `GraphResponse` (`nodes/edges/truncated/totalConcepts`) 는 `GraphViewResponse` 의 부분집합 — Phase 1 클라이언트 코드는 신규 필드 무시하고 그대로 동작 (호환성)

---

## 4. API 계약

### 4.1 GET `/api/projects/:id/graph` — `?view` 파라미터 확장

**기존 zod schema (apps/api/src/routes/graph.ts) 변경:**

```diff
 const graphQuerySchema = z.object({
   limit: z.coerce.number().int().min(50).max(500).default(500),
   order: z.enum(['degree', 'recent']).default('degree'),
   relation: z.string().optional(),
+  view: z.enum(['graph', 'mindmap', 'cards', 'timeline', 'board']).default('graph'),
+  root: z.string().uuid().optional(),
 });
```

**view 별 핸들러 분기 (단일 라우터 안 switch):**

| view | 정렬·필터 | root 처리 | 응답 노드 선택 로직 | edges? |
|---|---|---|---|---|
| `graph` | Phase 1 그대로 | 무시 | top-N by degree (또는 order=recent) | yes |
| `mindmap` | tree-friendly | required (없으면 max-degree concept 자동) | root 부터 BFS, depth ≤ 3, 한 부모 당 자녀 ≤ 8 (자녀 정렬: edge weight desc) | yes (BFS 트리만) |
| `board` | Phase 1 그대로 | optional (있으면 1-hop 이웃만) | root 있음: 1-hop 이웃 ≤ 200; 없음: top-N by degree ≤ 200 | yes |
| `cards` | recent + degree | 무시 | concepts.created_at desc, ≤ 80 | no (빈 배열) |
| `timeline` | created_at | 무시 | concepts.created_at asc, ≤ 50, eventYear 미설정 | no (빈 배열) |

**`mindmap` BFS 알고리즘:**

```sql
WITH RECURSIVE bfs AS (
  SELECT id, name, description, 0 AS depth, ARRAY[id] AS path
  FROM concepts WHERE id = $rootId AND project_id = $projectId
  UNION ALL
  SELECT c.id, c.name, c.description, b.depth + 1, b.path || c.id
  FROM bfs b
  JOIN concept_edges e ON e.source_id = b.id
  JOIN concepts c ON c.id = e.target_id AND c.project_id = $projectId
  WHERE b.depth < 3 AND NOT (c.id = ANY(b.path))
)
SELECT * FROM bfs ORDER BY depth, ...weight desc... LIMIT 50;
```

per-parent 자녀 캡 8 은 application 레이어에서 후처리 (sql GROUP BY + window 도 가능하지만 가독성 우선).

**응답:**

```ts
{
  viewType: 'graph' | 'mindmap' | 'cards' | 'timeline' | 'board',  // 요청 echo
  layout: 'fcose' | 'dagre' | 'preset',                            // 서버 추천
  rootId: string | null,                                            // mindmap/board 채워짐
  nodes: ViewNode[],
  edges: ViewEdge[],
  truncated: boolean,
  totalConcepts: number,
  rationale?: never,                                                // 결정 경로 미사용
}
```

**Edge cases:**

- `view=mindmap` + project 에 concepts 0 → `{ nodes: [], edges: [], rootId: null, truncated: false, totalConcepts: 0 }`
- `view=mindmap` + `root` 가 다른 project 소속 concept → 404 `{ error: 'not-found' }`
- `view=mindmap` + `root` 자체가 없는 uuid → 404
- `view=cards` 빈 → 동일하게 빈 배열
- `view=timeline` + project 에 concepts 1개 → 1개 노드 timeline (degenerate 정상)

### 4.2 POST `/api/visualize` — Vis Agent SSE 라우트 (신규)

**페이로드:**

```ts
const visualizeBodySchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(500),
  viewType: ViewType.optional(),  // 사용자가 강제하면 system prompt 에 hint
});
```

**Handler:**

1. `requireAuth`
2. `canRead(user.id, { type: 'project', id: projectId })` — 403 시 거부
3. Redis concurrency guard: `SET visualize:user:<id> 1 NX EX 120` 실패 → 429 `{ error: 'concurrent-visualize' }`
4. SSE 헤더 설정: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`
5. Temporal client → `apps/api/src/lib/temporal-visualize.ts` 의 `streamBuildView({ projectId, userId, workspaceId, prompt, viewType })`. 이 함수가 activity 시작 + heartbeat 메타데이터 → SSE 이벤트 변환을 ReadableStream 으로 반환
6. 종결: `event: done\ndata: {}\n\n` 후 unlock Redis flag

**SSE 이벤트 타입:**

```
event: tool_use
data: {"name":"search_concepts","input":{"query":"transformer","k":5},"callId":"call_001"}

event: tool_result
data: {"callId":"call_001","ok":true,"summary":"Found 3 concepts: Transformer, Self-Attention, BERT"}

event: view_spec
data: {"viewSpec":{"viewType":"mindmap","layout":"dagre","rootId":"...","nodes":[...],"edges":[...],"rationale":"트랜스포머를 중심으로 자기-주의·BERT 등 8개 관련 개념을 마인드맵으로 구성했습니다."}}

event: error
data: {"error":"agent_did_not_emit_view_spec","messageKey":"graph.errors.visualizeFailed"}

event: done
data: {}
```

`tool_result` 의 `summary` 는 LLM 원본이 아니라 사용자 노출용 진행 라벨. 풀 raw result 는 SSE 미노출 (개념 description 등 PII-인접 정보 보호 + 응답 가벼움).

**가드:**

- prompt 길이 500 chars (LLM 비용 + abuse)
- 동시성 1/user (위 Redis guard)
- activity start_to_close 60s (timeout 시 `error: timeout`)
- abort: 클라이언트 ReadableStream cancel → activity heartbeat cancel → loop 중단

### 4.3 POST `/api/internal/projects/:id/graph/expand` — 신규 internal 라우트

worker 의 `get_concept_graph` 툴이 호출. user-session `/graph/expand` 와 권한 모델 동일하지만 internal-only 표면. **POST** (GET 아님) — `AgentApiClient` 의 다른 `post_internal` 메소드와 일관성 + body 에 `workspaceId`/`userId` 명시 (internal API workspace scope memo 준수).

**zod:**

```ts
const internalExpandSchema = z.object({
  conceptId: z.string().uuid(),
  hops: z.coerce.number().int().min(1).max(3).default(1),
  workspaceId: z.string().uuid(),  // internal API workspace scope memo 강제
  userId: z.string().uuid(),       // canRead 대체 — worker 가 user context 운반
});
```

**Handler:**

1. `requireInternalAuth` (HMAC token, 기존 internal middleware)
2. `canRead(userId, { type: 'project', id: projectId })` 호출 + `projects.workspaceId === workspaceId` 대조 (internal API workspace scope memo 준수, 누수 차단)
3. 재귀 CTE 로 hops-까지 도달 가능 concept ids 수집 (Phase 1 `/graph/expand` 와 동일 SQL)
4. 응답 shape:

```ts
{
  nodes: Array<{ id, name, description, degree, noteCount, firstNoteId }>,
  edges: Array<{ id, sourceId, targetId, relationType, weight }>,
}
```

**Edge cases:**

- conceptId 가 다른 project / workspace → 404
- hops > 3 → 400 (zod 가 차단)
- 권한 누수 시도 (다른 workspaceId 헤더) → 403

### 4.4 i18n 에러 메시지

API 는 코드만 반환 (`{ error: '<code>', messageKey: 'graph.errors.<key>' }`). 클라이언트가 `messageKey` 로 lookup.

| API code | messageKey |
|---|---|
| `forbidden` | `graph.errors.forbidden` |
| `not-found` | `graph.errors.notFound` |
| `concurrent-visualize` | `graph.errors.concurrentVisualize` |
| `prompt-too-long` | `graph.errors.promptTooLong` |
| `agent_did_not_emit_view_spec` | `graph.errors.visualizeFailed` |
| `timeout` | `graph.errors.visualizeTimeout` |
| `missing-root` | `graph.errors.missingRoot` |
| `view-spec-invalid` | `graph.errors.visualizeFailed` |

### 4.5 internal API workspace scope memo

`/api/visualize` 는 user-session (canRead chain). `/api/internal/projects/:id/graph/expand` 는 internal route 이며 body 에 `workspaceId` 명시 + `projects.workspaceId` 대조. memo `feedback_internal_api_workspace_scope` 원칙 준수.

---

## 5. VisualizationAgent (Python)

### 5.1 파일 구조

```
apps/worker/src/worker/agents/visualization/
├── __init__.py
├── agent.py        # VisualizationAgent (run_with_tools 호출)
├── prompts.py      # VISUALIZATION_SYSTEM
└── __tests__ ... (pytest 는 apps/worker/tests/ 측)

apps/worker/src/worker/tools_builtin/
├── view_spec_schema.py    # 신규 (ViewSpec Pydantic + register_schema)
├── get_concept_graph.py   # 신규
└── __init__.py            # MOD: get_concept_graph export, BUILTIN_TOOLS 에 추가, view_spec_schema import (등록 부수효과)

apps/worker/src/worker/activities/
└── visualize_activity.py  # 신규

apps/worker/src/worker/lib/
└── api_client.py          # MOD: expand_concept_graph 메소드 추가

apps/worker/src/worker/main.py    # MOD: build_view activity 등록 (알파벳 정렬 위치)
```

### 5.2 `agent.py`

```python
"""VisualizationAgent — first NEW agent on the Sub-A run_with_tools loop.

Unlike Compiler/Research/Librarian (still on the v1 runtime.Agent base
class pending the Sub-B retrofit), this agent is built directly on the
Sub-A `run_with_tools` API. Stateless: each invocation is a single tool
loop that terminates when the LLM calls
`emit_structured_output(schema_name="ViewSpec", data=...)` and the
schema validates.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, ClassVar

from llm import LLMProvider
from runtime.loop_runner import run_with_tools
from runtime.tool_loop import LoopConfig, LoopResult

from worker.agents.visualization.prompts import VISUALIZATION_SYSTEM
# Importing registers ViewSpec in SCHEMA_REGISTRY as a side-effect.
import worker.tools_builtin.view_spec_schema  # noqa: F401
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
    view_hint: str | None  # 'graph' | 'mindmap' | 'cards' | 'timeline' | 'board'


@dataclass(frozen=True)
class VisualizationOutput:
    view_spec: dict[str, Any]    # ViewSpec dict (validated, JSON-serializable)
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

    def __init__(self, *, provider: LLMProvider) -> None:
        self.provider = provider

    async def run(self, *, request: VisualizeRequest) -> VisualizationOutput:
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
        )
        if (
            result.termination_reason != "structured_submitted"
            or result.final_structured_output is None
        ):
            raise VisualizationFailed(
                f"agent_did_not_emit_view_spec (reason={result.termination_reason})"
            )
        return VisualizationOutput(
            view_spec=result.final_structured_output,
            tool_calls=result.tool_call_count,
            turn_count=result.turn_count,
        )

    def _build_user_prompt(self, req: VisualizeRequest) -> str:
        hint = f"\n\nUser-preferred view: {req.view_hint}." if req.view_hint else ""
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

### 5.3 `prompts.py` 골자

```python
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
    "rootId":   "<uuid>" | null,    # required for mindmap/board
    "nodes":    [{"id": "<uuid>", "name": str, "description": str?,
                  "eventYear": int?, "position": {"x": num, "y": num}?}],
    "edges":    [{"sourceId": "<uuid>", "targetId": "<uuid>",
                  "relationType": str, "weight": float}],
    "rationale": str?    # ≤200 chars, user-facing
  }

Rules:
  - Always call search_concepts FIRST when the user mentions a topic.
  - Pick viewType:
      * mindmap  → hierarchical "explain this topic" requests
      * timeline → time-ordered "history of X" requests (use eventYear)
      * cards    → "summarize key concepts" / overview
      * board    → spatial "lay these out" requests (rare in NL)
      * graph    → fallback / "show connections"
  - Pick layout matching viewType:
      * graph → fcose, mindmap → dagre, board → preset,
        cards/timeline → preset
  - rootId is REQUIRED for mindmap/board, NULL for cards/timeline/graph.
  - Node caps: mindmap/timeline 50, cards 80, board/graph 200, hard 500.
  - Edge cap: 2000. Every edge.sourceId/targetId MUST refer to a node in
    the same ViewSpec (no dangling).
  - rationale: user-facing reason in user's language (ko or en), ≤200 chars.
  - If the topic returns 0 concepts, emit ViewSpec with empty nodes and
    a rationale explaining the topic is not in the project.
  - If you receive `User-preferred view: <type>` in the user prompt, use
    that viewType unless it is wholly incompatible (e.g. timeline for a
    project with 0 dates).

Do NOT call read_note or other tools. Your job is structural, not textual.
"""
```

### 5.4 `tools_builtin/get_concept_graph.py`

```python
"""get_concept_graph — N-hop subgraph fetch tool.

Wraps AgentApiClient.expand_concept_graph against the new internal route
/api/internal/projects/:id/graph/expand. Used by VisualizationAgent and
reusable by other agents.

Signature mirrors `search_concepts.py`: client is instantiated inside
the tool (env-driven), workspace_id/user_id come from `ctx: ToolContext`.
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

### 5.5 `tools_builtin/view_spec_schema.py` (Pydantic + register)

기존 `schema_registry.py` 의 `ConceptSummary`/`ResearchAnswer` 패턴을 답습. ToolLoopExecutor 가 `emit_structured_output` 에서 이 스키마를 lookup → 검증 → `accepted=True` 면 loop 종결.

```python
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
    eventYear: int | None = Field(default=None, ge=-3000, le=3000)
    position: dict | None = None  # {"x": float, "y": float}, validated leniently


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
            raise ValueError(
                f"rootId is required for viewType={self.viewType}"
            )
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

**종결 메커니즘 (재확인)**: ToolLoopExecutor (`apps/worker/src/runtime/tool_loop.py`) 가 매 tool_use 후:

```python
if (
    tu.name == "emit_structured_output"
    and isinstance(result.data, dict)
    and result.data.get("accepted") is True
):
    state.final_structured_output = result.data.get("validated")
    return self._finalize(state, "structured_submitted")
```

`emit_structured_output` (`tools_builtin/emit_structured_output.py`) 는 SCHEMA_REGISTRY 에서 `schema_name="ViewSpec"` lookup → `model.model_validate(data)` → 성공 시 `{"accepted": True, "validated": validated.model_dump()}` 반환. 검증 실패 시 `{"accepted": False, "errors": [...]}` — LLM 이 다음 turn 에서 errors 보고 재시도.

### 5.6 `lib/api_client.py` — `expand_concept_graph` 추가

```python
async def expand_concept_graph(
    self,
    *,
    project_id: str,
    workspace_id: str,
    user_id: str,
    concept_id: str,
    hops: int = 1,
) -> dict:
    """POST /api/internal/projects/:id/graph/expand.

    Carries workspace_id + user_id in the body so the API can enforce
    the canRead chain + projects.workspaceId match (internal API
    workspace scope memo).

    POST (not GET) to keep the body shape simple — keeps internal
    secret pattern the same as `post_internal` helper which all other
    AgentApiClient methods use.
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

### 5.7 `activities/visualize_activity.py`

```python
"""build_view activity — Vis Agent Temporal entrypoint."""
from __future__ import annotations

import uuid

from temporalio import activity

from llm.factory import get_provider
from worker.agents.visualization.agent import (
    VisualizationAgent, VisualizationFailed, VisualizeRequest,
)


@activity.defn(name="build_view")
async def build_view(req: dict) -> dict:
    """Run VisualizationAgent and return validated ViewSpec dict.

    Uses Sub-A LoopHooks (passed via run_with_tools) to surface
    tool_use / tool_result events as Temporal heartbeat metadata so
    the SSE relay (apps/api) can stream progress to the browser.

    Heartbeat metadata shape:
        {"event": "tool_use" | "tool_result", "payload": {...}}
    """
    request = VisualizeRequest(
        project_id=req["projectId"],
        workspace_id=req["workspaceId"],
        user_id=req["userId"],
        run_id=str(uuid.uuid4()),
        prompt=req["prompt"],
        view_hint=req.get("viewType"),
    )
    provider = get_provider()  # env-driven (LLM_PROVIDER), see Plan 13
    agent = VisualizationAgent(provider=provider)
    # Heartbeat hook injection (sketch — see plan task for full impl):
    #   hooks = HeartbeatLoopHooks(activity_info=activity.info())
    #   pass hooks to agent.run via an optional kwarg, OR wire via
    #   run_with_tools(..., hooks=hooks) in agent.run.
    output = await agent.run(request=request)
    return output.view_spec
```

**구현 노트:**
- Plan task 에서 `HeartbeatLoopHooks` 작성 (Sub-A `LoopHooks` Protocol 구현). `on_tool_start` / `on_tool_end` 에서 `activity.heartbeat(metadata=...)` 호출
- agent.run 시그니처 확장: `async def run(self, *, request, hooks: LoopHooks | None = None)`. `run_with_tools` 의 `hooks` 인자로 전달
- `VisualizationFailed` → `activity.ApplicationError(non_retryable=True)` 변환 → 워크플로우 client 가 SSE error 이벤트로 변환

### 5.8 `main.py` 등록

```diff
 from worker.activities import (
     compiler_activity,
+    visualize_activity,
     research_activity,
     ...
 )
 ...
 activities=[
+    visualize_activity.build_view,
     compiler_activity.run_compiler,
     research_activity.run_research,
     ...
 ]
```

알파벳 정렬: `build_view` 가 `code_run` (Plan 7 Phase 2) 보다 앞. 머지 충돌 가능성은 같은 list 인 경우만, 다른 라인 → 손쉬운 머지.

---

## 6. Web 컴포넌트

### 6.1 파일 구조 (요약 — §1.1 의 in-scope 와 일치)

```
apps/web/src/components/graph/
├── ProjectGraph.tsx                 # MOD: ViewSwitcher + ViewRenderer 래퍼
├── ViewSwitcher.tsx                 # NEW
├── ViewRenderer.tsx                 # NEW
├── views/
│   ├── GraphView.tsx                # NEW (Phase 1 추출 — cytoscape fcose)
│   ├── MindmapView.tsx              # NEW
│   ├── BoardView.tsx                # NEW
│   ├── CardsView.tsx                # NEW
│   └── TimelineView.tsx             # NEW
├── ai/
│   ├── VisualizeDialog.tsx          # NEW
│   ├── VisualizeStream.tsx          # NEW
│   └── useVisualizeMutation.ts      # NEW
├── useProjectGraph.ts               # MOD: ?view + ?root 지원, store inline 우선
├── useViewSpecApply.ts              # NEW
├── view-state-store.ts              # NEW (zustand, inline ViewSpec 캐시)
└── view-types.ts                    # MOD: ViewType/Layout/ViewNode/ViewEdge/ViewSpec re-export
```

### 6.2 ViewSwitcher

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ViewType } from "@opencairn/shared";

const VIEW_KEYS: ViewType[] = ["graph", "mindmap", "cards", "timeline", "board"];

export function ViewSwitcher({ onAiClick }: { onAiClick: () => void }) {
  const t = useTranslations("graph.views");
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
    <div className="flex items-center justify-between border-b px-3 py-2">
      <ToggleGroup
        type="single"
        value={current}
        onValueChange={(v) => v && setView(v as ViewType)}
        aria-label={t("switcherAria")}
      >
        {VIEW_KEYS.map((v) => (
          <ToggleGroupItem key={v} value={v}>
            {t(v)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <button onClick={onAiClick} className="...accent text-sm">
        🤖 {useTranslations("graph.ai")("trigger")}
      </button>
    </div>
  );
}
```

키보드: `1`~`5` 단축키로 뷰 전환 (탭 활성 + Plate 비활성 시만, App Shell §3.4 단축키 정책 따름). 등록 위치: `ProjectGraphViewer` 의 `useEffect` (mode='graph' 탭 활성 시점).

### 6.3 ViewRenderer

```tsx
"use client";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { ViewType } from "@opencairn/shared";

const GraphView = dynamic(() => import("./views/GraphView"), { ssr: false });
const MindmapView = dynamic(() => import("./views/MindmapView"), { ssr: false });
const BoardView = dynamic(() => import("./views/BoardView"), { ssr: false });
const CardsView = dynamic(() => import("./views/CardsView"));    // SSR 가능
const TimelineView = dynamic(() => import("./views/TimelineView")); // SSR 가능

export function ViewRenderer({ projectId }: { projectId: string }) {
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

### 6.4 MindmapView (cytoscape-dagre)

```tsx
"use client";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { useMemo } from "react";
import { useProjectGraph } from "../useProjectGraph";
import { useTranslations } from "next-intl";

cytoscape.use(dagre);

export default function MindmapView({ projectId, root }: { projectId: string; root?: string }) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, { view: "mindmap", root });
  const elements = useMemo(() => toCytoscapeElements(data), [data]);

  if (isLoading) return <GraphSkeleton />;
  if (error) return <GraphError error={error} />;
  if (!data || data.nodes.length === 0) {
    return <div className="...">{t("views.needsRoot")}</div>;
  }

  return (
    <CytoscapeComponent
      elements={elements}
      layout={{ name: "dagre", rankDir: "LR", spacingFactor: 1.2, fit: true, padding: 30 }}
      stylesheet={MINDMAP_STYLESHEET /* root 강조 + edge 화살표 */}
      cy={(cy) => bindMindmapInteractions(cy, { onChildClick: setRoot, onChildDoubleClick: jumpToNote })}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
```

자녀 클릭 → `router.replace('?view=mindmap&root=<childId>')` → useProjectGraph 재fetch.
자녀 더블클릭 → preview tab (Phase 1 동작 재사용).

### 6.5 BoardView (cytoscape preset)

```tsx
const layout = {
  name: "preset",
  positions: (node) => node.data("position") ?? autoConcentric(node),  // ViewSpec 가 position 주면 사용, 아니면 concentric
  fit: true,
  padding: 30,
};
```

- 노드 grabbable: true (Cytoscape 기본)
- 위치 영속화 X — 탭 닫으면 초기화
- root 있음: 1-hop 이웃만 (서버 분기); root 없음: top-N

### 6.6 CardsView (pure React)

```tsx
"use client";
import { useProjectGraph } from "../useProjectGraph";
import { ConceptCard } from "./ConceptCard";
import { useTranslations } from "next-intl";

export default function CardsView({ projectId }: { projectId: string }) {
  const t = useTranslations("graph");
  const { data, isLoading, error } = useProjectGraph(projectId, { view: "cards" });

  if (isLoading) return <CardsSkeleton />;
  if (error) return <GraphError error={error} />;
  if (!data || data.nodes.length === 0) return <EmptyState text={t("views.noConcepts")} />;

  return (
    <div className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-3 xl:grid-cols-4">
      {data.nodes.map((n) => <ConceptCard key={n.id} node={n} />)}
    </div>
  );
}
```

`<ConceptCard>`: title + description (line-clamp-3) + degree badge + 클릭 시 첫 source 노트 preview tab.

### 6.7 TimelineView (custom React)

```tsx
"use client";
import { useProjectGraph } from "../useProjectGraph";
import { useMemo } from "react";

export default function TimelineView({ projectId }: { projectId: string }) {
  const { data } = useProjectGraph(projectId, { view: "timeline" });
  const positioned = useMemo(() => layoutTimeline(data?.nodes ?? []), [data]);

  return (
    <div className="relative h-full overflow-x-auto">
      <svg className="absolute inset-0" width={positioned.width} height="100%">
        <line className="stroke-muted-foreground" /* time axis */ />
        {positioned.ticks.map((t) => <TimelineTick key={t.x} {...t} />)}
        {positioned.nodes.map((n) => <TimelineNode key={n.id} {...n} />)}
      </svg>
    </div>
  );
}
```

`layoutTimeline` (utility): 노드의 `eventYear` 또는 `createdAt` 으로 x좌표 사전계산. ticks 는 연도 단위 (eventYear 우선) 또는 quarter 단위 (createdAt). 200줄 이내 자체 구현, vis-timeline 미도입.

### 6.8 VisualizeDialog + useVisualizeMutation

```tsx
// useVisualizeMutation.ts
export function useVisualizeMutation() {
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [viewSpec, setViewSpec] = useState<ViewSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function submit(input: { projectId: string; prompt: string; viewType?: ViewType }) {
    abort.current = new AbortController();
    const resp = await fetch("/api/visualize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: abort.current.signal,
    });
    if (!resp.body) throw new Error("no_stream");
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // parse SSE events from buf — split by '\n\n', extract event:/data:
      // dispatch to setProgress / setViewSpec / setError
    }
  }

  function cancel() { abort.current?.abort(); }

  return { submit, cancel, progress, viewSpec, error };
}
```

```tsx
// VisualizeDialog.tsx
export function VisualizeDialog({ open, onClose, projectId }) {
  const t = useTranslations("graph.ai");
  const apply = useViewSpecApply();
  const { submit, cancel, progress, viewSpec, error } = useVisualizeMutation();
  const [prompt, setPrompt] = useState("");
  const [viewType, setViewType] = useState<ViewType | undefined>(undefined);

  useEffect(() => {
    if (viewSpec) {
      apply(viewSpec, projectId);
      onClose();
    }
  }, [viewSpec]);

  function onSubmit() { submit({ projectId, prompt, viewType }); }
  function onCancel() { cancel(); onClose(); }

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent>
        <DialogTitle>{t("dialogTitle")}</DialogTitle>
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t("promptPlaceholder")} maxLength={500} />
        <ViewTypePicker value={viewType} onChange={setViewType} />
        <Button onClick={onSubmit} disabled={!prompt.length}>{t("submit")}</Button>
        {progress.length > 0 && <ProgressList events={progress} />}
        {error && <Toast variant="destructive">{t(`errors.${error}`)}</Toast>}
      </DialogContent>
    </Dialog>
  );
}
```

### 6.9 useViewSpecApply

```ts
export function useViewSpecApply() {
  const router = useRouter();
  const params = useSearchParams();
  const setInline = useViewStateStore((s) => s.setInline);

  return useCallback((spec: ViewSpec, projectId: string) => {
    setInline(projectId, spec);  // store key = projectId:viewType:rootId
    const next = new URLSearchParams(params.toString());
    next.set("view", spec.viewType);
    if (spec.rootId) next.set("root", spec.rootId); else next.delete("root");
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [router, params, setInline]);
}
```

`useProjectGraph` 가 store 우선 확인 → inline ViewSpec 있으면 fetch skip, 없으면 GET 호출. inline 캐시 staleTime 60s (NL 응답은 fresh 가치 큼, 자동 만료).

### 6.10 i18n 키 (`messages/{ko,en}/graph.json`)

```jsonc
{
  "viewer": { /* Phase 1 */ },
  "filters": { /* Phase 1 */ },
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
    "loadFailed": "그래프를 불러오지 못했습니다.",
    "tooManyHops": "이웃 펼치기 단계는 최대 3까지 가능합니다.",
    "forbidden": "이 프로젝트에 접근 권한이 없습니다.",
    "notFound": "찾을 수 없는 개념입니다.",
    "visualizeFailed": "AI 뷰 생성에 실패했습니다.",
    "visualizeTimeout": "AI 뷰 생성 시간이 초과되었습니다. 다시 시도해주세요.",
    "concurrentVisualize": "이미 진행 중인 AI 뷰 생성이 있습니다.",
    "promptTooLong": "요청은 500자 이내로 작성해주세요.",
    "missingRoot": "이 뷰는 중심 개념이 필요합니다."
  }
}
```

en 파일 동일 구조, 자연스러운 영어 표현 (예: "AI로 만들기" → "Generate with AI"). Plan 9a `i18n:parity` CI 자동 검증.

---

## 7. 충돌 회피 (병렬 세션)

| 영역 | 본 세션 변경 | App Shell Phase 5 (palette) | Plan 7 Canvas Phase 2 (Code Agent) | Plan 2C/2D | Deep Research Phase E | 완화 |
|---|---|---|---|---|---|---|
| `tabs-store.ts` TabMode | 변경 0 (graph 그대로) | 변경 가능성 낮음 | 변경 0 (canvas 그대로) | 변경 가능성 낮음 | 변경 0 | 충돌 0 |
| `messages/*/graph.json` | views/ai 키 추가 | 무관 | 무관 | 무관 | 무관 | 신규 키 영역 → 자동 머지 |
| `apps/worker/src/worker/main.py` | build_view activity 등록 | 무관 | code_run activity 등록 | 무관 | 무관 | 같은 함수 list — 알파벳 정렬 위치 다름 (`build_view` 앞, `code_run` 뒤) → 자동 머지 |
| `packages/shared/src/api-types.ts` | ViewSpec 추가 | 무관 | code-run 타입 추가 | 무관 | byok 타입 변경 | 다른 export 블록 → 자동 머지 |
| `apps/api/src/routes/graph.ts` | view 파라미터 분기 | 무관 | 무관 | 무관 | 무관 | 단독 |
| `apps/api/src/routes/visualize.ts` | 신규 파일 | 무관 | 무관 | 무관 | 무관 | 단독 |
| Migration 번호 | 0 (DB 변경 없음) | 0 | 가능 (code 1개) | 가능 (notifications) | 0 | 충돌 0 |
| `apps/web/src/components/graph/` | 5뷰 + ai/ + switcher | 무관 | 무관 | 무관 | 무관 | 단독 |
| `apps/api/src/routes/internal.ts` (또는 internal mount) | `/projects/:id/graph/expand` 추가 | 무관 | 다른 internal 경로 | 다른 internal 경로 | 무관 | 다른 라우트 → 자동 머지 |

**격리 방법:** git worktree (`.worktrees/plan-5-kg-phase-2`) 에서 작업, main 변화에 자동 따라가지 않으므로 PR 시점에 rebase. Phase 1 의 `.worktrees/plan-5-kg-impl` 와 동일 패턴.

---

## 8. 테스트

### 8.1 Vitest 단위/컴포넌트 (`apps/web`)

| 파일 | 검증 |
|---|---|
| `views/MindmapView.test.tsx` | root 미지정 → `views.needsRoot` 빈 상태, root 있음 → cytoscape elements 변환 + dagre layout 호출, 자녀 클릭 → router.replace `?root=` |
| `views/BoardView.test.tsx` | preset layout 호출, 노드 grabbable, 빈 상태, root=1-hop 모드 |
| `views/CardsView.test.tsx` | total=0 빈 상태, total>0 grid 렌더, 카드 클릭 → addOrReplacePreview |
| `views/TimelineView.test.tsx` | x좌표 단조증가, eventYear 우선, hover tooltip, click → preview tab |
| `views/GraphView.test.tsx` | Phase 1 회귀 0 (새 위치에서) |
| `ViewSwitcher.test.tsx` | 각 버튼 클릭 → router.replace 호출 (다른 쿼리 보존), `1`~`5` 단축키, AI 버튼 → onAiClick |
| `ViewRenderer.test.tsx` | `?view=mindmap` → MindmapView 마운트, 알 수 없는 view → graph fallback |
| `ai/VisualizeDialog.test.tsx` | submit → useVisualizeMutation 호출, SSE 이벤트별 progress 라벨 렌더, view_spec 수신 → onApply 호출 + close |
| `ai/useVisualizeMutation.test.ts` | EventSource/ReadableStream mock — tool_use/tool_result/view_spec 시퀀스, error 이벤트 → setError, abort → cancel |
| `useViewSpecApply.test.ts` | URL navigate (`?view`+`?root`), view-state store inject, useProjectGraph store 우선 사용 |
| `useProjectGraph.test.ts` | (MOD) `?view`/`?root` fetch URL 반영, 캐시 키 분리, store inline 우선 |

### 8.2 API (`apps/api`)

| 파일 | 검증 |
|---|---|
| `routes/graph-views.test.ts` | view=mindmap+root 정상, view=mindmap+root 미지정 → max-degree 자동 선택 (rootId echo), view=mindmap+root 다른 project → 404, view=cards 정렬, view=timeline edges 비어있음, view=board+root 1-hop, Phase 1 view=graph 회귀 0 |
| `routes/visualize.test.ts` | 페이로드 검증, 비-멤버 → 403, prompt > 500 → 400, 동시 visualize → 429, SSE 4 이벤트 정상 시퀀스, abort → 200 + done, activity timeout → error 이벤트 |
| `lib/temporal-visualize.test.ts` | streamBuildView heartbeat → SSE event 변환, error path |
| `routes/internal-graph-expand.test.ts` | workspaceId mismatch → 403, conceptId 다른 project → 404, hops > 3 → 400, 정상 경로 응답 shape |

### 8.3 Worker (pytest)

| 파일 | 검증 |
|---|---|
| `agents/visualization/test_agent.py` | run_with_tools 호출 인자 (system/user, tools=3=[search_concepts, get_concept_graph, emit_structured_output], LoopConfig max_turns=6, max_tool_calls=10), termination_reason="structured_submitted" + final_structured_output → VisualizationOutput, 다른 termination_reason → VisualizationFailed (메시지에 reason 포함) |
| `agents/visualization/test_prompts.py` | system prompt 가 5뷰 매핑 + layout 매핑 + node cap 명시, view_hint 처리 룰, emit_structured_output(schema_name="ViewSpec") 호출 안내 |
| `tools_builtin/test_get_concept_graph.py` | hops=0/4 → error, ctx.workspace_id/user_id/project_id → AgentApiClient.expand_concept_graph 인자 매핑, AgentApiClient 인스턴스화 검증 (mock) |
| `tools_builtin/test_view_spec_schema.py` | viewType/layout Literal enum, mindmap+rootId=None → ValidationError ("rootId is required"), dangling edge → ValidationError, nodes>cap (per viewType) → ValidationError, rationale > 200 → ValidationError, valid → model_dump 정상, register_schema 가 SCHEMA_REGISTRY 에 ViewSpec 등록 (import 부수효과) |
| `activities/test_visualize_activity.py` | activity heartbeat per tool_use/tool_result (LoopHooks 검증), ViewSpec 반환, VisualizationFailed → ApplicationError 변환 |
| `lib/test_api_client.py` | (MOD) expand_concept_graph 의 post_internal 호출 path/body 검증 (POST /api/internal/projects/:id/graph/expand, body={conceptId, hops, workspaceId, userId}) |

### 8.4 Playwright E2E (`apps/web/tests/e2e/graph-views.spec.ts`)

단일 spec, fixture seed 활용:

1. `/w/<slug>/p/<id>/graph` 진입 → graph view 마운트 (Phase 1 회귀)
2. `[그래프]→[카드]` 클릭 → URL `?view=cards`, ConceptCard 렌더
3. `[마인드맵]` 클릭 → root 미지정 빈 상태 (`views.needsRoot`)
4. `[그래프]` 에서 노드 클릭 → root 지정 후 `[마인드맵]` → 트리 렌더
5. AI 버튼 → dialog → prompt 입력 → submit → SSE progress 라벨 순차 표시 → ViewSpec 수신 → URL navigate → 새 뷰 마운트 (mock provider 가 deterministic ViewSpec 반환)
6. `?view=cards` 직접 URL 접근 → cards view 자동 마운트

Vis Agent 의 worker 측은 mock provider (deterministic ViewSpec 반환) 로 E2E. Real Gemini 호출은 unit test 만 (cost + flake).

### 8.5 i18n parity

- `pnpm --filter @opencairn/web i18n:parity` 가 graph.json ko/en 자동 검증
- 신규 키 ~25개 (views.* 7 + ai.* 9 + errors.* 5 + 기존)

### 8.6 회귀 가드 (`.github/workflows/ci.yml` lint 스텝 추가)

```bash
# Phase 1 가드 유지 (cytoscape, cytoscape-fcose) + Phase 2 추가:

# cytoscape-dagre floating 차단
! grep -RE "cytoscape-dagre:?\\s*\\^?(latest|\\*)" \
  apps/web/package.json apps/web/src/

# ViewSpec 스키마가 SCHEMA_REGISTRY 에 등록되어 있는지 (Sub-A 종결 메커니즘 의존)
grep -q 'register_schema("ViewSpec"' apps/worker/src/worker/tools_builtin/view_spec_schema.py

# SSE event 토큰 회귀 차단 (클라이언트 파서가 의존)
grep -q "event: view_spec" apps/api/src/routes/visualize.ts
grep -q "event: tool_use" apps/api/src/routes/visualize.ts
grep -q "event: done" apps/api/src/routes/visualize.ts

# ViewSpec 스키마 5뷰 enum 회귀 차단
grep -q "graph.*mindmap.*cards.*timeline.*board" packages/shared/src/api-types.ts
```

---

## 9. Verification (PR 머지 전 통과 기준)

- [ ] `pnpm --filter @opencairn/db test` (변경 0, 회귀 0 확인)
- [ ] `pnpm --filter @opencairn/api test` (graph-views + visualize + internal-graph-expand + temporal-visualize 신규, Phase 1 회귀 0)
- [ ] `pnpm --filter @opencairn/web test` (5 view + dialog + switcher + 훅, Phase 1 회귀 0)
- [ ] `pnpm --filter @opencairn/web i18n:parity`
- [ ] `pnpm --filter @opencairn/web build` (5뷰 dynamic import + cytoscape-dagre SSR 우회)
- [ ] `cd apps/worker && uv run pytest agents/visualization tools_builtin/test_view_spec_schema tools_builtin/test_get_concept_graph activities/test_visualize_activity lib/test_api_client` 신규 통과
- [ ] `cd apps/worker && uv run pytest` 전체 회귀 0
- [ ] `pnpm --filter @opencairn/web playwright test graph-views.spec.ts`
- [ ] CI grep 가드 0 hit (cytoscape-dagre floating, register_schema("ViewSpec"...), SSE event 토큰, ViewSpec enum)
- [ ] 수동: 5뷰 모두 토글 → 즉시 (≤500ms) 렌더, AI 입력 → SSE 진행상태 → 새 뷰 마운트 (≤15s)
- [ ] 수동: 동시 AI 입력 2번 → 두 번째 429 토스트
- [ ] 수동: AI 입력 중 dialog 닫기 → SSE abort → activity heartbeat cancel 정상

---

## 10. Open Questions / Decisions

이 spec 은 다음을 **확정** 한다:

1. ✅ **Vis Agent 는 Sub-A `run_with_tools` 위에 신규 구축** — Sub-B retrofit 의존 분리, 본 Phase 가 reference impl 역할
2. ✅ **단일 `mode='graph'` 탭 + 인-탭 ViewSwitcher** — tabs-store 변경 0, URL `?view=` 쿼리
3. ✅ **5뷰의 `canvas` → `board` 재명명** — Plan 7 Canvas (Pyodide 코드) 와 충돌 회피
4. ✅ **결정 경로 (`?view=` 확장) + Vis Agent NL 경로 (`POST /api/visualize` SSE) 분리**
5. ✅ **Cytoscape (graph/mindmap/board) + React-native (cards/timeline) 스택** — cytoscape-dagre 1개 deps 추가
6. ✅ **3-tool inventory** — search_concepts (재사용) / get_concept_graph (신규) / emit_structured_output (재사용 + 신규 ViewSpec Pydantic 스키마 SCHEMA_REGISTRY 등록). ToolLoopExecutor 의 hardcoded `emit_structured_output` 종결 경로 활용 — 신규 terminal tool 미도입
7. ✅ **ViewSpec Zod 스키마** — `packages/shared/src/api-types.ts` 추가, ko/en parity 의존
8. ✅ **Timeline 결정 경로 = concepts.created_at, NL 경로 = ViewSpec.eventYear inline** — DB 변경 0
9. ✅ **board 위치 영속화 X (Phase 3)** — 매 마운트 fresh, 인-세션 드래그만
10. ✅ **클러스터링 / SM-2 색상 / 크로스-프로젝트 / KG 편집 / inline graph block 모두 Phase 3+**
11. ✅ **DB 변경 0** — 기존 `concepts` / `concept_edges` / `concept_notes` 만 사용
12. ✅ **internal route `/api/internal/projects/:id/graph/expand` 신규** — worker 의 `get_concept_graph` 가 호출, internal API workspace scope memo 준수

다음 Phase 에서 다룰 질문:

- Board 위치 영속화 — `concept_positions` 테이블 (per-user) vs `notes.layout_json` (per-project)? 권한 범위 결정 필요
- 클러스터링 (Louvain) — 서버 사전계산 (concepts 변경 시 background job) vs 클라 cytoscape-leiden? 트레이드오프 결정
- 이해도 점수 노드 색상 — Plan 6 SM-2 review 데이터 머지 후 색상 매핑 정책
- KG 편집 UI — concept rename / merge / split / 수동 edge 추가 — Compiler 자동 추출과 정합성 정책
- 크로스-프로젝트 워크스페이스 KG — 권한 필터 + 노드 폭발 방지 정책
- Vis Agent 고도화 — eventYear 추출 정확도, multi-topic ViewSpec, 역질의 ("이 노트들로 mindmap"), thought signature 관리
- Sub-B Agent Retrofit — Compiler/Research/Librarian 을 본 Phase Vis Agent 패턴으로 마이그 (별도 plan)

---

## 11. Phase 3 인계 (다음 세션)

- **Board 위치 영속화** + **클러스터링 오버레이** + **SM-2 노드 색상** — 셋 다 Phase 3 후보. 우선순위 재논의 (사용자 가치 vs 구현 폭)
- **KG 편집 UI** — concept rename / merge / split / 수동 edge 추가
- **크로스-프로젝트 워크스페이스 KG** — 권한 필터 정책 별도 spec
- **Vis Agent 고도화** — eventYear extractor (LLM tool 신규), multi-topic ("transformer + RNN 비교 mindmap"), 노트-기반 ("선택한 노트들로 timeline")
- **Sub-B Agent Retrofit** — 별도 plan, Compiler/Research/Librarian 마이그
- **Inline graph Plate block** — Plan 10B 영역, 노트에 인용 그래프 임베드

---

## 12. 변경 이력

- 2026-04-26: 최초 작성. Phase 1 (`mode='graph'` Cytoscape 단일 + Backlinks + wiki_links) 위에 4뷰 추가 + Vis Agent (NL 전용, Sub-A `run_with_tools`) + ViewSpec Zod 스키마 + SSE `POST /api/visualize` + 결정 GET `?view=` 확장. Sub-B retrofit 의존 분리 (Vis Agent 가 reference impl). 5뷰의 `canvas` → `board` 재명명 (Plan 7 충돌 회피). 클러스터/SM-2/cross-project/edit/inline 모두 Phase 3 이연.
