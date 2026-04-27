# Multi-format Synthesis Export — Design Spec

**Date:** 2026-04-27
**Status:** Approved
**Supersedes:**
- `docs/superpowers/specs/2026-04-15-document-skills-design.md` (Plan 10 — pre-ADR-006 서버 컴파일 설계, 미구현)
- `docs/architecture/document-io.md` (exploring 문서, 본 spec으로 결정 승격)

**Related:**
- `docs/superpowers/specs/2026-04-21-plan10-output-extensions-design.md` (Plan 10B 인라인 블록 — 본 spec과 별개, 소형 후속 plan)
- `docs/superpowers/specs/2026-04-26-plan-7-canvas-phase-2-design.md` (Code Agent 패턴 레퍼런스)
- `docs/architecture/billing-routing.md`
- `docs/architecture/adr/006-pyodide-iframe-sandbox.md`

---

## 1. Goal & Wedge

사용자가 업로드한 논문 N개 + Deep Research 결과 + 워크스페이스 노트를 AI가 종합해 **LaTeX 학위논문 초고 / DOCX 보고서 / PDF / Markdown**을 한 번에 생성한다.

**시장 공백**: ChatGPT Canvas는 LaTeX 출력 불가, Notion AI는 시도 안 함, Overleaf는 AI 합성 없음, Word/Google Docs는 LaTeX 자체 지원 안 함. "AI가 내 자료 종합해서 LaTeX 학위논문 초고 뽑아줌" — 비어있는 자리. 한국 대학원생 시장 직격.

---

## 2. Scope

### 2.1 Plan 10 관계

Plan 10 (2026-04-15)은 **본 spec으로 대체(superseded)**. 이유:
- 미구현 상태라 매몰 비용 없음
- Plan 10의 Tectonic MSA / Playwright 서버 컴파일 / skill registry가 ADR-006 이전 설계
- F의 synthesis 목표가 Plan 10의 document generation 목표를 포함하며 더 강력하게 달성

Plan 10B (인라인 블록: Infographic / DataTable / KnowledgeHealthReport)는 입력 방식이 다름(KG-derived, not source-synthesis). 본 spec 스코프 밖 — 별도 소형 plan으로 분리.

### 2.2 In-scope (v1)

| 출력 포맷 | LLM 출력 | 컴파일 위치 | Pro 전용 |
|---|---|---|---|
| LaTeX `.tex` 소스 | `.tex` 직접 생성 | — (텍스트 download) | ❌ |
| LaTeX → PDF | 동일 `.tex` | Tectonic MSA (Docker) | ✅ |
| DOCX | 구조화 JSON | `apps/api` (`docx` npm) | ❌ |
| PDF | 구조화 JSON → HTML | `apps/api` (Playwright) | ❌ |
| Markdown | 마크다운 텍스트 직접 생성 | — (텍스트 download) | ❌ |

### 2.3 Out-of-scope (v1)

- PPTX — 수요 확인 후 추가
- 인라인 블록 (Plan 10B 분리)
- 자동 리뷰 루프 — 사용자 채팅 재합성으로 대체
- 대학별 `.cls` 커스텀 업로드 — v2에서 추가
- Synthesis 결과를 Plate 노트에 자동 임베드

---

## 3. Architecture

### 3.1 컴파일 전략

**Pyodide는 문서 export에 사용하지 않는다.** 이유:
- `reportlab` 등 C 확장 라이브러리는 WASM 휠 부재 가능성 높음
- 한글 폰트를 Pyodide 가상 파일시스템에 번들하는 경로 미검증
- 100페이지 학위논문 수준의 메모리 요구를 브라우저에서 감당하기 어려움

대신 **LLM이 구조화 JSON을 생성 → `apps/api` 서버에서 렌더링**:
- DOCX: `docx` npm (pure JS, 한글 Unicode 처리 ✅, 서버 폰트 제어)
- PDF: Playwright HTML→PDF (서버 폰트 제어)
- LaTeX PDF: Tectonic MSA (xelatex + kotex + NanumGothic 번들)

이는 ADR-006 위반이 아니다. ADR-006은 *사용자가 임의로 작성한 코드*를 서버에서 실행하는 것을 금지한다. LLM이 생성한 구조화 JSON을 `docx` npm 라이브러리로 렌더링하는 것은 문서 컴파일 — 다른 범주.

