# Plan 7 Canvas Sandbox — Phase 2 Design

**Date:** 2026-04-26
**Status:** Draft (브레인스토밍 합의 완료, 구현 plan 작성 대기)
**Replaces / refines:** `docs/superpowers/plans/2026-04-09-plan-7-canvas-sandbox.md` (Tasks A·B·E의 잔여), `docs/superpowers/specs/2026-04-25-plan-7-canvas-phase-1-design.md` §10 인계 항목 전부.
**Related:**
- [Phase 1 Design](2026-04-25-plan-7-canvas-phase-1-design.md) — 본 문서의 전제. 브라우저 sandbox·`canvas_language`·CSP 헤더는 그대로 유지.
- [ADR-006 — Browser Sandbox (Pyodide + iframe)](../../architecture/adr/006-pyodide-iframe-sandbox.md)
- [Agent Runtime v2 Sub-A](2026-04-22-agent-runtime-v2-design.md) — `runtime.Agent` 패턴 채택.
- [Deep Research Phase B/C](2026-04-22-deep-research-integration-design.md) — Temporal workflow + SSE poll 패턴 레퍼런스.
- [Billing Routing](../../architecture/billing-routing.md) — Code Agent는 chat 정책을 그대로 사용.

---

## 1. Goal & Scope

### 1.1 Goal

Phase 1 의 브라우저 샌드박스 위에 **Code Agent (Python worker)** + **셀프힐링 루프** + **Monaco 편집기** + **matplotlib 출력 보존** 을 얹어, 캔버스가 "한 번 실행되는 코드 뷰어" 에서 "AI 가 코드를 만들고 고치는 작업 환경" 이 되도록 만든다.

### 1.2 In-scope

1. **Code Agent** — `apps/worker/src/worker/agents/code/` (`agent.py`, `prompts.py`, `__init__.py`). `runtime.Agent` 패턴, `emit_structured_output` 단일 tool (output schema = `{language, source, explanation}`).
2. **Temporal `CodeAgentWorkflow`** + 2 activities (`generate_code_activity`, `analyze_feedback_activity`). Signal: `client_feedback`, `cancel`. Heartbeat 사용.
3. **`POST /api/code/run`** (Hono, SSE) — workflow 시작 + 폴 기반 스트림 (Deep Research `import.ts` 패턴 재사용).
4. **`POST /api/code/feedback`** — 클라이언트 실행 결과를 workflow signal 로 전달.
5. **`POST /api/canvas/from-template`** — Plan 6 미구현이므로 **flag-gated 501 stub**. Zod 스키마 + 라우트 + 테스트 작성, 본 구현은 Plan 6 land 시.
6. **Monaco editor**, **matplotlib MinIO 저장**, **Tab Mode Router E2E 실행** (Phase 1·3-A·3-B 누적 deferred 해소).

### 1.3 Out-of-scope (Phase 3+)

- inline canvas Plate 블록 (Plan 10B)
- 다중 사용자 협업 / 동시 편집 (last-write-wins 유지)
- LSP / 코드 자동완성 고도화 (Monaco 기본 기능만)
- 다중 language 동시 편집 (한 노트 = 한 language)
- Code Agent 의 외부 검색·노트 인용 tool (`search_notes`, `fetch_url` 등) — 다음 phase
- `previous_interaction_id` 체이닝 (Gemini Interactions API) — 본 phase 는 stateless turn 으로 진행
- 코드 실행 결과를 Plate 노트에 자동 임베드 (Plan 10B)

### 1.4 Success criteria

- 사용자가 빈 캔버스 노트에 "matplotlib 으로 sine wave 그려줘" 를 입력 → ≤30s 안에 실행 가능한 코드 수신, Apply → Run → 그래프 확인까지 완료.
- 의도적으로 에러 나는 코드 → feedback → 4 turn 안에 자동 수정 완료 또는 `max_turns` 종료.
- matplotlib figure 저장 → 다음 세션에서도 동일 노트에서 갤러리에 노출.
- Monaco 가 캔버스 모드에서만 로딩되어 랜딩/다른 모드 번들 영향 0.
- 모든 user-facing 문자열 i18n parity 통과, CSP 회귀 가드 그린.

