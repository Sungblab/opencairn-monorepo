# Plan 10: Document Skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Reference spec:** [2026-04-15-document-skills-design.md](../specs/2026-04-15-document-skills-design.md). 이 plan은 spec을 구현 가능한 단계로 나눈 것이다.
>
> **Prerequisites (2026-04-20 명확화):**
> - **필수**: Plan 4 (agent core — `packages/llm` · Compiler/Research/Librarian) + Plan 6 (learning system — `packages/templates` · Socratic) + Plan 8 (remaining agents, 특히 Deep Research). 본 plan의 meta-skill(`deep_research_paper`, `study_pack_generator`)은 Plan 4/6/8의 결과물을 직접 호출한다.
> - **무관**: Plan 9 billing infrastructure. Plan 9 (특히 결제 레일 Task 1/4+)가 BLOCKED 상태여도 Plan 10은 진행 가능. 문서 생성 기능 자체는 plan 한도(Task 3) 또는 PAYG 크레딧 차감(Task 3.5)의 gate 아래에서 동작하지만, 그 gate는 Plan 9의 provider-agnostic core만으로 충족된다.
> - **권장 실행 순서**: Plan 4 → Plan 6 → Plan 8 → **Plan 10** (Plan 9는 병렬 가능). Plan 5/7 완료도 권장되나 hard-dependency 아님 (KG 앵커 UX는 Plan 5 이후 더 풍부해짐).

**Goal:** 사용자의 KG를 소재로 LaTeX 논문/DOCX 보고서/HTML·PPTX 슬라이드/PDF/Anki 덱 등을 생성하는 composable document skill layer. 각 skill은 LangGraph 에이전트가 호출하는 primitive이고, `deep_research_paper`와 `study_pack_generator`는 다른 skill을 체이닝하는 meta-skill.

**Architecture (요약):**

```
Python Worker (에이전트 + Skill Runtime)
    ├── Skill 선택 (SkillSelector)  — frontmatter로 매칭
    ├── prompt 실행 → Pydantic 검증된 JSON/문자열 출력
    └── source_node_ids[] 태깅 (KG 앵커)
        │
        ▼ 구조화된 output
apps/api의 document-compilers:
    ├── LaTeX → apps/tectonic/ Rust MSA → PDF
    ├── DOCX  → `docx` npm (in-process)  → .docx
    ├── HTML  → passthrough              → HTML
    ├── PPTX  → pptxgenjs (in-process)   → .pptx
    ├── PDF   → Playwright headless chrome → PDF
    └── Anki  → better-sqlite3 + archiver → .apkg
        │
        ▼ upload
    Cloudflare R2 → signed URL → apps/web/(app)/studio/ UI (Monaco + preview)
```

**Tech Stack:** Python 3.12, LangGraph 0.3+, packages/templates (확장), Hono 4, `docx@8+`, `pptxgenjs@3+`, `pdf-lib@1.17+`, `better-sqlite3@11+`, `archiver@7+`, Playwright (headless chrome), Rust Tectonic (Docker MSA), Zod 3.24+, Temporal Python SDK (fork mode child workflow).

---

## File Structure

```
apps/
  tectonic/                        # 신규 Rust MSA (LaTeX compile)
    Dockerfile                     # multi-stage: cargo build → slim runtime
    src/main.rs                    # axum 서버 + /compile, /health
    Cargo.toml

  api/src/
    routes/
      documents.ts                 # POST /documents/compile, GET /documents/:id, GET /documents/:id/download
      skills.ts                    # GET /skills (lazy-loaded metadata)
    lib/
      document-compilers/
        docx.ts                    # docx npm wrapper
        pptx.ts                    # pptxgenjs wrapper
        pdf.ts                     # Playwright headless
        anki.ts                    # better-sqlite3 + archiver
        tectonic-client.ts         # fetch to apps/tectonic/

  worker/src/worker/
    skills/
      runtime.py                   # SkillRuntime: 매칭, 실행, fork 분기
      selector.py                  # 에이전트가 when_to_use로 매칭
    workflows/
      document_workflows.py        # deep_research_paper, study_pack_generator (fork mode)
    agents/
      document_agent/              # 기본 document agent (generic skills 호출)
        __init__.py
        state.py
        graph.py

  web/src/app/(app)/studio/
    page.tsx                       # Document Studio 진입
    [documentId]/page.tsx          # Monaco + preview pane
    components/
      SkillPicker.tsx
      DocumentEditor.tsx           # Monaco 통합
      PreviewPane.tsx              # PDF/HTML iframe

packages/
  templates/
    src/
      types.ts                     # Skill 타입 확장 (context, allowed_tools, compile_step)
      runtime.ts                   # skill loader (bundled/user/plugin 계층)
      schemas/output/              # Zod 스키마 (per skill)
        latex_paper.ts
        docx_report.ts
        html_slides.ts
        pptx_download.ts
        pdf_freeform.ts
        review_document.ts
        pdf_form_fill.ts
        bibtex_from_kg.ts
        anki_deck_export.ts
      templates/output/            # JSON frontmatter + prompt body
        latex_paper.md
        docx_report.md
        ...

  db/src/schema/
    documents.ts                   # 신규 테이블
    document_section_sources.ts    # section → source_node_ids M:N
```