### 3.2 전체 데이터 플로우

```
[Browser]                    [Hono API]                [Temporal]              [Worker]

소스 선택 + 프롬프트
POST /api/synthesis/run ───► auth + validate
                              signalWithStart      ──► SynthesisWorkflow
◄── { runId } ──────────────                               │
                                                    fetch_sources_activity
GET .../runs/:id/stream                                    │  S3 objects +
EventSource ◄── SSE poll ◄── 2s poll DB ◄──────────       │  workspace search
                                                    synthesize_activity
                                                           │  SynthesisAgent
                                                           │  → structured JSON
                                                    compile_activity
                                                           │  docx npm (DOCX)
                                                           │  Playwright (PDF)
                                                           │  Tectonic (LaTeX Pro)
turn_complete                                              │
→ download links                                    ──► MinIO/R2
                                                    synthesis_documents row
```

### 3.3 책임 분담

| 레이어 | 역할 | 핵심 파일 |
|---|---|---|
| `apps/worker` | 소스 수집, LLM 합성, 컴파일 결정 | `agents/synthesis/`, `activities/synthesis_activity.py`, `workflows/synthesis_workflow.py` |
| `apps/api` | 인증/권한, workflow start/signal, SSE poll, docx/PDF compile, Tectonic proxy | `routes/synthesis.ts`, `lib/document-compilers/` |
| `apps/web` | 소스 picker, SSE 구독, 포맷 선택, 다운로드 트리거 | `components/synthesis/` |
| `apps/tectonic` | LaTeX → PDF (Pro 전용 Docker MSA) | `Dockerfile`, `server.py` |
| `packages/db` | `synthesis_runs`, `synthesis_sources`, `synthesis_documents` | `migration/0026_synthesis.sql` |
| `packages/shared` | Zod 스키마 | `src/synthesis-types.ts` |

### 3.4 핵심 Invariant

- 서버는 LLM 생성 구조화 JSON을 렌더링한다. 사용자 임의 코드 실행 0 (ADR-006 준수).
- Tectonic MSA는 LLM이 생성한 `.tex`를 컴파일한다. `--untrusted` 플래그로 shell escape 차단.
- `FEATURE_TECTONIC_COMPILE` flag — Pro 플랜 + flag ON 시에만 Tectonic 경로 노출.
- note 단위 활성 workflow 1개 — 동일 컨텍스트 재요청 시 `signalWithStart`로 기존 cancel 후 재시작.

---

## 4. Synthesis Agent + Workflow

### 4.1 SynthesisAgent (`apps/worker/src/worker/agents/synthesis/agent.py`)

```python
class SynthesisAgent(runtime.Agent):
    name = "synthesis"
    tools = [emit_structured_output(schema=SynthesisOutputSchema)]
    max_turns = 1  # one-shot; 재합성은 사용자 채팅 재요청으로

    system_prompt = templates.SYNTHESIS_SYSTEM  # 포맷별 citation 규칙 포함

    def build_user_prompt(self, ctx: SynthesisContext) -> str:
        # ctx.sources_text: 수집된 소스 전문 (토큰 예산 내)
        # ctx.workspace_notes: 관련 노트 발췌
        # ctx.user_prompt: 사용자 지시
        # ctx.format: "latex" | "docx" | "pdf" | "md"
        # ctx.template: "ieee" | "acm" | "apa" | "korean_thesis" | "report"
        ...
```

**`SynthesisOutputSchema`** (Pydantic):

```python
class BibEntry(BaseModel):
    cite_key: str          # "src:{short_source_id}"
    author: str
    title: str
    year: int | None
    url: str | None
    source_id: str         # synthesis_sources.id

class SynthesisSection(BaseModel):
    title: str
    content: str           # 포맷에 맞는 마크업 (tex / html / md)
    source_ids: list[str]  # traceability — LaTeX/DOCX 강제, MD 베스트에포트

class SynthesisOutputSchema(BaseModel):
    format: Literal["latex", "docx", "pdf", "md"]
    title: str
    abstract: str | None
    sections: list[SynthesisSection]
    bibliography: list[BibEntry]
    template: str
```