---

## 2. Architecture

### 2.1 Data flow

```
[browser]                              [Hono API]                        [Temporal]                      [Worker]

NewCanvas + 프롬프트
  POST /api/code/run -----------------> mountWorkflow(noteId,           startWorkflow
                                        prompt, byokOrManaged)    --->  CodeAgentWorkflow ----activity--> generate_code_activity
                                                                                                          (LLM via packages/llm
                                                                                                            BYOK/managed router)
                                                                                                            ↓
                                                                        update history <----events--------- AgentEvent stream
                                                                        (workflow query)                    via runtime.Agent
                                        ←--SSE poll/stream---
ReadableStream
  (status / thought / token / done / error)

  ↓ 코드 수신 → CanvasViewer
  ↓ 사용자 Run
  ↓ PyodideRunner 실행
  ↓ 에러 발생

  POST /api/code/feedback -----------> signalWorkflow(client_feedback,   workflow.wait_signal
                                       {error, stdout, code})        →  → analyze_feedback_activity ----> 동일 LLM router
                                                                          → loop 다시                     (수정 코드 생성)

  ↓ 사용자 Save plot
  POST /api/canvas/output ----------> MinIO PUT canvas-outputs/
                                       <noteId>/<runId>.png
                                       INSERT canvas_outputs row
```

### 2.2 책임 분담

| 레이어 | 역할 | 핵심 파일 |
|---|---|---|
| `apps/web` | Monaco 편집, Pyodide/iframe 실행, postMessage 수신, SSE 구독, output 업로드 트리거 | `components/canvas/MonacoEditor.tsx`, `components/canvas/CodeAgentPanel.tsx`, `components/canvas/CanvasOutputsGallery.tsx`, `lib/use-code-agent-stream.ts`, `lib/use-canvas-outputs.ts` |
| `apps/api` | 인증/권한, workflow start/signal, SSE poll, MinIO upload | `routes/code.ts` (신규), `routes/canvas.ts` (확장 — Phase 1 placeholder 자리) |
| `apps/worker` | LLM 호출, 셀프힐링 루프, AgentEvent 발생 | `worker/agents/code/`, `worker/activities/code_activity.py`, `worker/workflows/code_workflow.py` |
| `packages/llm` | BYOK/managed 라우팅 | 기존 surface (chat 정책) — 추가 변경 없음 |
| `packages/db` | `code_runs`, `code_turns`, `canvas_outputs` | migration `0022_canvas_code_runs_outputs.sql` |
| `packages/shared` | Zod 스키마 (`codeAgentRunRequestSchema`, `codeAgentFeedbackSchema`, `canvasOutputCreateSchema`, `codeAgentEventSchema`) | `shared/src/code-types.ts` 신설 |

### 2.3 핵심 invariant

- **서버는 코드를 한 줄도 실행하지 않는다** (Phase 1·ADR-006 원칙 유지). `/api/code/run` 은 *생성* 라우트.
- **note 단위 활성 workflow 1개** — 동일 noteId 재요청 시 `signalWithStart` 로 기존 workflow `cancel` 후 새로 시작 (race-safe).
- **self-healing 결과를 자동 덮어쓰지 않는다** — UI 에서 사용자가 "Apply" 명시 클릭 시에만 `PATCH /api/notes/:id/canvas` (Phase 1 라우트 재사용).
- **output 자동 저장 없음** — 사용자 "Save plot" 클릭 시에만 MinIO 업로드 (비용·privacy 가드).
- **Monaco lazy import** — 캔버스 모드 진입 시에만 로딩, 다른 페이지/모드 번들 영향 없음.

---

## 3. Code Agent + Workflow + Activities

### 3.1 Code Agent (`apps/worker/src/worker/agents/code/agent.py`)

