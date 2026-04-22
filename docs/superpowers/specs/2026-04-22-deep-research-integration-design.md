# Deep Research Integration — Collaborative Plan → Research → Report

**Status:** Draft (2026-04-22)
**Owner:** Sungbin
**Related:**

- [2026-04-20-agent-runtime-standard-design.md](./2026-04-20-agent-runtime-standard-design.md) — Plan 12 Agent Runtime (본 spec은 `runtime.Agent` 패턴을 쓰지 않음, 이유는 §2)
- [api-contract.md](../../architecture/api-contract.md) — Zod + requireAuth + workspace scope
- [data-flow.md](../../architecture/data-flow.md) — 기존 ingest→wiki→Q&A 플로우
- [collaboration-model.md](../../architecture/collaboration-model.md) — 페이지 권한 · workspace 3계층
- [llm-antipatterns.md](../../contributing/llm-antipatterns.md) — Gemini 호출 함정 (§8 Plate 포함)
- 외부 레퍼런스: [Deep Research preview](https://ai.google.dev/gemini-api/docs/deep-research), [Deep Research Max model page](https://ai.google.dev/gemini-api/docs/models/deep-research-max-preview-04-2026)
- Follow-up: **Spec B — AI Usage Visibility** (별도 spec, 본 spec 직후 작성). 모든 AI 호출 사용량/비용 집계 + 사용자/어드민 대시보드.

## Dependencies

- **Plan 1** — Better Auth, user/workspace 스키마, BYOK 키 저장 (AES-256)
- **Plan 12** — Temporal + worker 기반 (Deep Research는 `runtime.Agent`를 쓰지 않지만 Temporal 인프라 사용)
- **Plan 13** — `packages/llm` multi-LLM provider 패턴, `user_preferences.byokApiKey` 컬럼
- **Plan 2A** — Plate v49 에디터 + `notes` 엔티티(= UI에서 "page"라 부르는 편집 가능 단위) + `/app/w/[wsSlug]/p/[projectId]/notes/[noteId]` 라우트. 신규 `research-meta` 블록을 여기에 추가.
- **Feature flag** — 신규 `FEATURE_DEEP_RESEARCH` env (기본 off)

### 엔티티 명명 규칙

OpenCairn 내부에서 "page" / "note" / "편집 가능한 문서"는 모두 **DB 테이블 `notes`** 를 가리킨다. UI 카피에서만 "페이지"로 부르기도 한다. 본 spec의 "Page"로 표기된 부분은 전부 `notes` 테이블 행이다. FK · 내부 API 경로 · 코드 심볼은 모두 `note(s)` 로 통일한다.

---

## 1. Problem

OpenCairn 사용자는 **긴 호흡의 심층 조사**를 직접 에디터에서 수행할 때 다음 고통을 겪는다:

1. **수동 웹 리서치 + 정리 분리** — 브라우저에서 탭을 켜고 읽고, 손으로 요약하고, 다시 에디터로 옮기는 작업. 30분~몇 시간 소요.
2. **출처 추적 부실** — 복붙 과정에서 URL 소실 빈번. "이거 어디서 봤더라" 반복.
3. **차트/인포그래픽 생성 추가 비용** — 외부 툴로 별도 제작.

2026-04-21 Google이 발표한 **Deep Research preview / Deep Research Max preview** 모델(4월 버전)은 이 3가지를 한 API 호출로 해결한다:

- **Deep Research** (`deep-research-preview-04-2026`) — 속도/비용 최적, 태스크당 ~$1–3
- **Deep Research Max** (`deep-research-max-preview-04-2026`) — 최대 품질, 태스크당 ~$3–7, DeepSearchQA 93.3% / HLE 54.6%
- 양쪽 모두 Interactions API로 호출, collaborative planning + 인용 리포트 + 차트 이미지 네이티브 지원
- 최대 60분 장기 실행 (보통 ~20분)

**이 spec은 양 모델을 OpenCairn에 통합해, 사용자가 주제를 입력하면 → plan을 검토/편집하고 → 완성된 리서치 리포트가 자동으로 워크스페이스 Page로 저장되는 엔드-투-엔드 경험을 정의한다.**

## 2. Goals & Non-Goals

### Goals (MVP)

- Deep Research와 Deep Research Max **양쪽 모델** 노출 (사용자가 태스크별 선택)
- `/research` **전용 허브** 라우트 — 새 리서치 시작 + 진행 중/과거 리서치 리스트
- **Collaborative planning** — 3-way UX (채팅 반복 + 직접 편집 + Approve)
- 완료 시 **워크스페이스의 특정 프로젝트에 note 생성** — 본문 + 접이식 `research-meta` 블록 (plan · sources · thought summary). **타겟 프로젝트는 run 생성 시 사용자가 선택** (§11 Open Question #5 참고 — default 정책은 후속 결정).
- Deep Research 생성 이미지(차트/인포그래픽)는 MinIO 업로드 후 Page에 inline image 블록으로 렌더
- **BYOK only** — 사용자 Gemini 키로만 동작. 키 없으면 `/settings/ai` 링크로 ungating.
- **Temporal workflow**로 60분 장기 실행 + human-in-the-loop 조율
- per-run 추정 비용 DB 기록 (UI 집계는 Spec B에 위임)
- ko/en i18n parity (ko 먼저, en 런칭 직전 배치)

### Non-Goals (MVP 밖)

- **MCP 통합** — Deep Research가 워크스페이스 내부 노트를 읽게 하는 기능. self-host 환경에서 공개 MCP URL 필요 + 권한 격리 복잡도 큼. 향후 별도 spec.
- **File Search 통합** — Page 생성 시 PDF 첨부 → Deep Research가 읽기. MCP와 묶어서 후속.
- **실시간 협업 편집 (Yjs)** — 리포트 저장 후 일반 Page 편집은 기존 Plate Yjs로 자동 동작. Deep Research 실행 중의 협업은 범위 밖.
- **`runtime.Agent` 패턴으로 래핑** — Deep Research는 Google 쪽에서 이미 오케스트레이션이 끝난 완성형 에이전트. 우리가 또 `runtime.Agent`로 감싸면 내부 이벤트(ModelEnd/ToolUse)를 관찰할 수 없어 의미 없음. Temporal workflow + 얇은 provider 래퍼가 정답.
- **Ollama 대체** — Deep Research는 Gemini 전용. Ollama는 `NotImplementedError` 유지, UI 레벨에서 gating.
- **전체 AI 비용 대시보드** — Spec B로 분리.
- **Hard cost cap runtime 차단** — Google API가 cap 파라미터도 없고 실제 비용도 안 돌려주므로 불가능. opt-in 예산 경고조차 Spec B 범위.

---

## 3. Architecture

```
┌────────────────────┐     REST + SSE     ┌──────────────────────┐
│ apps/web /research │ ─────────────────▶ │ apps/api /research   │
│ - hub + list       │ ◀───────────────── │ - CRUD               │
│ - plan editor      │   plan events      │ - signal relay       │
│ - progress view    │   progress events  │ - SSE stream         │
└────────────────────┘                    └──────┬───────────────┘
                                                 │
                         start workflow / signal │
                                                 ▼
                                    ┌──────────────────────────┐
                                    │ apps/worker (Temporal)   │
                                    │ deep_research_workflow   │
                                    │ ├ create_plan            │
                                    │ ├ wait_signal(approve)   │
                                    │ ├ execute_research       │
                                    │ └ persist_report         │
                                    └──────┬───────────────────┘
                                           │  google-genai SDK
                                           ▼
                                    ┌──────────────────────────┐
                                    │ Google Interactions API  │
                                    │ deep-research(-max)      │
                                    └──────────────────────────┘

packages/llm (Python) — GeminiProvider 확장: start_interaction,
                         resume_interaction, stream_interaction,
                         get_interaction, cancel_interaction
                         (Ollama는 NotImplementedError)
packages/db — research_runs, research_run_turns, research_run_artifacts
MinIO — Deep Research 생성 이미지 + 원본 아티팩트 저장
```

### 경계 원칙

- `apps/api`는 **Google API 직접 호출 금지** — 모든 long-running 호출은 worker의 Temporal workflow에 위임
- `apps/worker`는 `packages/llm.get_provider()`로만 Gemini 접근 (OpenCairn rule)
- `packages/llm`은 새 "Interactions" 인터페이스를 `LLMProvider` base에 **옵셔널 메서드**로 추가. Ollama/base는 `NotImplementedError`
- `apps/web`은 `proxy.ts` 라우팅 + TanStack Query. **Server Actions 금지**, DB 직접 import 금지.

### 인증/키 플로우

- 사용자 BYOK Gemini 키는 이미 `user_preferences.byokApiKey`에 AES-256 저장 (Plan 13)
- 워커 activity가 **activity 내부에서** 키 복호화 → `GeminiProvider(config, api_key=…)` 인스턴스 per request
- **Temporal workflow state에 평문 키 저장 금지** — Temporal history는 영구 저장되므로 activity 경계 안에서만 해제
- 유효하지 않은 키 → `create_plan`에서 fail-fast, SSE `{type:"error", code:"invalid_byok_key"}` → Web에서 설정 페이지 링크

---

## 4. Components & Data Model

### 4.1 DB 스키마 (Drizzle, `packages/db/src/schema/research.ts`)

```typescript
// enums
export const researchModelEnum = pgEnum("research_model", [
  "deep-research-preview-04-2026",
  "deep-research-max-preview-04-2026",
]);
export const researchStatusEnum = pgEnum("research_status", [
  "planning",
  "awaiting_approval",
  "researching",
  "completed",
  "failed",
  "cancelled",
]);
export const researchTurnRoleEnum = pgEnum("research_turn_role", [
  "system", "user", "agent",
]);
export const researchTurnKindEnum = pgEnum("research_turn_kind", [
  "plan_proposal", "user_feedback", "user_edit", "approval",
]);
export const researchArtifactKindEnum = pgEnum("research_artifact_kind", [
  "thought_summary", "text_delta", "image", "citation",
]);

// main
export const researchRuns = pgTable("research_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),   // 결과 note가 들어갈 타겟 프로젝트
  userId: uuid("user_id").notNull().references(() => users.id),
  topic: text("topic").notNull(),
  model: researchModelEnum("model").notNull(),
  status: researchStatusEnum("status").notNull().default("planning"),
  currentInteractionId: text("current_interaction_id"),
  approvedPlanText: text("approved_plan_text"),
  workflowId: text("workflow_id").notNull(),   // Temporal signal 경로
  noteId: uuid("note_id").references(() => notes.id),   // 완료 시 생성된 note (nullable until completed)
  error: jsonb("error").$type<{ code: string; message: string; retryable: boolean }>(),
  totalCostUsdCents: integer("total_cost_usd_cents"),   // 추정 — Spec B에서 집계
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const researchRunTurns = pgTable("research_run_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => researchRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  role: researchTurnRoleEnum("role").notNull(),
  kind: researchTurnKindEnum("kind").notNull(),
  interactionId: text("interaction_id"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  runSeqIdx: uniqueIndex("research_run_turns_run_seq_idx").on(t.runId, t.seq),
}));

export const researchRunArtifacts = pgTable("research_run_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => researchRuns.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  kind: researchArtifactKindEnum("kind").notNull(),
  payload: jsonb("payload").notNull(),   // { text | image_url | source_url | title }
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  runSeqIdx: uniqueIndex("research_run_artifacts_run_seq_idx").on(t.runId, t.seq),
}));
```

### 4.2 서비스 컴포넌트 매트릭스

| Layer | 경로 | 역할 |
|---|---|---|
| DB | `packages/db/src/schema/research.ts` | 위 스키마 + zod 타입 export |
| LLM | `packages/llm/src/llm/interactions.py` | `InteractionHandle`, `InteractionState`, `InteractionEvent` dataclass |
| LLM | `packages/llm/src/llm/base.py` | `start_interaction` 등 base hook, 기본 `NotImplementedError` |
| LLM | `packages/llm/src/llm/gemini.py` | Interactions API 실제 구현 |
| Worker | `apps/worker/src/worker/workflows/deep_research_workflow.py` | 오케스트레이션 (signal, poll, retry) |
| Worker | `apps/worker/src/worker/activities/deep_research/create_plan.py` | `collaborative_planning=True` 첫 턴 |
| Worker | `apps/worker/src/worker/activities/deep_research/iterate_plan.py` | `previous_interaction_id` 체이닝 |
| Worker | `apps/worker/src/worker/activities/deep_research/execute_research.py` | `collaborative_planning=False` + 스트리밍 |
| Worker | `apps/worker/src/worker/activities/deep_research/persist_report.py` | 이미지 MinIO 업로드 + Page 생성 |
| API | `apps/api/src/routes/research.ts` | POST /runs, PATCH /runs/:id/plan, POST /runs/:id/turns, POST /runs/:id/approve, POST /runs/:id/cancel, GET /runs, GET /runs/:id, GET /runs/:id/stream (SSE). 마운트 경로 `/api/research` |
| API | `apps/api/src/routes/internal.ts` | 기존 internal router에 **신규** POST `/api/internal/notes` 추가 — worker가 service-token 으로 호출해 note 생성 |
| Web | `apps/web/src/app/[locale]/app/w/[wsSlug]/research/page.tsx` | 허브 (workspace-scoped 리스트 + new button) |
| Web | `apps/web/src/app/[locale]/app/w/[wsSlug]/research/[id]/page.tsx` | plan review · progress · 결과 |
| Web | `apps/web/src/components/editor/blocks/research-meta/` | Plate v49 custom element |
| i18n | `messages/ko/research.json` + `messages/en/research.json` | UI 문자열 |

### 4.3 신규 Plate 블록: `research-meta`

- 페이지 상단 고정, 기본 **접힌 상태**, 편집 불가(메타만). 블록 삭제는 가능.
- 내부 구조:
  ```typescript
  interface ResearchMetaElement {
    type: "research-meta";
    runId: string;
    model: "deep-research-preview-04-2026" | "deep-research-max-preview-04-2026";
    plan: string;                            // 최종 approved plan (markdown)
    sources: Array<{ title: string; url: string; seq: number }>;
    thoughtSummaries?: string[];             // 선택적 — 길면 생략
    costUsdCents?: number;                   // 추정치
    children: [{ text: "" }];                // Plate void 블록
  }
  ```
- Plate v49 custom void element. i18n 키로 라벨 (`research.meta.*`).
- 주의: llm-antipatterns §8 (Plate v49 함정)에 정의된 대로 `components` prop 등록 + `slashMenu` 등록 금지 (이건 자동 생성 전용).

### 4.4 Interactions API 래퍼 (packages/llm)

```python
# packages/llm/src/llm/interactions.py (신규)
from dataclasses import dataclass
from typing import Literal, Any

InteractionStatus = Literal[
    "queued", "running", "completed", "failed", "cancelled"
]

@dataclass
class InteractionHandle:
    id: str
    agent: str
    background: bool

@dataclass
class InteractionState:
    id: str
    status: InteractionStatus
    outputs: list[dict[str, Any]]   # [{type: "text"|"image", ...}]
    error: dict[str, Any] | None = None

@dataclass
class InteractionEvent:
    event_id: str
    kind: Literal["thought_summary", "text", "image", "status"]
    payload: dict[str, Any]
```

```python
# packages/llm/src/llm/base.py (기존 파일 확장)
from .interactions import InteractionHandle, InteractionState, InteractionEvent

class LLMProvider(ABC):
    # ... 기존 메서드들 ...

    async def start_interaction(
        self,
        *,
        input: str,
        agent: str,
        collaborative_planning: bool = False,
        background: bool = False,
        stream: bool = False,
        previous_interaction_id: str | None = None,
        thinking_summaries: str | None = None,
        visualization: bool = False,
    ) -> InteractionHandle:
        raise NotImplementedError

    async def get_interaction(self, interaction_id: str) -> InteractionState:
        raise NotImplementedError

    async def stream_interaction(
        self, interaction_id: str, *, last_event_id: str | None = None,
    ) -> AsyncGenerator[InteractionEvent, None]:
        raise NotImplementedError
        yield  # for type checker — unreachable

    async def cancel_interaction(self, interaction_id: str) -> None:
        raise NotImplementedError
```

`GeminiProvider`가 이 4개를 override 한다 — `google-genai` SDK의 `client.interactions.*`로 위임.

---

## 5. Data Flow

### 5.1 리서치 생성 (Planning 단계)

```
[Web] /app/w/[wsSlug]/research hub → "New research" 클릭
      → topic + model + target projectId 입력 → submit
[Web] POST /api/research/runs { workspaceId, projectId, topic, model }  (TanStack Query)
  ↓
[API] requireAuth → Zod 검증 → `canWrite(user, project)` 권한 체크
      → DB insert research_runs (status=planning, workflowId=runId)
      → Temporal.startWorkflow(deep_research_workflow, { runId },
                                workflowId=runId, idReusePolicy=AllowDuplicateFailedOnly)
      → 201 { runId }
  ↓
[Web] /app/w/[wsSlug]/research/[runId] 이동
      + SSE 스트림 구독 (GET /api/research/runs/:id/stream)
  ↓
[Workflow] create_plan_activity
  - DB에서 BYOK 키 복호화 (activity 안에서만)
  - provider.start_interaction(
        input=topic,
        agent=<model_id>,
        collaborative_planning=True,
        background=True,
    )
  - poll every 5s until status="completed"
  - DB update: currentInteractionId, status="awaiting_approval"
  - insert research_run_turns (seq=0, role=agent, kind=plan_proposal, content=plan_text)
  - SSE event: { type: "plan_ready", content: plan_text }
  ↓
[Web] plan을 마크다운 뷰어로 렌더, 3 버튼:
      [💬 수정 요청(채팅)]  [📝 직접 편집]  [✅ Approve]
```

### 5.2 Plan 편집 (3-way)

**채팅형 반복** (Google API 재호출):
```
[Web] POST /api/research/runs/:id/turns { feedback: "X 빼고 Y 추가" }
[API] DB insert turn (role=user, kind=user_feedback, content=feedback)
      → Temporal.signal(workflowId, "user_feedback", { text, turnId })
[Workflow] iterate_plan_activity
  - provider.start_interaction(
        input=feedback_text,
        agent=<same>,
        collaborative_planning=True,
        previous_interaction_id=currentInteractionId,
    )
  - poll → 새 plan 받기
  - DB update currentInteractionId, insert turn (seq++, kind=plan_proposal)
  - SSE: { type: "plan_updated", content }
[Workflow] 다시 signal 대기
```

**직접 편집** (Google API 미호출, 로컬 텍스트만):
```
[Web] PATCH /api/research/runs/:id/plan { edited_text }
[API] DB insert turn (role=user, kind=user_edit, content=edited_text)
      return 200
```

**Approve**:
```
[Web] POST /api/research/runs/:id/approve
[API] 최신 plan 결정: 최신 user_edit이 있으면 그것, 없으면 최신 plan_proposal
      → DB: approvedPlanText 저장, insert turn (kind=approval)
      → Temporal.signal(workflowId, "approve_plan", { approved_text })
```

### 5.3 Research 실행 (Executing 단계)

```
[Workflow] approve 시그널 수신 → execute_research_activity
  - provider.start_interaction(
        input=approved_text,
        agent=<same>,
        collaborative_planning=False,
        background=True,
        stream=True,
        previous_interaction_id=currentInteractionId,
        thinking_summaries="auto",
        visualization=True,
    )
  - DB update status="researching"
  - stream_interaction() 이벤트 루프:
        for ev in stream:
            insert research_run_artifacts (seq++, kind, payload)
            SSE: { type: "progress", kind, payload }
    연결 끊기면 get_interaction으로 last_event_id 복구 후 재연결
  - Temporal activity heartbeat 30s — 60분 전체 timeout
  ↓
[Workflow] status="completed" → persist_report_activity
  - 최종 report text + inline image refs 받기
  - 각 image: base64 디코드 → MinIO 업로드 (path: research/{workspace_id}/{run_id}/{image_id}.png)
  - citation 목록 추출 (Google outputs 구조에서)
  - POST /api/internal/notes (신규 엔드포인트, Phase C 범위)
        → service-token 인증 (worker → api 호출), Zod 검증
        body = {
          projectId, userId,
          title: topic,
          plateValue: [
            { type: "research-meta", runId, model, plan, sources, ... },
            ...plate_nodes_from_markdown(report_text, images, citations),
          ],
        }
        → 기존 `notes` 테이블 insert 재사용 (Plan 2A가 만든 스키마 그대로)
  - DB update noteId, status="completed", completedAt, totalCostUsdCents=estimate
  - SSE: { type: "done", noteId, projectId, wsSlug }
  ↓
[Web] SSE "done" 수신 → 토스트 + /app/w/[wsSlug]/p/[projectId]/notes/[noteId] 자동 이동 옵션
```

### 5.4 핵심 불변식

- **Temporal workflow가 truth source** — DB는 projection. Web은 SSE + TanStack Query `refetchInterval` 백업.
- **Google interaction_id 체인**은 workflow 메모리와 DB 양쪽에 기록 → crash 후 재시작 시 DB에서 복구.
- **BYOK 키는 activity 경계 안에서만 평문** — workflow state에 평문 키 저장 절대 금지.
- **`workflowId = runId`** — 1:1, 멱등 가능.

---

## 6. Error Handling

### 6.1 Google API 실패

| 상황 | 처리 |
|---|---|
| Rate limit (429) | Temporal activity auto-retry (exponential, max 5회) |
| 서버 오류 (5xx) | retry, 최종 실패 시 status=failed, error 필드 기록 |
| BYOK 키 무효 (401/403) | fail-fast, retry 금지, SSE `{type:"error", code:"invalid_byok_key"}` → Web에서 `/settings/ai` 링크 |
| 쿼터 초과 | fail-fast, "Google 계정 쿼터 확인" 안내 |
| 60분 타임아웃 | Google이 `status="failed"` 반환 → DB status=failed, 부분 아티팩트 보존 |
| Stream network timeout | `last_event_id` 기준 재접속 (Google 권장). 5회 실패 시 `get_interaction` 폴링으로 폴백 |

### 6.2 사용자 행동 엣지케이스

- **plan 단계 24h 이탈** — `workflow.wait_condition(24h timeout)` 만료 → status=cancelled. Google 쪽은 stateless resource라 별도 cleanup 불필요.
- **researching 중 탭 닫기** — workflow 계속 실행. 복귀 시 허브에서 "진행 중" 배지 + SSE 재구독.
- **researching 중 cancel** — POST /runs/:id/cancel → provider.cancel_interaction + workflow.cancel() + status=cancelled.
- **approve 전에 다시 plan 편집 요청** — 순서대로 signal 큐잉 (Temporal 기본).
- **workflow 중복 실행 방지** — `workflowId=runId`, `idReusePolicy=AllowDuplicateFailedOnly`.

### 6.3 페이지 생성 실패

- **이미지 업로드 실패 (MinIO 장애)** — 개별 이미지만 placeholder로 대체, 리포트 본문은 저장. `research_run_artifacts`에 원본 base64 보존 → 나중에 재업로드 가능.
- **페이지 생성 API 실패** — persist_report_activity retry, 최종 실패 시 status=failed이지만 artifacts에 원본 보존 → 수동 복구 가능.
- **markdown → Plate 변환 실패** — fallback: 전체 본문을 단일 paragraph 블록으로 dump. 완전 손실은 없음.

### 6.4 보안/권한

- **다른 워크스페이스의 run 조회 시도** — API에서 `userId + workspaceId` 조인으로 **404** (권한 없음 아님, 존재 은닉 — `api-contract.md` 규칙)
- **Workflow history에 평문 BYOK 키 유입 금지**
- **SSE 스트림 권한** — 연결 수립 시 run의 workspace가 사용자 접근권과 일치하는지 검증
- **이미지 MinIO 버킷** — workspace-scoped path prefix: `research/{workspace_id}/{run_id}/{image_id}.png`, signed URL로 제공

### 6.5 관찰 가능성

- 모든 activity에 Temporal activity heartbeat (30s)
- `research_run_artifacts`는 debug 및 재현용 — 이슈 시 원본 이벤트 스트림 복기
- Spec B(AI Usage Visibility)에서 집계 소스로 사용됨

---

## 7. Cost Visibility (MVP 범위 제한)

Google Deep Research API는 **hard cost cap 파라미터가 없고, 완료 후 실제 비용을 반환하지도 않는다.** 따라서 런타임 차단은 불가능.

**MVP 범위**:
1. **Pre-run 추정치 표시** — 모델 선택 시 "Deep Research: ~$1–3, Max: ~$3–7" 안내 (i18n 카피)
2. **Post-run 추정 비용 DB 기록** — `research_runs.totalCostUsdCents`에 저장, `research-meta` 블록에 "approx" 라벨과 함께 표시
3. 추정 공식:
   ```
   estimated_cost_usd = base[model] × time_factor
     base[deep-research-preview-04-2026]     = 2.0   // mid of $1-3
     base[deep-research-max-preview-04-2026] = 5.0   // mid of $3-7
     time_factor = clamp(duration_minutes / 20, 0.5, 1.5)
   ```
4. "Google 실제 청구와 다를 수 있음. 정확한 비용은 Google Cloud Console에서 확인" 고지 (i18n 카피 고정)

**MVP 밖 → Spec B**:
- 월간 누적 추정 비용 집계
- opt-in 예산 경고
- 사용자/어드민 대시보드

---

## 8. i18n · Rollout · Feature Flag

### i18n

- 신규 네임스페이스: `messages/ko/research.json`, `messages/en/research.json`
- 키 예시: `research.hub.title`, `research.new.topic_placeholder`, `research.new.model.select`, `research.new.model.deep_research`, `research.new.model.max`, `research.plan.approve`, `research.plan.edit_direct`, `research.plan.chat_feedback`, `research.progress.thinking`, `research.progress.writing`, `research.error.invalid_byok`, `research.error.quota_exceeded`, `research.meta.plan`, `research.meta.sources`, `research.meta.thought_summaries`, `research.meta.cost_approx`, `research.meta.cost_disclaimer`
- ko 먼저 작성, en은 런칭 직전 배치 번역 (Plan 9a 관행)
- `pnpm --filter @opencairn/web i18n:parity` CI 통과 필수

### 카피 톤

- 존댓말, 경쟁사 미언급, 기술 스택 상세 최소화
- OK: "Deep Research는 Google의 심층 조사 에이전트입니다"
- NO: "Gemini deep-research-max-preview-04-2026 model"

### Feature flag

- `FEATURE_DEEP_RESEARCH` env var (기본 `false`, 출시 시 `true`)
- flag off: workspace 사이드바에서 "Deep Research" 아이템 숨김, `/app/w/[wsSlug]/research/*` 라우트 404, `/api/research/*` 404
- BYOK 키 없음: 허브에서 "Gemini API 키를 먼저 설정해주세요" CTA → `/settings/ai`

### Rollout 순서 (각 Phase는 atomic PR)

1. **Phase A** — `packages/llm` interactions wrapper + tests (독립 PR)
2. **Phase B** — DB schema + migration + Temporal workflow + activities + worker tests
3. **Phase C** — `apps/api` routes + SSE + integration tests
4. **Phase D** — `apps/web /research` + Plate research-meta block + Playwright smoke
5. **Phase E** — i18n ko/en parity, 카피 리뷰, feature flag on

### Plan 11B / 10B / Chat Renderer 상호작용

- Deep Research 리포트는 일반 Page → Plan 11B `related_pages` / `@mention`가 자동 적용 (별도 연동 불필요)
- Plan 10B DataTable / Infographic 블록은 **해당 없음** — Google이 이미 이미지로 렌더한 차트를 보내므로 (Plan 10B는 사용자가 에디터에서 직접 만드는 블록)

---

## 9. Testing Strategy

### 9.1 Unit (pytest)

- **`GeminiProvider.start_interaction` / `get_interaction` / `stream_interaction` / `cancel_interaction`** — HTTP mock (respx 또는 httpx_mock)으로 Google 응답 fixture 3종:
  - `planning` (plan 반환)
  - `iterating` (previous_interaction_id 체이닝 후 업데이트된 plan)
  - `executing` (thought_summary · text · image 스트림 → 최종 report)
- **활동 단위 테스트**: `create_plan`, `iterate_plan`, `execute_research`, `persist_report` 각각 Temporal TestEnvironment로 격리
- **MinIO 이미지 업로드** — base64 → bucket path 검증 (mock client)
- **markdown → Plate 변환** — citations · images · code · LaTeX 포함한 스냅샷 테스트
- **Error paths**: 401, 429, 5xx, 60min timeout, malformed image, markdown 파싱 실패

### 9.2 Workflow (Temporal TestEnvironment)

- **Happy path**: start → plan_ready → (signal approve) → researching → completed → noteId set
- **Iteration**: plan_ready → (signal user_feedback) → plan_updated → (signal approve) → completed
- **Cancel**: researching 중 cancel → cancelled, Google cancel_interaction 호출 검증
- **24h abandon**: plan 단계 방치 → cancelled (wait_condition timeout)
- **Determinism**: workflow replay 테스트 (Temporal 필수)

### 9.3 Integration (apps/api)

- **POST /runs** — Zod 실패, workspace scope, 다른 유저 404
- **SSE stream** — 권한, 연결 유지, 이벤트 순서
- **Signal relay** — approve/feedback → workflow signal 호출 증빙

### 9.4 E2E (Playwright)

- **Smoke 1개**: topic 입력 → plan 수신 → 직접 편집 → approve → 완료 페이지 도달
  - Google API는 fetch interceptor로 mock — 실제 호출 X, 비결정적 20분 대기 X
  - 완료 후 `/app/w/[wsSlug]/p/[projectId]/notes/[noteId]` 이동 + research-meta 블록 렌더 검증

### 9.5 Fixtures

- `apps/worker/tests/fixtures/interactions/` — Google API 응답 JSON
- `apps/web/tests/fixtures/report-snapshot.json` — Plate 노드 스냅샷

### 9.6 Non-goals (MVP 테스트 범위 밖)

- 실제 Google API 연동 테스트 (비용 · 비결정성)
- 60분 full-length 시나리오 (타임아웃 동작만 검증, 실제 긴 실행은 수동)
- MCP/File Search 경로 (MVP에서 제외)

---

## 10. Open Questions

1. **google-genai SDK 버전** — `client.interactions.*` API가 안정화된 버전 확인 필요. 4월 preview 발표와 동시에 SDK 업데이트 여부는 `uv`로 설치 시 확인.
2. **Google visualization 이미지 포맷** — PNG/SVG 어느 쪽 받을지는 실제 응답 확인 후 MinIO 업로드 코드 확정. 둘 다 처리 가능하게 구현.
3. **research-meta 블록 Plate 직렬화 호환성** — Yjs 동기화에서 커스텀 블록 ok 여부. Plan 2B Hocuspocus 통합 전에 Yjs 테스트 1개.
4. **SSE vs WebSocket** — 현재 SSE로 설계했으나 Hocuspocus가 붙는 라우트와 합류 시 WebSocket로 통일할지는 Plan 2B에서 재검토. 본 spec에서는 SSE로 진행.
5. **타겟 프로젝트 선택 정책** — MVP에서는 run 생성 시 사용자가 드롭다운으로 프로젝트 선택 필수. 차기 개선안: (a) workspace에 "Research" 기본 프로젝트 자동 생성 후 default, (b) 최근 접근 프로젝트 default. 본 spec은 (사용자 선택 필수)로 진행.
6. **service-token 인증 (worker → api)** — 해결됨: 기존 Plan 3이 도입한 `INTERNAL_API_SECRET` + `X-Internal-Secret` 헤더 스킴을 재사용 (`apps/api/src/routes/internal.ts`). 신규 `/api/internal/notes` 엔드포인트도 동일 미들웨어 아래 마운트.

---

## 11. Decomposition → Implementation Plan

본 spec은 brainstorming 출력이고, 실행 plan은 superpowers `writing-plans` skill로 별도 생성한다. Phase A~E의 5-stage 롤아웃을 기반으로 atomic PR 단위로 쪼개며, 다음을 포함해야 한다:

- Plan A: `packages/llm` Interactions wrapper (독립)
- Plan B: DB schema + Temporal workflow + activities
- Plan C: `apps/api` routes + SSE
- Plan D: `apps/web /research` + Plate research-meta
- Plan E: i18n + feature flag + E2E smoke + 출시

각 Plan 내부에서는 Red-Green-Refactor TDD (superpowers rule).