**프롬프트 정책:**
- system: 포맷별 citation 강제 규칙 (LaTeX: `\cite{src:xxx}` 의무, DOCX: 각주 스타일, MD: 베스트에포트)
- system: 학위논문 template 선택 시 한국 논문 구조 주입 (표지/초록/목차/본문/참고문헌)
- user: 소스 전문 + 워크스페이스 노트 발췌 + 사용자 지시

**토큰 예산**: 소스 합계 ≤ 180K 토큰 (Gemini long-context 창 활용). 초과 시 semantic score 순으로 자름. 잘린 소스는 `synthesis_sources.included = false`로 기록.

### 4.2 Temporal Workflow (`apps/worker/src/worker/workflows/synthesis_workflow.py`)

```python
@workflow.defn
class SynthesisWorkflow:
    @workflow.run
    async def run(self, params: SynthesisRunParams) -> SynthesisResult:
        # 1. 소스 수집
        sources = await workflow.execute_activity(
            fetch_sources_activity,
            args=[params],
            start_to_close_timeout=timedelta(minutes=5),
            heartbeat_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        # 2. LLM 합성
        output = await workflow.execute_activity(
            synthesize_activity,
            args=[params, sources],
            start_to_close_timeout=timedelta(minutes=10),
            heartbeat_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        # 3. 컴파일
        doc_url = await workflow.execute_activity(
            compile_activity,
            args=[params, output],
            start_to_close_timeout=timedelta(minutes=5),
            heartbeat_timeout=timedelta(seconds=30),
        )
        return SynthesisResult(status="completed", doc_url=doc_url)

    @workflow.signal
    def cancel(self): self._cancelled = True
```

**Workflow 파라미터:**

```python
@dataclass(frozen=True)
class SynthesisRunParams:
    run_id: str
    workspace_id: str
    project_id: str | None
    user_id: str
    format: Literal["latex", "docx", "pdf", "md"]
    template: Literal["ieee", "acm", "apa", "korean_thesis", "report"]
    user_prompt: str
    explicit_source_ids: list[str]   # S3 object IDs
    note_ids: list[str]              # 명시 선택 노트
    auto_search: bool
    byok_key_handle: str | None
```

### 4.3 Activities (`apps/worker/src/worker/activities/synthesis_activity.py`)

**`fetch_sources_activity`** — 소스 수집 (두 모드 병존):

```python
@activity.defn
async def fetch_sources_activity(params: SynthesisRunParams) -> SourceBundle:
    sources = []

    # 명시 선택: S3에서 직접 fetch
    for source_id in params.explicit_source_ids:
        sources.append(await fetch_s3_object(source_id))

    # 명시 선택 노트
    for note_id in params.note_ids:
        sources.append(await fetch_note_content(note_id))

    # 자동 검색 (toggle ON 시) — workspace semantic search
    if params.auto_search:
        notes = await search_workspace_notes(
            workspace_id=params.workspace_id,
            query=params.user_prompt,
            limit=10,
        )
        sources.extend(notes)

    # 토큰 예산 적용: score 순 정렬 후 180K 초과분 제외
    return apply_token_budget(sources, max_tokens=180_000)
```

**`synthesize_activity`** — LLM 합성:

```python
@activity.defn
async def synthesize_activity(
    params: SynthesisRunParams,
    sources: SourceBundle,
) -> SynthesisOutputSchema:
    activity.heartbeat("starting synthesis")
    provider = await resolve_llm_provider(
        user_id=params.user_id,
        workspace_id=params.workspace_id,
        purpose="chat",
        byok_key_handle=params.byok_key_handle,
    )
    agent = SynthesisAgent(llm=provider)
    ctx = SynthesisContext(
        sources_text=sources.as_text(),
        workspace_notes=sources.notes_excerpt(),
        user_prompt=params.user_prompt,
        format=params.format,
        template=params.template,
    )
    return await agent.run(ctx)
```

**`compile_activity`** — 포맷별 컴파일:

