# Plan 8: Remaining Agents — Implementation Plan (Python + Temporal)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-04-14 재작성:** 본 plan은 원래 TypeScript + BullMQ + Supabase Storage 전제로 작성됐으나 Plan 4 결정 및 이번 세션 결정에 따라 전면 교체되었다.
> - **위치**: `apps/api/src/routes/agents/*.ts`의 가벼운 Hono 트리거 + `apps/worker/src/worker/agents/<name>/*.py`의 Python LangGraph 구현 (실제 로직)
> - **실행**: BullMQ → Temporal Python SDK activity
> - **스토리지**: Supabase Storage → Cloudflare R2 (`apps/worker/src/worker/lib/r2_client.py`)
> - **LLM 호출**: `@google/genai` (TS) → `packages/llm` `get_provider()` (Python, Gemini/Ollama — OpenAI는 2026-04-15 제거)
> - **검색**: pgvector 직접 호출 → LightRAG hybrid search (`mode="hybrid|local|global"`)
> - **Narrator TTS**: `provider.tts()` (Gemini 전용; Ollama는 graceful degrade로 스크립트만 반환)
> - **Deep Research**: Gemini Deep Research API (provider-specific); 비-Gemini는 Search Grounding + Research Agent fallback
> - **Visualization Agent**는 Plan 5(Task M1)에서 다루고, 본 plan에서는 6개 에이전트만 구현: Connector / Temporal / Synthesis / Curator / Narrator / Deep Research

**Goal:** Plan 4(Compiler/Librarian/Research) 코어 에이전트 이후 남은 6개 에이전트를 Python LangGraph + Temporal workflow로 구현한다.

**Architecture:** 각 에이전트는 `apps/worker/src/worker/agents/<name>/*.py`에 LangGraph StateGraph로 구현. Temporal workflow는 `apps/worker/src/worker/workflows/agent_workflows.py`에 정의. API 라우트(Hono)는 `apps/api/src/routes/agents/*.ts`에서 Temporal client로 workflow를 트리거. 결과는 worker 콜백으로 Hono `/internal/*`에 전달 → DB 업데이트 → Hocuspocus broadcast → 프론트엔드 실시간 반영. LLM 호출은 전부 `packages/llm` `get_provider()`로 추상화. 검색은 LightRAG hybrid API. 오디오는 `provider.tts()` → R2 업로드 → DB에 signed URL 저장.

**Tech Stack:** Python 3.12, LangGraph 0.3, Pydantic AI, Temporal Python SDK 1.7+, `packages/llm`, LightRAG, asyncpg, boto3 (R2), Hono 4 (API 라우트 트리거만)

---

## File Structure

```
apps/worker/src/worker/agents/
  connector/
    __init__.py
    state.py
    nodes/
      fetch_concept.py
      find_cross_project_similar.py
      filter_existing_edges.py
      persist_suggestions.py
    graph.py
  temporal_agent/          # 'temporal'은 temporalio 패키지와 충돌 방지로 이름 변경
    __init__.py
    state.py
    nodes/
      build_timeline.py
      detect_stale.py
      schedule_reviews.py
    graph.py
  synthesis/
    __init__.py
    state.py
    nodes/
      gather_contexts.py
      generate_essay.py
      persist_note.py
    graph.py
  curator/
    __init__.py
    state.py
    nodes/
      detect_orphans.py
      detect_duplicates.py
      detect_contradictions.py
      suggest_external_sources.py
    graph.py
  narrator/
    __init__.py
    state.py
    nodes/
      generate_script.py
      synthesize_speech.py
      upload_audio.py
    graph.py
  deep_research/
    __init__.py
    state.py
    nodes/
      launch_research.py
      poll_result.py
      convert_to_wiki.py
    graph.py

apps/worker/src/worker/workflows/
  agent_workflows.py        # 각 에이전트별 @workflow.defn

apps/api/src/routes/agents/
  connector.ts              # POST /api/agents/connector/run, GET /api/agents/connector/suggestions
  temporal.ts               # POST /api/agents/temporal/timeline, POST /api/agents/temporal/stale-check
  synthesis.ts              # POST /api/agents/synthesis/run, GET :id
  curator.ts                # POST /api/agents/curator/run, GET /suggestions
  narrator.ts               # POST /api/agents/narrator/run, GET :id
  deep-research.ts          # POST /api/agents/deep-research/run, GET :id

packages/db/src/schema/
  suggestions.ts            # { id, type, project_id, user_id, payload (jsonb), status, created_at }
  stale_alerts.ts           # { id, note_id, staleness_score, detected_at, reviewed_at }
  audio_files.ts            # { id, note_id, r2_key, duration_sec, voices, created_at }
  deep_research_jobs.ts     # { id, user_id, prompt, status, gemini_op_id, result_note_id, ... }

packages/shared/src/api-types.ts
  # Zod 스키마: ConnectorSuggest, SynthesisRun, NarratorRun, DeepResearchRun 등
```