```python
class CodeAgent(runtime.Agent):
    name = "code"
    tools = [emit_structured_output(schema=CodeOutputSchema)]
    max_turns = 4   # generation 1 + feedback retry 3

    system_prompt = templates.CODE_SYSTEM   # KO base, language-conditional reminders

    def build_user_prompt(self, ctx: CodeContext) -> str:
        if ctx.kind == "generate":
            return templates.GENERATE.format(
                prompt=ctx.user_prompt,
                language=ctx.language,
            )
        elif ctx.kind == "fix":
            return templates.FIX.format(
                original_prompt=ctx.user_prompt,
                language=ctx.language,
                last_code=ctx.last_code,
                error=ctx.last_error,
                stdout_tail=ctx.stdout_tail[-2000:],
            )
```

**`CodeOutputSchema`** (Pydantic):

```python
class CodeOutputSchema(BaseModel):
    language: Literal["python", "javascript", "jsx", "html"]
    source: str = Field(max_length=64 * 1024)  # Phase 1 invariant
    explanation: str = Field(max_length=2000)
```

**프롬프트 정책 (요약):**
- system: ADR-006 환경 제약 (`input()` 금지, esm.sh / cdn.jsdelivr.net 외 네트워크 금지, matplotlib `Agg` 백엔드, 출력은 explanation 짧게 + source 자체만).
- generate: 사용자 자연어 → 단일 self-contained 파일.
- fix: 마지막 코드 + 에러 → 수정본. 메타 코멘트 강제 안 함.

### 3.2 Temporal Workflow (`apps/worker/src/worker/workflows/code_workflow.py`)

```python
@workflow.defn
class CodeAgentWorkflow:
    @workflow.run
    async def run(self, params: CodeRunParams) -> CodeRunResult:
        history: list[CodeTurn] = []
        feedback_signal = workflow.Future[ClientFeedback]()
        cancelled = False

        # turn 0 — initial generate
        out = await workflow.execute_activity(
            generate_code_activity,
            args=[params, history],
            start_to_close_timeout=timedelta(minutes=5),
            heartbeat_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        history.append(CodeTurn(kind="generate", source=out.source, explanation=out.explanation))
        await self._persist_turn(params.run_id, history[-1])

        # feedback loop — up to 3 retries
        for attempt in range(3):
            await workflow.wait_condition(
                lambda: feedback_signal.done() or cancelled,
                timeout=timedelta(minutes=30),  # idle abandon
            )
            if cancelled:
                return CodeRunResult(status="cancelled", history=history)
            if not feedback_signal.done():
                return CodeRunResult(status="abandoned", history=history)

            fb = feedback_signal.result()
            feedback_signal = workflow.Future[ClientFeedback]()  # reset

            if fb.kind == "ok":
                return CodeRunResult(status="completed", history=history)

            out = await workflow.execute_activity(
                analyze_feedback_activity,
                args=[params, history, fb],
                start_to_close_timeout=timedelta(minutes=5),
                heartbeat_timeout=timedelta(seconds=30),
            )
            history.append(CodeTurn(
                kind="fix",
                source=out.source,
                explanation=out.explanation,
                prev_error=fb.error,
            ))
            await self._persist_turn(params.run_id, history[-1])

        return CodeRunResult(status="max_turns", history=history)

    @workflow.signal
    def client_feedback(self, fb: ClientFeedback): ...

    @workflow.signal
    def cancel(self): ...
```

**파라미터:**
```python
@dataclass
class CodeRunParams:
    run_id: UUID
    note_id: UUID
    workspace_id: UUID
    user_id: str
    prompt: str
    language: Literal["python", "javascript", "jsx", "html"]
    byok_key_handle: str | None  # billing-routing.md 참조
```

**`_persist_turn`** = `code_runs` + `code_turns` UPDATE/INSERT (heartbeat-safe). 한 턴 동안의 status 전이는 다음과 같다:

- workflow start → `code_runs.status='running'`.
- 각 turn 완료 후 `wait_condition` 진입 직전 → `code_runs.status='awaiting_feedback'` + `code_turns` INSERT.
- 다음 fix turn 시작 → `code_runs.status='running'`.
- 종료 시 → `'completed'` / `'max_turns'` / `'cancelled'` / `'abandoned'` / `'failed'`.

SSE poll 은 이 두 테이블에서 읽음 (Deep Research `research_runs` + `research_turns` 동형).

### 3.3 Activities (`apps/worker/src/worker/activities/code_activity.py`)