```python
@activity.defn
async def compile_activity(
    params: SynthesisRunParams,
    output: SynthesisOutputSchema,
) -> str:  # R2/MinIO URL
    if params.format == "latex":
        tex = assemble_tex(output)
        bib = assemble_bib(output.bibliography)
        # Plan 9b 미구현 시점: is_pro()는 user_preferences 또는 workspace billing tier 필드로 구현
        # Plan 9b land 전까지는 FEATURE_TECTONIC_COMPILE flag만으로 gate
        if is_pro(params.user_id) and env.FEATURE_TECTONIC_COMPILE:
            pdf_bytes = await post_tectonic(tex, bib, engine="xelatex")
            return await upload_to_r2(pdf_bytes, "pdf", params.run_id)
        else:
            # .tex + .bib 패키지로 zip 다운로드
            return await upload_to_r2(
                zip_tex_package(tex, bib), "zip", params.run_id
            )
    # DOCX / PDF compile은 apps/api에서 처리
    # worker.lib.api_client.post_internal() 재사용 (Code Agent 패턴 동형)
    return await post_internal_compile(params, output)
    # → POST /api/internal/synthesis/compile { runId, format, output }
    # → apps/api: docx npm (DOCX) 또는 Playwright (PDF) 실행 → MinIO PUT → s3_key 반환
```

DOCX / PDF의 실제 compile (`docx` npm / Playwright)은 `apps/api`의 internal 라우트에서 처리. worker는 구조화 JSON을 POST, API가 bytes를 반환.

---

## 5. Citation 시스템

### 포맷별 전략

| 포맷 | 방식 | 강제 여부 |
|---|---|---|
| LaTeX | `\cite{src:abc123}` 본문 삽입 + `.bib` 파일 자동 생성 | 강제 |
| DOCX | 각주 스타일 (`[1] 저자, 제목, URL`) | 강제 |
| MD | 섹션 말미 "**Sources:**" 목록 | 베스트에포트 |
| PDF | MD와 동일 | 베스트에포트 |

### BibTeX 생성 규칙

```
cite_key = "src:{source_id[:8]}"   # 예: src:a3f2b1c9

@article{src:a3f2b1c9,
  author  = {저자명},
  title   = {제목},
  year    = {연도},
  url     = {URL},
  note    = {OpenCairn source: {source_id}}
}
```

### Traceability DB 저장

`synthesis_sources` 테이블이 소스 메타데이터를 보관. 각 섹션의 `source_ids`는 `synthesis_sources.id`를 참조 — hover-to-source 기능 기반 (v2에서 UI 연결).

---

## 6. API Surface

```
apps/api/src/routes/synthesis.ts

POST   /api/synthesis/run
  body: {
    workspaceId: uuid,
    projectId?: uuid,
    format: "latex" | "docx" | "pdf" | "md",
    template: "ieee" | "acm" | "apa" | "korean_thesis" | "report",
    userPrompt: string,           // max 4000 chars
    explicitSourceIds: uuid[],    // S3 object IDs
    noteIds: uuid[],              // 명시 선택 노트
    autoSearch: boolean,
  }
  → 200 { runId: uuid }

GET    /api/synthesis/runs/:runId/stream
  → text/event-stream (SSE, 아래 이벤트 목록)

GET    /api/synthesis/runs
  → 유저 synthesis 목록 (pagination)

GET    /api/synthesis/runs/:runId
  → 상태 + 소스 목록 + 문서 메타

GET    /api/synthesis/runs/:runId/document?format=docx
  → 302 redirect to R2 signed URL

POST   /api/synthesis/runs/:runId/resynthesize
  body: { userPrompt: string }
  → 200 { runId: uuid }  (새 run 생성)

DELETE /api/synthesis/runs/:runId
  → 204 (workflow cancel + 정리)

# Internal (worker → api)
POST   /api/internal/synthesis/compile
  body: { runId, format, output: SynthesisOutputSchema }
  → 200 { s3Key }
```

**SSE 이벤트** (DR / Code Agent와 동형):

| 이벤트 | payload |
|---|---|
| `queued` | `{ runId }` |
| `fetching_sources` | `{ count }` |
| `synthesizing` | `{ thought? }` |
| `compiling` | `{ format }` |
| `done` | `{ docUrl, format, sourceCount, tokensUsed }` |
| `error` | `{ code }` |

---

## 7. DB Schema