---

### Task 1: Shared DB Schema

**Files:**
- Create: `packages/db/src/schema/suggestions.ts`
- Create: `packages/db/src/schema/stale_alerts.ts`
- Create: `packages/db/src/schema/audio_files.ts`
- Create: `packages/db/src/schema/deep_research_jobs.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1.1: `suggestions.ts`**

```ts
// packages/db/src/schema/suggestions.ts
import { pgTable, uuid, text, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users, projects } from "./index";

export const suggestionType = pgEnum("suggestion_type", [
  "connector_link",
  "curator_orphan",
  "curator_duplicate",
  "curator_contradiction",
  "curator_external_source",
  "synthesis_insight",
]);

export const suggestionStatus = pgEnum("suggestion_status", [
  "pending", "accepted", "rejected", "expired",
]);

export const suggestions = pgTable("suggestions", {
  id:         uuid("id").defaultRandom().primaryKey(),
  userId:     text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId:  uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  type:       suggestionType("type").notNull(),
  payload:    jsonb("payload").notNull(),       // 구체 구조는 type 별 Zod 스키마로 검증
  status:     suggestionStatus("status").notNull().default("pending"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
```

- [ ] **Step 1.2: `stale_alerts.ts`**

```ts
// packages/db/src/schema/stale_alerts.ts
import { pgTable, uuid, real, timestamp, text } from "drizzle-orm/pg-core";
import { notes } from "./index";

export const staleAlerts = pgTable("stale_alerts", {
  id:              uuid("id").defaultRandom().primaryKey(),
  noteId:          uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  stalenessScore:  real("staleness_score").notNull(),   // 0-1
  reason:          text("reason").notNull(),            // "90d no update" | "contradicts recent source"
  detectedAt:      timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt:      timestamp("reviewed_at", { withTimezone: true }),
});
```

- [ ] **Step 1.3: `audio_files.ts`**

```ts
// packages/db/src/schema/audio_files.ts
import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { notes } from "./index";

export const audioFiles = pgTable("audio_files", {
  id:          uuid("id").defaultRandom().primaryKey(),
  noteId:      uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
  r2Key:       text("r2_key").notNull(),
  durationSec: integer("duration_sec"),
  voices:      jsonb("voices"),                 // [{name, style}]
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 1.4: `deep_research_jobs.ts`**

```ts
// packages/db/src/schema/deep_research_jobs.ts
import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users, notes } from "./index";

export const deepResearchStatus = pgEnum("dr_status", [
  "queued", "running", "succeeded", "failed", "canceled",
]);

export const deepResearchJobs = pgTable("deep_research_jobs", {
  id:           uuid("id").defaultRandom().primaryKey(),
  userId:       text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  prompt:       text("prompt").notNull(),
  geminiOpId:   text("gemini_op_id"),
  status:       deepResearchStatus("status").notNull().default("queued"),
  resultNoteId: uuid("result_note_id").references(() => notes.id, { onDelete: "set null" }),
  error:        text("error"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:  timestamp("completed_at", { withTimezone: true }),
});
```

- [ ] **Step 1.5: index에 export 추가, 마이그레이션 생성, commit**

```bash
pnpm db:generate
git add packages/db/
git commit -m "feat(db): schema for agent suggestions, stale alerts, audio files, deep research jobs"
```

---

### Task 2: Connector Agent (cross-project link suggestions)

**Files:**
- Create: `apps/worker/src/worker/agents/connector/*.py`
- Create: `apps/api/src/routes/agents/connector.ts`

- [ ] **Step 2.1: `state.py`**

```python
# apps/worker/src/worker/agents/connector/state.py
from dataclasses import dataclass, field

@dataclass
class ConnectorState:
    user_id: str
    concept_id: str
    threshold: float = 0.75
    top_k: int = 10
    embedding: list[float] | None = None
    candidates: list[dict] = field(default_factory=list)  # {target_id, score, project_id}
    filtered: list[dict] = field(default_factory=list)
    suggestion_ids: list[str] = field(default_factory=list)
```

- [ ] **Step 2.2: 노드 3개 — fetch/find/filter/persist**

파일별 20~40줄. 요점:
- `fetch_concept.py`: asyncpg로 `SELECT embedding, project_id FROM concepts WHERE id=$1`
- `find_cross_project_similar.py`: LightRAG 또는 pgvector `ORDER BY embedding <=> $1 LIMIT 10`, **다른 project_id** 필터
- `filter_existing_edges.py`: `concept_edges`에 이미 있으면 제외, user_id mismatch(공유 안 한 프로젝트) 제외
- `persist_suggestions.py`: `suggestions` 테이블에 `type='connector_link'`로 insert

- [ ] **Step 2.3: LangGraph wiring**

```python
# apps/worker/src/worker/agents/connector/graph.py
from langgraph.graph import StateGraph, END
from .state import ConnectorState
from .nodes import fetch_concept, find_cross_project_similar, filter_existing_edges, persist_suggestions

def build_connector():
    g = StateGraph(ConnectorState)
    g.add_node("fetch", fetch_concept.run)
    g.add_node("search", find_cross_project_similar.run)
    g.add_node("filter", filter_existing_edges.run)
    g.add_node("persist", persist_suggestions.run)
    g.set_entry_point("fetch")
    g.add_edge("fetch", "search")
    g.add_edge("search", "filter")
    g.add_edge("filter", "persist")
    g.add_edge("persist", END)
    return g.compile()
```

- [ ] **Step 2.4: Temporal activity + workflow**

```python
# apps/worker/src/worker/workflows/agent_workflows.py (추가)
from temporalio import activity, workflow
from worker.agents.connector.graph import build_connector
from worker.agents.connector.state import ConnectorState

@activity.defn(name="run_connector_agent")
async def run_connector_activity(inp: dict) -> dict:
    graph = build_connector()
    state = ConnectorState(user_id=inp["user_id"], concept_id=inp["concept_id"])
    final = await graph.ainvoke(state)
    return {"suggestion_ids": final["suggestion_ids"]}

@workflow.defn(name="ConnectorWorkflow")
class ConnectorWorkflow:
    @workflow.run
    async def run(self, inp: dict) -> dict:
        from datetime import timedelta
        return await workflow.execute_activity(
            run_connector_activity,
            inp,
            schedule_to_close_timeout=timedelta(minutes=5),
        )
```

- [ ] **Step 2.5: Hono 트리거**

```ts
// apps/api/src/routes/agents/connector.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth";
import { getTemporalClient } from "../../lib/temporal-client";

export const connectorRouter = new Hono().use("*", authMiddleware);

const runSchema = z.object({ conceptId: z.string().uuid() });

connectorRouter.post("/run", zValidator("json", runSchema), async (c) => {
  const session = c.get("session");
  const { conceptId } = c.req.valid("json");
  const client = await getTemporalClient();
  const handle = await client.workflow.start("ConnectorWorkflow", {
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "default",
    workflowId: `connector-${crypto.randomUUID()}`,
    args: [{ user_id: session.userId, concept_id: conceptId }],
  });
  return c.json({ workflowId: handle.workflowId }, 202);
});

connectorRouter.get("/suggestions", async (c) => {
  const session = c.get("session");
  const db = c.get("db");
  const rows = await db.query.suggestions.findMany({
    where: (s, { eq, and }) => and(eq(s.userId, session.userId), eq(s.type, "connector_link"), eq(s.status, "pending")),
    orderBy: (s, { desc }) => desc(s.createdAt),
    limit: 50,
  });
  return c.json(rows);
});
```

- [ ] **Step 2.6: Temporal schedule — 주 1회**

```python
# apps/worker/src/worker/main.py 또는 별도 scripts/create_schedules.py
# Temporal Schedule API로 크론 등록 (일요일 04:00 UTC)
```

- [ ] **Step 2.7: Commit**

```bash
git add apps/worker/src/worker/agents/connector/ \
        apps/worker/src/worker/workflows/agent_workflows.py \
        apps/api/src/routes/agents/connector.ts
git commit -m "feat(agents): Connector Agent (Python LangGraph + Temporal) with cross-project similarity suggestions"
```

---

### Task 3: Temporal Agent (stale detection + reviews)

> 주의: Python 패키지 `temporalio` 와 충돌 방지를 위해 폴더명은 `temporal_agent/` 사용.

**Files:**
- Create: `apps/worker/src/worker/agents/temporal_agent/*.py`
- Create: `apps/api/src/routes/agents/temporal.ts`

- [ ] **Step 3.1: Stale Detection 노드**

```python
# apps/worker/src/worker/agents/temporal_agent/nodes/detect_stale.py
from datetime import datetime, timedelta, timezone
from llm import get_provider

STALE_DAYS = 90

async def run(state):
    # 1. SELECT notes WHERE updated_at < now() - 90 days AND type='wiki'
    # 2. 각 노트 본문을 Gemini에게 "최신 정보와 비교해 여전히 유효한가?" 질문
    # 3. staleness_score 계산 (0-1), stale_alerts에 upsert
    ...
```

- [ ] **Step 3.2: Timeline Build 노드**

Plan 5 KG-07 Visualization Agent와 중첩되지 않게. Temporal Agent는 **날짜 기반 추출**만, 렌더링 파라미터는 Visualization Agent가 담당.

- [ ] **Step 3.3: Review Scheduling 노드**

SM-2 복습 간격 계산 후 `POST /internal/socratic/queue-review`로 Socratic Agent 트리거.

- [ ] **Step 3.4: Temporal workflow + API + cron (일 1회)**

- [ ] **Step 3.5: Commit**

```bash
git commit -m "feat(agents): Temporal Agent (stale detection + review scheduling)"
```

---

### Task 4: Synthesis Agent (essay generation)

**Files:**
- Create: `apps/worker/src/worker/agents/synthesis/*.py`
- Create: `apps/api/src/routes/agents/synthesis.ts`

- [ ] **Step 4.1: `state.py` — concept_ids, style, draft, final_note_id**

- [ ] **Step 4.2: 노드**
  1. `gather_contexts.py` — 각 concept의 wiki 본문 로드 + LightRAG `mode='global'` 추가 컨텍스트
  2. `generate_essay.py` — `provider.generate()` 긴 컨텍스트 (Gemini면 `cache_context()`로 90% 비용 절감)
  3. `persist_note.py` — 새 note 생성 (type='wiki', is_auto=true), wiki_logs 기록

- [ ] **Step 4.3: Temporal workflow + API + 폴링 엔드포인트**

- [ ] **Step 4.4: Commit**

```bash
git commit -m "feat(agents): Synthesis Agent (multi-concept essay generation with LightRAG context)"
```

---

### Task 5: Curator Agent (orphan / duplicate / contradiction detection)

**Files:**
- Create: `apps/worker/src/worker/agents/curator/*.py`
- Create: `apps/api/src/routes/agents/curator.ts`

- [ ] **Step 5.1: `detect_orphans.py` — degree 0 concepts 찾기**
- [ ] **Step 5.2: `detect_duplicates.py` — 임베딩 유사도 > 0.9인 concept 쌍**
- [ ] **Step 5.3: `detect_contradictions.py` — `provider.generate()`로 두 위키 본문 모순 검사**
- [ ] **Step 5.4: `suggest_external_sources.py` — `provider.ground_search()` (Gemini) 또는 fallback**
- [ ] **Step 5.5: 결과를 `suggestions`에 저장, Temporal cron (일 1회)**
- [ ] **Step 5.6: Commit**

```bash
git commit -m "feat(agents): Curator Agent (orphan/duplicate/contradiction detection + search grounding)"
```

---

### Task 6: Narrator Agent (podcast TTS)

**Files:**
- Create: `apps/worker/src/worker/agents/narrator/*.py`
- Create: `apps/api/src/routes/agents/narrator.ts`

- [ ] **Step 6.1: `generate_script.py`**

```python
# 2인 대화 스크립트 (Host / Guest) 생성
SCRIPT_PROMPT = """Generate a natural podcast dialogue between Host and Guest
based on the following wiki content. Length: ~10 minutes (~1500 words).
Return JSON: [{ "speaker": "host" | "guest", "text": "..." }, ...]
Content:
{content}
"""
```

- [ ] **Step 6.2: `synthesize_speech.py`**

```python
# provider.tts(script, voices=['Kore', 'Puck']) — Gemini 전용
# Ollama: None 반환 → graceful degrade (스크립트만 반환, audio 없음)
audio = await provider.tts(script_text, model='gemini-2.5-pro-preview-tts')
if audio is None:
    return {"audio_r2_key": None, "script": script}
```

- [ ] **Step 6.3: `upload_audio.py` — R2에 MP3 업로드, `audio_files` insert, signed URL 발급**

- [ ] **Step 6.4: Temporal workflow (max 10분), API 라우트 + 폴링**

- [ ] **Step 6.5: Commit**

```bash
git commit -m "feat(agents): Narrator Agent (2-speaker podcast TTS with R2 upload + graceful fallback)"
```

---

### Task 7: Deep Research Agent

**Files:**
- Create: `apps/worker/src/worker/agents/deep_research/*.py`
- Create: `apps/api/src/routes/agents/deep-research.ts`

- [ ] **Step 7.1: `launch_research.py`**

```python
# Gemini Deep Research API 호출 (background=True)
# 응답의 operation_id를 deep_research_jobs에 저장
# Non-Gemini provider: fallback = provider.ground_search() + Research Agent 반복
if isinstance(provider, GeminiProvider) and os.getenv("GEMINI_DEEP_RESEARCH_ENABLED") == "true":
    op = provider.deep_research_start(prompt)
    return {"gemini_op_id": op.name}
else:
    # Fallback: 2-3회 ground_search + Research RAG 반복
    return {"fallback": True}
```

- [ ] **Step 7.2: `poll_result.py` — Temporal sleep + poll (최대 2시간)**

```python
from datetime import timedelta
# Temporal workflow에서 workflow.sleep(60) 반복 → provider에서 status 확인
```

- [ ] **Step 7.3: `convert_to_wiki.py` — 결과 마크다운을 새 note로, Compiler Agent에게 인덱싱 위임**

- [ ] **Step 7.4: Temporal workflow (2시간 타임아웃), API**

- [ ] **Step 7.5: Commit**

```bash
git commit -m "feat(agents): Deep Research Agent (Gemini Deep Research API with fallback + long workflow)"
```

---

## Env Vars

```bash
# 공용 (Plan 3/4에서 정의)
LLM_PROVIDER=gemini|ollama
LLM_API_KEY=
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_TASK_QUEUE=default
S3_ENDPOINT= S3_ACCESS_KEY= S3_SECRET_KEY= S3_BUCKET=

# Plan 8 전용
GEMINI_DEEP_RESEARCH_ENABLED=true   # false면 fallback 사용
NARRATOR_MAX_DURATION_SEC=900       # 15분 상한
CURATOR_CRON="0 3 * * *"            # 매일 03:00 UTC
CONNECTOR_CRON="0 4 * * 0"          # 일요일 04:00 UTC
STALE_DAYS=90                       # Temporal Agent 기준일
```

---

## 구현 우선순위

Plan 4 → Plan 5 → Plan 6 → **Plan 8 순서 권장**:

1. **Synthesis** (가장 단순, 즉시 가치)
2. **Curator** (주기 실행, 품질 유지)
3. **Connector** (UX 개선)
4. **Temporal Agent** (학습 시스템과 연동, Plan 6 이후)
5. **Narrator** (TTS 의존성, Gemini 특화)
6. **Deep Research** (가장 복잡, Gemini Deep Research API 의존 + fallback 복잡)

## Verification

- [ ] 6개 에이전트 각각 Temporal workflow가 한 번 성공 실행
- [ ] `suggestions` 테이블에 각 타입별 샘플 row 생성
- [ ] Ollama provider로 실행 시 Narrator는 오디오 없이 스크립트만 반환 (graceful degrade 확인)
- [ ] Deep Research fallback 경로 (GEMINI_DEEP_RESEARCH_ENABLED=false)에서도 결과 note 생성
- [ ] Curator가 pgvector 유사도 > 0.9 duplicate 쌍을 정확히 검출
- [ ] Temporal Agent가 90일 미수정 wiki에 stale_alerts row 생성
- [ ] Narrator 오디오가 R2에 업로드되고 signed URL로 재생 가능
- [ ] Connector 주간 cron이 Temporal Schedule에 등록되어 동작

---

## Summary

| Task | Agent | Key Deliverable |
|------|-------|----------------|
| 1 | (shared) | suggestions / stale_alerts / audio_files / deep_research_jobs 스키마 |
| 2 | Connector | cross-project similarity → suggestions, 주 1회 cron |
| 3 | Temporal | stale 감지 + timeline + review scheduling, 일 1회 cron |
| 4 | Synthesis | multi-concept essay 생성 with LightRAG global context |
| 5 | Curator | orphan/duplicate/contradiction + Gemini Search Grounding |
| 6 | Narrator | 2-speaker podcast TTS + R2 upload (Gemini 전용 + graceful degrade) |
| 7 | Deep Research | Gemini Deep Research API + fallback, 2시간 workflow |