- `generate_code_activity(params, history) -> CodeOutput`
  - `runtime.loop_runner.run_with_tools(CodeAgent(), ctx=CodeContext(kind="generate", ...))` 호출.
  - `emit_structured_output` 결과 회수 → `CodeOutput`.
- `analyze_feedback_activity(params, history, feedback) -> CodeOutput`
  - 동일하지만 `kind="fix"` ctx, `last_code` / `last_error` / `stdout_tail` 채움.

### 3.4 LLM 라우팅

```python
# inside generate_code_activity
provider = await resolve_llm_provider(
    user_id=params.user_id,
    workspace_id=params.workspace_id,
    purpose="chat",   # billing-routing.md chat 정책 그대로 적용
    byok_key_handle=params.byok_key_handle,
)
# provider.generate_with_tools(...)
```

`docs/architecture/billing-routing.md` 의 chat 라우팅: BYOK 우선 → 크레딧 → Admin 폴백. Code Agent 는 별도 enum 없이 `purpose="chat"` 재사용 (사용자 요청 → LLM 응답이 본질적으로 chat 과 동형).

### 3.5 Cost guard

- `max_turns = 4` (1 generate + 3 fix).
- per-turn LLM 호출 1 회 (tool loop 은 `emit_structured_output` 1 회 emit 후 종료).
- workflow idle abandon = 30 분 (`wait_condition` timeout 으로 enforce).
- workflow 절대 timeout = 1 시간 (`signalWithStart` 옵션 `workflow_execution_timeout=timedelta(hours=1)` 으로 enforce).
- 같은 noteId 새 `/api/code/run` 호출 → `signalWithStart` 로 기존 workflow `cancel` signal 후 새로 시작.

---

## 4. API Surface

새로 추가되는 라우트 5 개. 모두 `requireAuth` + Zod + workspace 권한 체크 + `notes.sourceType='canvas'` 가드.

### 4.1 `POST /api/code/run` — Code Agent 시작 (SSE)

**Request body:**
```ts
{
  noteId: uuid,
  prompt: string,           // max 4000 chars
  language: 'python' | 'javascript' | 'jsx' | 'html',
}
```

**Response:** `text/event-stream`. SSE events:
| event kind | payload | 의미 |
|---|---|---|
| `queued` | `{ runId }` | workflow start 완료 |
| `thought` | `{ text }` | (선택) agent 사고 메시지 |
| `token` | `{ delta }` | 스트리밍 source 청크 |
| `turn_complete` | `{ turn: { kind, source, explanation, seq } }` | turn 1개 완료 |
| `awaiting_feedback` | `{}` | workflow 가 client signal 대기 중 |
| `done` | `{ status: 'completed'\|'max_turns'\|'cancelled'\|'abandoned' }` | 종료 |
| `error` | `{ code }` | 에러 (코드 only, 사용자 노출 문구는 web 측 lookup) |

**구현:** Deep Research `import.ts` 폴 패턴. 라우트가 `signalWithStart(CodeAgentWorkflow)` 호출 후 2 초 폴링 루프로 `code_runs`/`code_turns` 변화 감지 → SSE flush. 클라이언트 `EventSource` 끊김 시 server 는 keep-alive comment 15s.

**권한:** `noteId` → `canWrite` (소유 + sourceType='canvas'). 다른 sourceType 은 `409 notCanvas`. cross-workspace 는 `404 notFound` (api-contract 정책 준수).

### 4.2 `POST /api/code/feedback`

**Request body:**
```ts
{
  runId: uuid,
  kind: 'ok' | 'error',
  error?: string,           // max 4KB
  stdout?: string,          // max 8KB
}
```

**구현:** `signalWorkflow(workflowId(runId), 'client_feedback', payload)`. 200 즉시 응답. 워크플로우가 내부적으로 SSE 로 다음 turn 흘려보냄.

**권한:** `runId` → `code_runs.user_id == session.user.id` (workspace 추가 검증). 종료된 workflow 시그널 시 `409 alreadyTerminal`.

### 4.3 `POST /api/canvas/from-template` (stub)