```sql
-- packages/db/drizzle/0026_synthesis.sql

CREATE TABLE synthesis_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  user_id         text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  format          text NOT NULL,
    -- latex | docx | pdf | md
  template        text NOT NULL,
    -- ieee | acm | apa | korean_thesis | report
  user_prompt     text NOT NULL,
  auto_search     boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending',
    -- pending | fetching | synthesizing | compiling | completed | failed | cancelled
  workflow_id     text,
  tokens_used     integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX synthesis_runs_workspace_idx
  ON synthesis_runs(workspace_id, created_at DESC);
CREATE INDEX synthesis_runs_user_idx
  ON synthesis_runs(user_id, created_at DESC);

CREATE TABLE synthesis_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES synthesis_runs(id) ON DELETE CASCADE,
  source_type text NOT NULL,
    -- s3_object | note | dr_result
  source_id   uuid NOT NULL,
  title       text,
  token_count integer,
  included    boolean NOT NULL DEFAULT true
    -- false: 토큰 예산 초과로 제외됨
);

CREATE TABLE synthesis_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES synthesis_runs(id) ON DELETE CASCADE,
  format      text NOT NULL,
    -- latex | docx | pdf | md | bibtex | zip
  s3_key      text,
  bytes       integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- BibTeX는 별도 row: format='bibtex'
-- LaTeX 패키지(.tex+.bib zip)는 format='zip'
```

Drizzle 정의: `packages/db/src/schema/synthesis.ts`

---

## 8. Frontend

### 진입점

App Shell 사이드바 또는 에이전트 패널 → `/synthesis` 라우트.

### SynthesisPanel 레이아웃

```
┌─ Synthesis Export ─────────────────────────────────┐
│                                                     │
│  [LaTeX ▾] [Korean Thesis ▾]   ← 포맷 + 템플릿     │
│                                                     │
│  📎 소스 (3개 선택됨)            ← 명시 선택        │
│  ├ 논문_A.pdf              [×]                      │
│  ├ DR: 양자컴퓨팅 연구      [×]                      │
│  └ 노트: 실험 결과 정리     [×]   [+ 추가]           │
│                                                     │
│  [☑] 관련 노트 자동 포함        ← auto_search 토글  │
│  ⚠️ 추정 180K / 180K 토큰                           │
│                                                     │
│  프롬프트 ─────────────────────────────────────     │
│  │ IEEE 형식으로 서론과 관련연구 섹션 먼저 작성해줘  │
│  └─────────────────────────────────────────────    │
│                                [합성 시작 ▶]        │
│                                                     │
│  ── 결과 ───────────────────────────────────────    │
│  ✅ 완료 · 7개 소스 · 12,430 토큰 사용               │
│  [.tex 다운로드] [PDF ✦Pro] [DOCX] [MD]             │
│                                                     │
│  💬 "서론을 더 길게 써줘" → [재합성]                 │
└─────────────────────────────────────────────────────┘
```

### 컴포넌트 구조

```
apps/web/src/components/synthesis/
  SynthesisPanel.tsx          — 메인 컨테이너
  SourcePicker.tsx            — 파일/노트/DR 결과 선택
  TokenBudgetBar.tsx          — 실시간 토큰 추정치
  FormatSelector.tsx          — 포맷 + 템플릿 드롭다운
  SynthesisProgress.tsx       — SSE 진행 표시
  SynthesisResult.tsx         — 다운로드 링크 + 재합성 입력
```

### 훅

- `useSynthesisStream(runId)` — EventSource 래핑. Code Agent 훅(`useCodeAgentStream`) 동형
- `useSynthesisSources()` — 소스 picker 상태 관리

### Pro 게이트 (LaTeX → PDF)

"PDF ✦Pro" 버튼: Pro 플랜 + `FEATURE_TECTONIC_COMPILE` 환경변수 ON일 때만 활성. 비활성 시 클릭하면 "`.tex` 다운로드 후 Overleaf에서 컴파일하세요" 툴팁.

---

## 9. Tectonic MSA (Pro)

```
apps/tectonic/
  Dockerfile      # debian:slim + tectonic binary + xelatex + kotex + NanumGothic
  server.py       # FastAPI thin wrapper
  cache/          # bind-mount CTAN 패키지 캐시 (volume)
```