---

### Task 1: Extend `packages/templates` with skill metadata

**Files:**
- Modify: `packages/templates/src/types.ts`
- Create: `packages/templates/src/runtime.ts` (loader with bundled/user/plugin precedence)
- Create: `packages/templates/src/schemas/output/*.ts` (11개 Zod 스키마)

- [ ] **Step 1.1: `Skill` 타입 확장** — spec §3.3 그대로. `context`, `allowed_tools`, `compile_step`, `kg_anchored` 필드 추가.
- [ ] **Step 1.2: Lazy loader** — 에이전트 system prompt에는 `{name, description, when_to_use}`만 주입, 본문/스키마는 invocation 시 로드.
- [ ] **Step 1.3: 11개 스킬 프론트매터 JSON + 프롬프트 본문 생성** (`templates/output/*.md`).
- [ ] **Step 1.4: Zod 스키마 11개** (spec §4의 LLM output schema들).
- [ ] **Step 1.5: 단위 테스트** — 스킬 로더가 frontmatter/본문 분리해서 읽는지, precedence(user>plugin>bundled)가 맞는지.
- [ ] **Step 1.6: Commit**

```bash
git add packages/templates/
git commit -m "feat(templates): extend Skill schema for document skills (context, allowed_tools, compile_step, kg_anchored)"
```

---

### Task 2: DB schema (`documents`, `document_section_sources`)

**Files:**
- Create: `packages/db/src/schema/documents.ts`
- Create: `packages/db/src/schema/document_section_sources.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 2.1: `documents` 테이블** (spec §5.1 그대로)
- [ ] **Step 2.2: `document_section_sources` (section id → source_node_ids[])** — KG 앵커 M:N
- [ ] **Step 2.3: `pnpm db:generate`, 마이그레이션 커밋**

```bash
pnpm db:generate
git add packages/db/
git commit -m "feat(db): documents + document_section_sources tables for document skills"
```

---

### Task 3: `apps/tectonic/` Rust MSA (LaTeX compile)

**Files:**
- Create: `apps/tectonic/Cargo.toml`
- Create: `apps/tectonic/src/main.rs` — axum 서버 `POST /compile`, `GET /health`
- Create: `apps/tectonic/Dockerfile` — multi-stage (cargo build → slim runtime + TeX Live 캐시 볼륨)
- Modify: `docker-compose.yml` — `tectonic:` 서비스 추가 (profile: `documents`)

- [ ] **Step 3.1: `POST /compile` — 요청: `{ tex: string }`, 응답: `application/pdf` 바이너리**
- [ ] **Step 3.2: TeX Live 패키지 캐시 볼륨 (`tectonic-cache:/var/lib/tectonic`)**
- [ ] **Step 3.3: compile 타임아웃 120초, source 크기 2MB 상한 (env `MAX_TEX_BYTES`)**
- [ ] **Step 3.4: Dockerfile ARM64 + x86_64 멀티아치 빌드 (`docker buildx`) 확인**
- [ ] **Step 3.5: Health 체크 + Commit**

```bash
git add apps/tectonic/ docker-compose.yml
git commit -m "feat(tectonic): Rust LaTeX compile microservice with Tectonic runtime"
```

---

### Task 4: API — `/documents/compile` 라우트 + in-process compilers

**Files:**
- Create: `apps/api/src/lib/document-compilers/{docx,pptx,pdf,anki,tectonic-client}.ts`
- Create: `apps/api/src/routes/documents.ts`
- Create: `apps/api/src/routes/skills.ts`

- [ ] **Step 4.1: `docx.ts`** — `docx` npm으로 LLM 출력 JSON을 `.docx` Buffer로. 헤딩/문단/각주/참고문헌 지원.
- [ ] **Step 4.2: `pptx.ts`** — `pptxgenjs`로 slide outline JSON → `.pptx`.
- [ ] **Step 4.3: `pdf.ts`** — Playwright 헤드리스 크롬으로 HTML → `.pdf`.
- [ ] **Step 4.4: `anki.ts`** — `better-sqlite3`로 Anki 스키마 DB 작성, `archiver`로 `.apkg` zip.
- [ ] **Step 4.5: `tectonic-client.ts`** — `http://tectonic:3030/compile` POST fetch.
- [ ] **Step 4.6: `/documents/compile` 라우트**