**Request body:**
```ts
{
  projectId: uuid,
  templateId: uuid,
  params?: Record<string, unknown>,
}
```

**구현:**
```ts
if (!env.FEATURE_CANVAS_TEMPLATES) {
  return c.json({ error: 'templatesNotAvailable' }, 501);
}
// Plan 6 시점: templates 테이블 lookup → /api/code/run 위임
```

`FEATURE_CANVAS_TEMPLATES=false` 기본값. 라우트는 등록되지만 본문은 501. 테스트는 401/403/404 에지 + 501 fallback 만 작성. Plan 6 land 시 본 구현 + 추가 테스트.

### 4.4 `POST /api/canvas/output` — matplotlib 등 figure 저장

**Request:** `multipart/form-data`
```ts
{
  noteId: uuid,
  runId?: uuid,
  mimeType: 'image/png' | 'image/svg+xml',
  file: <≤2MB binary>,
}
```

**서버 동작:**
1. `canRead(noteId)` + `notes.sourceType=='canvas'` 검증.
2. SHA-256 hash 계산 → `canvas_outputs.UNIQUE(note_id, content_hash)` 충돌 시 기존 row 재사용 (idempotent).
3. MinIO put `canvas-outputs/<workspaceId>/<noteId>/<contentHash>.png` (mimetype 별 확장자 매핑).
4. INSERT `canvas_outputs` row → `200 { id, urlPath, createdAt }` (urlPath = `/api/canvas/outputs/<id>/file`, GET 라우트로 접근).

크기·MIME 가드 이중 (Hono `bodyLimit` 2MB + Zod `refine`).

### 4.5 `GET /api/canvas/outputs?noteId=...` & `GET /api/canvas/outputs/:id/file`

- **list:** 노트의 output 메타 list (id, mimeType, bytes, createdAt, runId). 권한 `canRead`.
- **stream:** Phase 3-B `notes/:id/file` 스트리밍 헬퍼 재사용 (RFC 6266 dual filename + Web ReadableStream back-pressure). 권한 `canRead`.

### 4.6 DB schema

`packages/db/migrations/0022_canvas_code_runs_outputs.sql`:

```sql
CREATE TABLE code_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  language text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
    -- pending | running | awaiting_feedback | completed | max_turns | cancelled | abandoned | failed
  workflow_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_runs_note_idx ON code_runs(note_id, created_at DESC);

CREATE TABLE code_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES code_runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind text NOT NULL,            -- generate | fix
  source text NOT NULL,
  explanation text,
  prev_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, seq)
);

CREATE TABLE canvas_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  run_id uuid REFERENCES code_runs(id) ON DELETE SET NULL,
  content_hash text NOT NULL,
  mime_type text NOT NULL,
  s3_key text NOT NULL,
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(note_id, content_hash)
);
CREATE INDEX canvas_outputs_note_idx ON canvas_outputs(note_id, created_at DESC);
```

Drizzle 정의: `packages/db/src/schema/canvas.ts` (Phase 1 `canvas_language` 자리에 신규 테이블 추가).

---

## 5. Frontend: Monaco + Self-healing UX

### 5.1 Monaco 통합

**파일:** `apps/web/src/components/canvas/MonacoEditor.tsx`.

```tsx
"use client";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="text-xs">{t("canvas.monaco.loading")}</div>,
});

const LANG_MAP = {
  python: "python",
  javascript: "javascript",
  jsx: "javascript",   // JSX = javascript 모드 + jsxFlavour 옵션
  html: "html",
} as const;
```

- **버전 고정:** `@monaco-editor/react` + `monaco-editor` minor 핀.
- **테마:** `useTheme()` (next-themes) → `"vs-dark" | "light"`.
- **옵션:** `minimap: false`, `fontSize: 13`, `tabSize: 2`, `wordWrap: "on"`, `fixedOverflowWidgets: true`.
- **CSP:** Monaco web worker (`editor.worker.js`, `ts.worker.js`) 는 `monaco-editor/esm/vs/...` 경로 → `worker-src 'self' blob:` 만 보장. **CDN 사용 안 함**.