**한글 핵심**: `xelatex` 엔진 + `kotex` 패키지. pdflatex는 한글 미지원. NanumGothic / NanumMyeongjo TTF를 이미지에 번들.

**API**:

```
POST /compile
Content-Type: application/json
{
  "tex_source": "\\documentclass...",
  "bib_source": "@article{...}",   // optional
  "engine": "xelatex",             // 한글 학위논문 기본값
  "timeout_ms": 60000
}
→ 200 application/pdf
→ 400 { "error": "...", "log": "..." }
→ 504 { "error": "timeout" }
```

**보안**:
- `--untrusted` 플래그 (shell escape `\write18` 차단)
- 네트워크 격리 — CTAN 미러 egress만 허용
- 입력 2MB 제한, 비루트 사용자 실행
- 프로세스 kill로 `timeout_ms` 강제

**Docker compose**:

```yaml
services:
  tectonic:
    build: ./apps/tectonic
    restart: unless-stopped
    networks: [opencairn-internal]
    volumes:
      - tectonic-cache:/app/cache
    environment:
      MAX_CONCURRENT_COMPILES: 4
      DEFAULT_TIMEOUT_MS: 60000
    profiles: ["pro"]   # docker-compose --profile pro up

volumes:
  tectonic-cache:
```

`profiles: ["pro"]` — 셀프호스터 기본 compose 제외, Pro 옵션으로 명시.

---

## 10. Korean Thesis Templates

v1 번들 템플릿 4종:

| 키 | 설명 | LaTeX 클래스 |
|---|---|---|
| `korean_thesis` | 일반 한국 학위논문 | `\documentclass[12pt]{report}` + kotex |
| `ieee` | IEEE 학술 논문 | `\documentclass{IEEEtran}` |
| `acm` | ACM 학술 논문 | `\documentclass{acmart}` |
| `report` | 일반 보고서 | `\documentclass[a4paper]{article}` |

**Korean Thesis 생성 구조** (프롬프트 주입):

```
표지: 논문 제목 / 저자 / 지도교수 / 학과 / 대학교 / 제출연도
초록 (한국어, 500자 이내) + Abstract (영어)
목차 / 그림목차 / 표목차 (자동 생성)
제1장 서론
  1.1 연구 배경 및 필요성
  1.2 연구 목적
  1.3 논문 구성
제N장 관련 연구
제N장 제안 방법 (사용자 프롬프트에 따라 동적)
제N장 실험 및 결과
제N장 결론
참고문헌 (BibTeX 자동 생성)
```

**v2 로드맵**: 사용자 `.cls` 파일 업로드 → Tectonic에 번들해 컴파일.

---

## 11. Billing 라우팅

`docs/architecture/billing-routing.md` chat 정책 준수:

| 단계 | LLM 사용 | 키 소스 |
|---|---|---|
| `fetch_sources_activity` | 없음 | — |
| `synthesize_activity` | 고단가 (수십~수백K 토큰) | BYOK 우선 → 크레딧 → Admin 폴백 |
| `compile_activity` (docx/Playwright/Tectonic) | 없음 | — |

**BYOK 없이 합성 요청 시**: 게이팅 금지 (`feedback_byok_cost_philosophy`). 크레딧 또는 Admin 키로 처리, UI에 "이 요청은 [크레딧/Admin]으로 처리됨" 토스트 표시.

**토큰 경고 UX**: `TokenBudgetBar` 컴포넌트 — 소스 선택 시 실시간 추정치 표시. 180K 초과 시 "일부 소스가 자동으로 제외될 수 있습니다" 경고.

---

## 12. Testing

| 레이어 | 테스트 | 형태 |
|---|---|---|
| `packages/shared` | `synthesis-types.ts` Zod 스키마 | parse/safeParse 양·음성 |
| `packages/db` | 3테이블 schema | Drizzle round-trip |
| `apps/api` | `routes/synthesis.ts` | 권한, Zod 거부, SSE 형태, Pro 게이트 |
| `apps/api` | `lib/document-compilers/` | DOCX/PDF compile 단위 테스트 |
| `apps/worker` | `SynthesisWorkflow` | Temporal time_skipping, LLM mock, S3 mock |
| `apps/worker` | `fetch_sources_activity` | 명시/자동/예산 초과 경로 |
| `apps/worker` | `synthesize_activity` | 포맷별 출력 스키마 검증 |
| `apps/worker` | `compile_activity` | Tectonic mock, docx mock |
| `apps/worker` | `SynthesisAgent` | citation 강제 (LaTeX), 베스트에포트 (MD) |
| `apps/tectonic` | golden `.tex` → PDF (`%PDF-` 검증) | integration |
| `apps/web` | `SynthesisPanel`, `useSynthesisStream` | RTL + msw EventSource mock |