```typescript
// apps/api/src/routes/documents.ts
// POST /api/documents/compile { skillName, llmOutput, userId, projectId }
// → compile → R2 업로드 → documents row insert → signed URL 반환
```

- [ ] **Step 4.7: `/skills` 라우트** — lazy-load 가능한 skill 메타데이터 목록 (에이전트가 system prompt에 주입할 용도).

- [ ] **Step 4.8: Commit**

```bash
git add apps/api/src/lib/document-compilers/ apps/api/src/routes/documents.ts apps/api/src/routes/skills.ts
git commit -m "feat(api): document-compilers (docx/pptx/pdf/anki/tectonic) and /documents/compile route"
```

---

### Task 5: Worker — Skill Runtime + Document Agent

**Files:**
- Create: `apps/worker/src/worker/skills/runtime.py`
- Create: `apps/worker/src/worker/skills/selector.py`
- Create: `apps/worker/src/worker/agents/document_agent/*.py`
- Modify: `apps/worker/src/worker/main.py` — workflow 등록

- [ ] **Step 5.1: `SkillRuntime`** — skill 로드 + LLM 호출 (`get_provider()`) + Pydantic 검증 + `allowed_tools` 제한 적용.
- [ ] **Step 5.2: `SkillSelector`** — agent가 주어진 사용자 요청에서 적합한 skill을 찾는 함수 (frontmatter의 `when_to_use`를 Gemini Flash-Lite로 매칭).
- [ ] **Step 5.3: `document_agent` LangGraph** — select → execute → forward-to-compile → return signed URL.
- [ ] **Step 5.4: KG 앵커** — skill 출력의 `source_node_ids`를 `document_section_sources`에 insert.
- [ ] **Step 5.5: Commit**

```bash
git add apps/worker/src/worker/skills/ apps/worker/src/worker/agents/document_agent/
git commit -m "feat(worker): Skill Runtime + Document Agent (LangGraph, get_provider, KG anchoring)"
```

---

### Task 6: Meta-skills (fork mode — Temporal 자식 워크플로우)

**Files:**
- Create: `apps/worker/src/worker/workflows/document_workflows.py`
- Modify: `apps/api/src/routes/documents.ts` — `POST /documents/meta-skill/run`

- [ ] **Step 6.1: `DeepResearchPaperWorkflow`**
  1. `deep_research` child workflow (Plan 8) invoke + result wait
  2. `latex_paper` skill 실행
  3. `review_document` skill N회 반복 (early-exit `score >= 9`)
  4. 최종 `.tex` tectonic compile → R2
  5. Signal 수신 가능: `approve_research`, `approve_draft`, `approve_review_round`, `abort`

- [ ] **Step 6.2: `StudyPackGeneratorWorkflow`**
  1. 병렬로 `cheatsheet` + `flashcards` + `quiz` (Plan 6 템플릿) + `html_slides` (본 plan)
  2. 결과 manifest 생성, R2 업로드
  3. 반환 시 artifact별 signed URL 포함

- [ ] **Step 6.3: API 라우트** — `POST /documents/meta-skill/run` + `POST /documents/meta-skill/signal`
- [ ] **Step 6.4: Commit**

```bash
git add apps/worker/src/worker/workflows/document_workflows.py apps/api/src/routes/documents.ts
git commit -m "feat(documents): meta-skills (deep_research_paper, study_pack_generator) as Temporal child workflows"
```

---

### Task 7: Document Studio UI (Monaco + preview)

**Files:**
- Create: `apps/web/src/app/(app)/studio/page.tsx`
- Create: `apps/web/src/app/(app)/studio/[documentId]/page.tsx`
- Create: `apps/web/src/app/(app)/studio/components/{SkillPicker,DocumentEditor,PreviewPane}.tsx`

- [ ] **Step 7.1: `/studio` 진입 — skill 목록 표시 + "새 문서 만들기" 폼**
- [ ] **Step 7.2: Monaco Editor로 LaTeX/HTML 소스 편집 (수정 → 재컴파일)**
- [ ] **Step 7.3: PreviewPane — PDF는 react-pdf-viewer/iframe, HTML은 iframe (sandbox="allow-scripts"), PPTX/DOCX는 download 버튼만**
- [ ] **Step 7.4: 각 section 호버 시 source_node_ids[] 해당 KG 노드 하이라이트 (KG 앵커 UX)**
- [ ] **Step 7.5: Commit**

```bash
git add apps/web/src/app/\(app\)/studio/
git commit -m "feat(studio): Monaco-based Document Studio with hover-to-KG source traceability"
```

---

### Task 8: `pdf_form_fill` 특화 — `pdf-lib` 기반 폼 자동 채우기