`CanvasViewer.tsx` (Phase 1) 수정:
- 기존 `<textarea>` → `<MonacoEditor language={LANG_MAP[note.canvasLanguage]} value={src} onChange={onChange} ... />`.
- 로딩 fallback 은 textarea-스타일 placeholder.
- 디바운스 1.5s 저장 로직 그대로.

### 5.2 Self-healing UX

`apps/web/src/components/canvas/CodeAgentPanel.tsx` — CanvasViewer 우측 또는 하단 collapsible.

**상태:**
| 상태 | UI |
|---|---|
| `idle` | "Ask AI" 버튼 + 프롬프트 textarea |
| `running` | spinner + 토큰 스트림 미리보기 (read-only) |
| `awaiting_feedback` | "Apply", "Discard", 자동 Run 후 결과 패널 |
| `max_turns` / `cancelled` / `abandoned` | 종료 안내 + "다시 시도" 버튼 |

**자동 piping 정책:**
- workflow 가 `turn_complete` 발생 → 클라이언트는 **Apply 버튼만 활성화** (자동 덮어쓰지 않음).
- Apply → `PATCH /api/notes/:id/canvas` (Phase 1 라우트) → 코드 갱신.
- "Run" 클릭 → PyodideRunner / iframe 실행.
- 실행 결과 (성공/실패) → "AI 에게 결과 보내기" 토글 (default ON) → `POST /api/code/feedback`.
- feedback 으로 fix turn 도착 → 다시 Apply 대기.

**자동 모드(opt-in):** 사용자 토글 `autoFix` ON 시:
- Apply → Run → (에러 시) feedback 자동 send → 다음 turn → Apply → … `max_turns` 까지.
- 비용 가드: turn 카운터 UI 표시 (예: "3 / 4"), max 도달 시 자동 중단.

**훅:**
- `useCodeAgentStream(runId)` — `EventSource` 래핑. cleanup on unmount. `done`/`error` 이벤트 시 자동 close.
- `useCanvasOutputs(noteId)` — `GET /api/canvas/outputs` React Query. `POST /api/canvas/output` 성공 시 invalidation.

### 5.3 matplotlib output 캡처 (브라우저)

`PyodideRunner.tsx` (Phase 1) 확장:

```tsx
// 실행 직전 matplotlib 백엔드 강제
await pyodide.runPythonAsync(`
import os
os.environ['MPLBACKEND'] = 'AGG'
`);
// (사용자 코드 실행)
// 실행 후 figures 수집
const figures = await pyodide.runPythonAsync(`
import io, base64
import matplotlib.pyplot as plt
result = []
for num in plt.get_fignums():
    fig = plt.figure(num)
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
    result.append(base64.b64encode(buf.getvalue()).decode())
plt.close('all')
result
`);
// figures: string[]  (base64 PNG)
```

**UI:**
- 실행 결과 영역에 figure 갤러리 (썸네일).
- 각 figure 에 "Save to note" 버튼 → base64 → Blob → `POST /api/canvas/output` multipart upload.
- 저장 성공 시 갤러리에 "saved" 배지.
- 노트 하단 **저장된 출력** 섹션 = `GET /api/canvas/outputs?noteId=...` 결과 (`CanvasOutputsGallery.tsx`).

**자동 저장 안 함** 이유:
- 비용 (MinIO 객체 수 폭증).
- privacy (실수 저장 가능성).
- 사용자가 의도적으로 보관할 figure 만 저장.

---

## 6. Testing · i18n · CSP · Rollout

### 6.1 Tab Mode Router E2E (실제 실행)

`apps/web/tests/e2e/canvas-phase-2.spec.ts` 신규. Phase 1 의 `canvas.spec.ts` 보강.