목표: api 30 + worker 40 + web 25 + shared/db 5 = **약 100개 추가**.

---

## 13. i18n

`apps/web/messages/{ko,en}/synthesis.json` 신규:

```
synthesis.panel.{title, format, template, sources, autoSearch,
                 prompt, placeholder, start, resynthesize}
synthesis.status.{pending, fetching, synthesizing, compiling,
                  completed, failed, cancelled}
synthesis.download.{tex, pdf, docx, md, pdfProOnly, overleafTip}
synthesis.sources.{add, remove, drResult, note, file,
                   tokenBudgetExceeded, autoIncluded}
synthesis.errors.{noSources, promptRequired, tooManyTokens,
                  compileFailed, proRequired, workflowFailed}
synthesis.templates.{ieee, acm, apa, korean_thesis, report}
synthesis.token.{estimated, exceeded, unit}
```

`pnpm --filter @opencairn/web i18n:parity` CI gate 준수.

---

## 14. Feature Flags

| Flag | 기본값 | 영향 |
|---|---|---|
| `FEATURE_SYNTHESIS` | `false` | `/api/synthesis/*` + SynthesisPanel 노출. dev/staging 만 `true` |
| `FEATURE_TECTONIC_COMPILE` | `false` | LaTeX → PDF Pro 경로. Tectonic 컨테이너 + Pro 플랜 필요 |

---

## 15. Confirmed Decisions

1. ✅ Plan 10 (2026-04-15) superseded. Tectonic MSA / skill registry 재설계.
2. ✅ Plan 10B 인라인 블록은 별도 소형 plan 분리.
3. ✅ 문서 컴파일: Pyodide 미사용. LLM 생성 JSON → 서버 `docx` npm / Playwright.
4. ✅ LaTeX PDF: Tectonic MSA (Pro 전용, xelatex + kotex).
5. ✅ 소스 수집: 명시 선택 + 자동 검색 병존.
6. ✅ 합성 방식: one-shot. 재합성은 사용자 채팅 재요청.
7. ✅ Citation: LaTeX/DOCX 강제 traceability, MD/PDF 베스트에포트.
8. ✅ PPTX MVP 제외, v2 추가.
9. ✅ `runtime.Agent` 패턴 채택 (Code Agent / Deep Research 동형).
10. ✅ Temporal SynthesisWorkflow (3 activities: fetch → synthesize → compile).
11. ✅ BYOK 게이팅 금지 (`feedback_byok_cost_philosophy` 준수).
12. ✅ v1 템플릿 4종 고정, `.cls` 업로드는 v2.

---

## 16. Open Questions (구현 plan 단계)

- **Q1**: `docx` npm 한글 폰트 embedding — 서버에 NanumGothic TTF 등록 방식 확정 필요.
- **Q2**: Playwright 이미지 의존성 — `apps/api`에 이미 Playwright headless chrome이 있으면 재사용, 없으면 추가.
- **Q3**: `fetch_sources_activity`에서 DR 결과(`research_runs`) 접근 — `/api/internal/research/:id/content` 라우트 필요 여부.
- **Q4**: 토큰 추정 UI — 클라이언트 사이드 approximation 충분한지, 아니면 `/api/synthesis/estimate-tokens` 엔드포인트 필요한지.
- **Q5**: Tectonic CTAN 패키지 캐시 cold start — 첫 컴파일에 분 단위 소요 가능. 워밍 전략 (사전 pull 스크립트 또는 pre-built 이미지) 필요.
- **Q6**: `is_pro()` 구현 — Plan 9b 미구현 시점에서 Pro gate 판정 방법. `FEATURE_TECTONIC_COMPILE` flag만으로 임시 gate, Plan 9b land 후 실제 tier 체크로 교체.

---

*End of spec.*