**Files:**
- Create: `apps/api/src/lib/document-compilers/pdf-form.ts`
- Modify: `apps/api/src/routes/documents.ts` — `POST /documents/form-fill`

- [ ] **Step 8.1: 업로드된 블랭크 폼 PDF에서 `pdf-lib`로 form field 추출**
- [ ] **Step 8.2: Agent가 KG에서 값 매핑 생성 (`{field_name: value}`)**
- [ ] **Step 8.3: `pdf-lib`로 값 주입 + (옵션) flatten**
- [ ] **Step 8.4: R2 저장 + signed URL 반환**
- [ ] **Step 8.5: Commit**

---

### Task 9: BibTeX Integration (`bibtex_from_kg` + latex_paper 연동)

- [ ] **Step 9.1: `bibtex_from_kg` skill 구현** — project의 source 노트들 → BibTeX 엔트리.
- [ ] **Step 9.2: cite key format: `kg:{short_node_id}` — stable**
- [ ] **Step 9.3: `latex_paper` skill에서 `\cite{kg:abc123}` 자동 resolve**
- [ ] **Step 9.4: Commit**

---

### Task 10: Env Vars + 문서 업데이트

```bash
# 문서 스킬 관련 env
TECTONIC_URL=http://tectonic:3030
MAX_TEX_BYTES=2097152                # 2MB
MAX_DOCUMENT_COMPILE_TIMEOUT_MS=120000
PLAYWRIGHT_HEADLESS=true
DOCUMENT_ARTIFACT_PREFIX=documents/
```

- [ ] **Step 10.1: `.env.example` 업데이트**
- [ ] **Step 10.2: `docs/architecture/api-contract.md`에 `/api/documents/*`, `/api/skills` 추가**
- [ ] **Step 10.3: `docs/contributing/dev-guide.md` 프로젝트 구조에 `apps/tectonic/`, `apps/web/(app)/studio/` 추가**
- [ ] **Step 10.4: Commit**

---

## Verification

- [ ] `POST /api/documents/compile` with skillName=`latex_paper` → tectonic compile 성공 → PDF R2 저장 → signed URL 반환
- [ ] `POST /api/documents/compile` with `docx_report` → `.docx` 다운로드 가능, MS Word에서 열림
- [ ] `POST /api/documents/compile` with `pptx_download` → `.pptx` 다운로드, Keynote/PowerPoint에서 열림
- [ ] `POST /api/documents/compile` with `pdf_freeform` → Playwright 헤드리스가 HTML→PDF 변환
- [ ] `POST /api/documents/compile` with `anki_deck_export` → `.apkg` Anki 앱에서 import 가능
- [ ] `deep_research_paper` meta-skill — Temporal workflow가 child workflow 3개 실행 (research / write / review)
- [ ] `study_pack_generator` — 병렬 실행으로 cheatsheet/flashcards/quiz/slides 동시 생성
- [ ] `pdf_form_fill` — 정부 폼 샘플 PDF 업로드 → KG에서 값 자동 채움 → 새 PDF 생성
- [ ] Document Studio UI에서 LaTeX 편집 → 재컴파일 버튼 → 10초 이내 미리보기 갱신
- [ ] Section 호버 시 source_node_ids[] 해당 KG 노드 사이드 패널에 표시 (KG 앵커)
- [ ] `X-Internal-Secret` 보호된 `/documents/compile` — 워커에서만 호출 가능
- [ ] Tectonic 컴파일 2MB 초과 시 413 반환
- [ ] BibTeX cite key `kg:abc123`이 compile된 PDF에서 정상 reference
- [ ] Ollama provider로 운영 시 Deep Research 경로는 ground_search fallback 동작

---

## Summary

| Task | Deliverable |
|------|------------|
| 1 | packages/templates 확장 (context/allowed_tools/compile_step + 11 skill 정의) |
| 2 | documents + document_section_sources 스키마 + 마이그레이션 |
| 3 | apps/tectonic/ Rust MSA (LaTeX compile) |
| 4 | apps/api document-compilers + `/documents/compile` + `/skills` |
| 5 | Worker Skill Runtime + Document Agent (LangGraph) |
| 6 | Meta-skills (deep_research_paper, study_pack_generator) — Temporal fork |
| 7 | Document Studio UI (Monaco + preview, KG 앵커) |
| 8 | pdf_form_fill (pdf-lib 기반) |
| 9 | BibTeX integration (`bibtex_from_kg` + cite key resolve) |
| 10 | Env + 문서 업데이트 |

**구현 순서 권장**: 1 → 2 → 4(in-process compilers part) → 5 → 3(Tectonic 추가) → 4 완성 → 7 → 6 → 8 → 9 → 10.