| # | 시나리오 | 검증 |
|---|---|---|
| 1 | New Canvas → Code Agent generate | 사이드바 NewCanvas → 프롬프트 입력 → SSE 에서 `turn_complete` 수신 → Apply 활성 |
| 2 | Apply → Run → 성공 | Monaco 에 source 반영 → Run → stdout 기대값 → "결과 보내기" OFF |
| 3 | Apply → Run → 에러 → feedback → fix turn | error 캡처 → POST feedback → 새 `turn_complete` 수신 → 코드 변경 확인 |
| 4 | matplotlib figure → save | 간단한 plot 실행 → 갤러리 노출 → Save → `GET /api/canvas/outputs` 1 건 |
| 5 | max_turns 도달 | 항상 실패하는 코드 → 4 turn 후 `done.status='max_turns'` |
| 6 | Tab Mode 전환 | canvas tab → reading 모드 (모드 메뉴) → fallback (canvas 는 reading 미지원이라 stub viewer) |
| 7 | `/api/canvas/from-template` 501 | flag OFF 호출 → 501 + `templatesNotAvailable` |

**E2E 실행 정책:** Phase 1·3-A·3-B 누적 deferred 를 Phase 2 에서 끝낸다. CI 에 `e2e:canvas` job 추가 (기존 `tests/e2e` reuse + Pyodide WASM 캐시 워밍 step).

`/test-seed` 확장: canvas note + 미리 채워진 source seed 모드 추가 (E2E hermetic).

### 6.2 단위 테스트

| 패키지 | 추가분 | 형태 |
|---|---|---|
| `packages/db` | `canvas_outputs` + `code_runs` + `code_turns` schema | Drizzle introspection round-trip |
| `packages/shared` | `code-types.ts` Zod | parse / safeParse 양·음성 |
| `apps/api` | `routes/code.ts` + `routes/canvas.ts` | 권한 (canRead/canWrite/cross-workspace 404), Zod 거부, SSE 형태, signal 라우팅, multipart 크기/MIME 가드, 501 stub |
| `apps/web` | `MonacoEditor`, `CodeAgentPanel`, `useCodeAgentStream`, output upload | RTL + msw EventSource mock |
| `apps/worker` | `code_workflow`, `code_activity`, `agents/code/agent.py` | Temporal `time_skipping`, generate/fix/max_turns/cancel/abandon 5 path, LLM provider mock |

목표: 기존 `pnpm -w test` 그린 + 추가 ≥ 100 tests (api 30 + web 40 + worker 25 + shared/db 5+).

### 6.3 i18n 키

`apps/web/messages/{ko,en}/canvas.json` 확장 (Phase 1 namespace). 신규 ~25 키:

```
canvas.agent.{prompt,placeholder,run,running,apply,discard,retry,
              autoFix,autoFixOn,autoFixOff,turnsCount,
              maxTurnsReached,abandoned,cancelled}
canvas.monaco.{loading,error}
canvas.outputs.{title,save,saved,empty,delete,confirmDelete}
canvas.template.{notAvailable}
canvas.errors.{notCanvas,wrongLanguage,workflowFailed,
               outputTooLarge,outputBadType,templatesNotAvailable,
               alreadyTerminal}
```

`pnpm --filter @opencairn/web i18n:parity` CI gate.

### 6.4 CSP 변경

`next.config.ts` (또는 `proxy.ts`) CSP 헤더:

| 디렉티브 | Phase 1 | Phase 2 추가 |
|---|---|---|
| `script-src` | `'self' 'unsafe-eval' cdn.jsdelivr.net` | (변경 없음 — Monaco self) |
| `worker-src` | `'self' blob:` | (변경 없음 — Monaco worker self/blob) |
| `connect-src` | `'self' cdn.jsdelivr.net` | (변경 없음 — `/api/code/*` SSE same-origin) |
| `img-src` | `'self' data:` | `'self' data: blob:` (matplotlib base64 미리보기) |

**`scripts/canvas-regression-guard.sh`** (Phase 1) 확장 항목:
- Monaco CDN 사용 차단 (self 호스팅 강제).
- `/api/code/run` 응답 MIME 이 `text/event-stream` 이외인 경우 차단.
- `unsafe-eval` 제거 시도 차단 (Phase 1 부터 Pyodide 의존).

### 6.5 Rollout / feature flags

| Flag | 기본값 | 영향 |
|---|---|---|
| `FEATURE_CODE_AGENT` | `false` | `/api/code/run`·`/api/code/feedback`·`CodeAgentPanel` 노출. dev/staging 만 `true`. |
| `FEATURE_CANVAS_TEMPLATES` | `false` | `/api/canvas/from-template` 501 stub 또는 본 동작 (Plan 6 land 시) |
| `FEATURE_CANVAS_OUTPUT_STORE` | `true` | matplotlib MinIO 저장. 비용 이슈 시 OFF 매트릭 보존 가능. |

ENV 공급: `apps/api/.env.example`, `apps/worker/.env.example`, `apps/web/.env.example` 갱신.

**프로덕션 활성화 게이트** (별도 후속):
- (g1) Code Agent 비용 모니터링 — `code_runs.{completed,max_turns,abandoned}` 비율 + token usage.
- (g2) MinIO `canvas-outputs` 버킷 객체 수·용량 알림.
- (g3) 셀프힐링 `max_turns` 초과율 — 너무 높으면 prompt 튜닝 필요.

이 셋은 plan 안에서 코드/runbook 추가만 하고 ON 결정은 별도.

### 6.6 문서 업데이트

- `docs/architecture/api-contract.md` — `/api/code/*`, `/api/canvas/output`, `/api/canvas/from-template` 추가.
- `docs/architecture/data-flow.md` — Code Agent flow 다이어그램.
- `docs/contributing/llm-antipatterns.md` — Monaco lazy-import + `signalWithStart` SSE poll 함정 (있으면).
- `docs/contributing/plans-status.md` — Plan 7 row 갱신 (Phase 2 ✅ 마킹).
- `docs/contributing/ops.md` — `canvas_outputs` 운영 노트 (수동 정리·TTL 정책 등).

---

## 7. Confirmed decisions

1. ✅ `runtime.Agent` 패턴 채택 (Compiler/Research/Librarian 동형).
2. ✅ Temporal `CodeAgentWorkflow` + activities (Deep Research 패턴).
3. ✅ BYOK / managed routing — `purpose="chat"` 재사용.
4. ✅ Code Agent tool 표면 = `emit_structured_output` 단일 (외부 검색·노트 인용 미포함).
5. ✅ `max_turns = 4` (1 generate + 3 fix), idle abandon 30 분, 절대 timeout 1 시간.
6. ✅ `/api/canvas/from-template` 은 flag-gated 501 stub (Plan 6 의존).
7. ✅ Monaco 채택 (CodeMirror 6 검토 안 함). `dynamic()` lazy import, self-host.
8. ✅ matplotlib 출력 = 사용자 명시 저장 only (자동 저장 없음).
9. ✅ self-healing 결과 자동 덮어쓰기 없음 — Apply 명시 클릭 강제.
10. ✅ Tab Mode E2E 누적 deferred 를 Phase 2 에서 끝냄.

---

## 8. Open questions / Phase 3+ 로 위임

- **Q1:** matplotlib 외 다른 figure 라이브러리 (plotly, bokeh) 출력 저장 → MIME 분기 확장 필요. 현재는 PNG/SVG 만.
- **Q2:** `previous_interaction_id` 체이닝으로 Code Agent fix turn 비용 절감 — Gemini Interactions API. 본 phase 는 stateless turn 으로 진행.
- **Q3:** 다중 사용자 협업 — 현재 last-write-wins. Hocuspocus 어댑터는 Phase 3+.
- **Q4:** Code Agent 가 노트 컨텍스트 (다른 페이지·개념) 를 인용하도록 확장 → `search_notes` tool 추가 필요. 본 phase 미포함.
- **Q5:** 캔버스 노트 export (.py / .ipynb / .html 다운로드) — Plan 10 Document Skills 와 통합 검토.

---

## 9. Phase 2 인계 (다음 phase)

본 phase 종료 시 인계할 항목:

- `/api/canvas/from-template` 본 구현 (Plan 6 templates 테이블 land 시).
- `previous_interaction_id` 체이닝 도입으로 fix turn 비용 절감.
- `search_notes` / `fetch_url` tool 추가로 Code Agent 노트 인용 가능.
- 다중 사용자 협업 (Hocuspocus 어댑터 → CanvasViewer / Monaco).
- 캔버스 결과 inline Plate 블록 (Plan 10B).
- 캔버스 export (.py / .ipynb) 통합 (Plan 10).
