# Content-Aware Enrichment — Spec B

**Status:** Draft (2026-04-27)
**Owner:** Sungbin
**Related:**

- [data-flow.md](../../architecture/data-flow.md) — ingest → wiki 전체 흐름
- [2026-04-22-deep-research-integration-design.md](./2026-04-22-deep-research-integration-design.md) — `generate_multimodal` 패턴 참고
- [agent-runtime-standard-design.md](./2026-04-20-agent-runtime-standard-design.md) — worker activity 등록 패턴
- **세션 A (Live Ingest UI)** — enrichment artifact를 SSE로 스트리밍하는 UI 레이어 (본 spec 범위 밖)
- **세션 E (Literature Search)** — 파일을 ingest에 전달하는 역할만. 검출/enrichment는 본 spec.
- **세션 F (Synthesis Export)** — 본 spec의 artifact를 소비만 함. export는 본 spec 범위 밖.

---

## 1. Problem

현재 ingest 파이프라인은 모든 파일을 "텍스트 덩어리"로 동일하게 처리한다.

- `pdf_activity.py`: opendataloader-pdf로 `pages[].text` 추출. `--extract-images=false`라 figure 없음. heading/section 정보 미사용.
- `enhance_activity.py`: 50K char truncate 후 단일 LLM 호출 → 개선된 마크다운 반환. 컨텐츠 타입 인식 없음.
- 결과: 논문, 슬라이드, 책, 코드 노트북이 모두 구별 없는 flat text로 저장됨.

"내 자료를 가장 잘 소화시키는 곳"을 표방하는 OpenCairn에서, 자료의 구조와 의미를 이해하는 enrichment 레이어가 필요하다.

---

## 2. Goals & Non-Goals

### Goals (MVP)

- 모든 업로드 파일에 **컨텐츠 타입 자동 검출** 적용 (7종: document / paper / slide / book / code / table / image)
- 타입별 **구조화 artifact** 생성 → `note_enrichments` 테이블에 저장
- downstream 세션 A(UI), F(합성 export), Plan 5(KG)가 소비할 수 있는 **안정적 artifact 스키마** 정의
- Gemini + Ollama **양쪽 provider 지원** (Ollama는 기능 제한 + skip_reason 기록)
- enrichment 실패 시 **note 생성은 계속 진행** (best-effort)
- `FEATURE_CONTENT_ENRICHMENT` feature flag로 게이팅

### Non-Goals

- SSE 스트리밍 / enrichment 진행 UI — 세션 A 담당
- Export 합성 — 세션 F 담당
- Citation graph 실제 파싱/DOI 조회 — 스키마 슬롯만 예약, 구현 follow-up
- OCR (스캔 PDF) — 기존 `is_scan` flag + TODO 유지
- PPTX 이외 슬라이드 포맷 (Keynote, ODP)
- 번역 언어 ko 외 추가

---

## 3. Architecture

```
ingest_workflow.py
  │
  ├─ parse_pdf / scrape_web_url / ...  (기존 parse activities)
  │
  ├─ [NEW] detect_content_type        ← 가볍고 빠름, 결정론적 or 소형 LLM
  │
  ├─ [NEW] enrich_document            ← 타입 분기 내부 처리, best-effort
  │         │
  │         ├─ Gemini: generate_multimodal(pdf_bytes=) — 전체 PDF
  │         └─ Ollama: 대표 청크(첫/중간/끝 각 15K) text-only
  │
  ├─ [NEW] store_enrichment_artifact  ← note_enrichments INSERT
  │
  ├─ enhance_with_gemini              (기존 유지 — 본문 텍스트 품질 개선용)
  │
  └─ create_source_note               (기존 유지)
```

`enhance_with_gemini`와 `enrich_document`는 **목적이 다르다.**

| | enhance_with_gemini | enrich_document |
|---|---|---|
| 목적 | note 본문 텍스트 품질 개선 (표 마크다운화, 수식 LaTeX) | 구조화 artifact 생성 (outline, sections, slides 등) |
| 출력 | 개선된 markdown 문자열 | jsonb artifact → note_enrichments |
| 실패 시 | note 텍스트 = raw text | artifact 없음, note는 정상 저장 |

---

## 4. DB 스키마

### 4.1 `note_enrichments` 테이블

```sql
CREATE TABLE note_enrichments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id),
  content_type  TEXT NOT NULL,   -- 'document'|'paper'|'slide'|'book'|'code'|'table'|'image'
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'processing'|'done'|'failed'
  artifact      JSONB,
  provider      TEXT,            -- 'gemini'|'ollama' (기록용)
  skip_reasons  TEXT[],          -- e.g. ['translation_provider_unsupported']
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX note_enrichments_note_id_idx ON note_enrichments(note_id);
CREATE INDEX note_enrichments_workspace_id_idx ON note_enrichments(workspace_id);
```

`status` 전이: `pending → processing → done | failed`

### 4.2 `artifact` JSONB 스키마

공통 필드 + 타입별 선택 필드. 미적용 필드는 키 생략 (null 저장 안 함).

```jsonc
{
  // ── 공통 (모든 타입) ──────────────────────────────
  "outline": [
    { "level": 1, "title": "Introduction", "page": 3 }
  ],
  "figures": [
    {
      "page": 5,
      "caption": "Fig 1. System Architecture",
      "object_key": "enrichments/<ws_id>/<note_id>/fig-0.png"
    }
  ],
  "tables": [
    { "page": 7, "caption": "Table 1. Results", "markdown": "| col1 | col2 |\n|---|---|" }
  ],
  "translation": {
    "lang": "ko",
    "text": "..."
  },                          // null if skipped
  "word_count": 12400,

  // ── paper only ────────────────────────────────────
  "sections": {
    "abstract":      "...",
    "introduction":  "...",
    "methods":       "...",
    "results":       "...",
    "discussion":    "...",
    "conclusion":    "...",
    "references_raw": "..."   // 원문 텍스트, 파싱은 follow-up
  },
  "citations": [],            // 슬롯 예약 — DOI 파싱 구현은 follow-up

  // ── slide only ────────────────────────────────────
  "slides": [
    { "index": 1, "title": "Intro", "body": "...", "notes": "..." }
  ],

  // ── book only ─────────────────────────────────────
  "chapter_tree": [
    {
      "title": "Chapter 1. Background",
      "page": 10,
      "children": [
        { "title": "1.1 Overview", "page": 12, "children": [] }
      ]
    }
  ],

  // ── code / notebook only ──────────────────────────
  "symbol_tree": [
    { "kind": "function", "name": "train_model", "line": 42, "docstring": "..." },
    { "kind": "class",    "name": "Trainer",      "line": 10, "docstring": "..." }
  ],

  // ── table-heavy only ──────────────────────────────
  "pivot_suggestions": [
    { "rows": ["date", "region"], "values": ["revenue"], "agg": "sum" }
  ]
}
```

---

## 5. 컨텐츠 타입 검출

### 5.1 Activity

```python
@activity.defn(name="detect_content_type")
async def detect_content_type(inp: dict) -> dict:
    """
    returns: {
      "content_type": "paper",   # 7종 중 하나
      "confidence": 0.92,
      "used_llm": False
    }
    """
```

### 5.2 결정론적 휴리스틱 (우선 적용)

| 우선순위 | 시그널 | → content_type | confidence |
|---|---|---|---|
| 1 | MIME = `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `slide` | 1.0 |
| 2 | MIME = `text/x-python` \| `application/x-ipynb+json` | `code` | 1.0 |
| 3 | MIME = `image/*` | `image` | 1.0 |
| 4 | 첫 3페이지에 "Abstract", "Keywords" 중 2개+ AND ("doi" OR "arxiv" OR "journal") | `paper` | 0.92 |
| 5 | 페이지 수 > 80 AND 첫 10페이지에 목차 키워드("Table of Contents", "목차", "Contents") | `book` | 0.88 |
| 6 | 전체 페이지의 60%+ 에 `pages[].tables` 존재 | `table` | 0.85 |
| 7 | 나머지 | `document` | 0.75 |

복수 시그널 충돌(예: paper 시그널 + book 시그널 동시) → confidence 0.5 이하 → LLM fallback.

### 5.3 LLM Fallback (confidence < 0.7)

모델: `gemini-flash-lite` (비용 최소화). 입력: 첫 3페이지 텍스트 3000자.

```
Classify this document. Reply with exactly one word:
paper | slide | book | code | table | document
---
{first_3_pages_text}
```

LLM 응답이 7종 외 값이면 `document` fallback.

---

## 6. Enrichment Activity

### 6.1 Activity

```python
@activity.defn(name="enrich_document")
async def enrich_document(inp: dict) -> dict:
    """
    inp: {
      object_key, mime_type, content_type,
      parsed_pages,   # opendataloader pages[] 그대로
      note_id, workspace_id,
      requested_enrichments: list[str]  # ['outline','figures','translation',...]
    }
    returns: {
      artifact: {...},
      provider: "gemini" | "ollama",
      skip_reasons: [...]
    }
    """
```

### 6.2 타입별 처리 매트릭스

| content_type | Gemini 경로 | Ollama fallback |
|---|---|---|
| `document` | `generate_multimodal(pdf_bytes=)` → outline + figures + tables | 대표 청크(첫/중간/끝 각 15K) → outline만 |
| `paper` | multimodal → 섹션 자동 라벨링 (Abstract → References) | 대표 청크 → sections (품질 저하, `skip_reasons` 기록 안 함 — 단순 품질 차이) |
| `slide` | `parsed_pages[]` 텍스트 → 슬라이드 카드 (LLM 없음, 구조 단순) | 동일 |
| `book` | multimodal → chapter_tree 추출 | 첫 10페이지 텍스트 → chapter_tree (목차 페이지만) |
| `code` | 텍스트 → symbol_tree (regex/AST, LLM 불필요) | 동일 |
| `table` | multimodal → markdown 재구성 + pivot_suggestions | 텍스트 테이블만, pivot 없음 |
| `image` | `generate_multimodal(image_bytes=)` → `outline[0].title` + figures | `skip_reasons: ["image_provider_unsupported"]` |

### 6.3 Figure 추출

**`pdf_activity.py` 변경 필요:** `--extract-images=false` → `--extract-images=true`. `parse_pdf` 반환값에 `pages[i].figures[j].image_data` (base64) 포함.

opendataloader 호출 시 `--extract-images=true`로 변경.

```
pages[i].figures[j].image_data  (base64)
  → MinIO upload: enrichments/<workspace_id>/<note_id>/fig-<i>-<j>.png
  → artifact.figures[].object_key 기록
```

figure가 0개인 문서는 `artifact.figures = []` (빈 배열).

### 6.4 번역

```python
if "translation" in requested_enrichments:
    if provider_name == "ollama":
        skip_reasons.append("translation_provider_unsupported")
        artifact["translation"] = None
    else:
        ko_text = await provider.generate([{
            "role": "user",
            "content": f"다음 영어 텍스트를 한국어로 번역해:\n\n{source_text[:30_000]}"
        }])
        artifact["translation"] = {"lang": "ko", "text": ko_text}
```

번역 소스: `sections.abstract` (paper) → `outline` 텍스트 (document) 순으로 우선.

---

## 7. Workflow 통합

### 7.1 변경 사항

`ingest_workflow.py`에 enrichment 3개 activity 삽입. `enhance_with_gemini`는 기존 위치 유지.

```python
async def _run_pipeline(self, inp: IngestInput) -> str:
    # ... 기존 parse activity 호출 ...

    # [NEW] enrichment compute — note_id가 아직 없으므로 결과만 메모리에 보관
    enrich_result: dict | None = None
    if os.environ.get("FEATURE_CONTENT_ENRICHMENT") == "true":
        try:
            ct_result = await workflow.execute_activity(
                "detect_content_type",
                {"object_key": inp.object_key, "mime_type": inp.mime_type,
                 "parsed_pages": parse_result.get("pages", [])},
                schedule_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )
            enrich_result = await workflow.execute_activity(
                "enrich_document",
                {**inp.__dict__,
                 "content_type": ct_result["content_type"],
                 "parsed_pages": parse_result.get("pages", []),
                 "requested_enrichments": ["outline", "figures", "tables", "translation"]},
                schedule_to_close_timeout=timedelta(minutes=20),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )
        except ActivityError:
            workflow.logger.warning("enrichment failed, continuing without artifact")

    # ... 기존 enhance_with_gemini ...

    # create_source_note 먼저 실행 → note_id 확보
    note_id: str = await workflow.execute_activity("create_source_note", ...)

    # [NEW] enrichment 저장 — note_id 확보 후
    if enrich_result is not None:
        try:
            await workflow.execute_activity(
                "store_enrichment_artifact",
                {"note_id": note_id, "workspace_id": inp.workspace_id,
                 **enrich_result},
                schedule_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        except ActivityError:
            workflow.logger.warning("store_enrichment_artifact failed, artifact lost")

    return note_id
```

`workspace_id`는 `IngestInput`에 신규 추가 필요 (현재 `project_id`만 있음 — migration 불필요, 필드 추가만).

### 7.2 `store_enrichment_artifact` Activity

```python
@activity.defn(name="store_enrichment_artifact")
async def store_enrichment_artifact(inp: dict) -> dict:
    # note_enrichments UPSERT (idempotency: note_id 기준)
    # status: pending → done (or failed via caller)
    # returns: {"enrichment_id": "..."}
```

---

## 8. 에러 처리

| 실패 지점 | 동작 |
|---|---|
| `detect_content_type` 실패 (2회 재시도 후) | enrichment 전체 skip, note 정상 저장 |
| `enrich_document` 실패 | `note_enrichments.status = 'failed'`, `error` 기록, note 정상 저장 |
| figure MinIO 업로드 실패 | 해당 figure `object_key = null`, 나머지 artifact는 저장 |
| LLM 타임아웃 (20분 초과) | `status = 'failed'`, Temporal이 `ActivityError` 발생 |
| Ollama + image type | `skip_reasons: ["image_provider_unsupported"]`, `artifact = {}` |

enrichment는 **항상 best-effort** — `create_source_note`는 enrichment 결과와 무관하게 실행.

---

## 9. 테스트 전략

| 파일 | 커버 항목 |
|---|---|
| `tests/activities/test_detect_content_type.py` | 7종 휴리스틱 happy path, 시그널 충돌 → LLM fallback 트리거, LLM 응답 파싱 |
| `tests/activities/test_enrich_document.py` | 타입별 artifact 필드 존재 검증, Ollama skip_reason 기록, figure MinIO 업로드 mock |
| `tests/test_enrichment_artifact_schema.py` | Pydantic 모델로 artifact jsonb 검증 (필수 필드 누락 시 실패) |
| `tests/workflows/test_ingest_enrichment.py` | enrichment 실패해도 note_id 반환, flag OFF 시 enrichment activity 미호출 |

모든 LLM 호출은 `AsyncMock` + `model_validate` 픽스처 패턴 (llm-antipatterns §13 준수).

---

## 10. API 노출 (세션 A 소비용)

세션 A(Live Ingest UI)가 enrichment 진행 상태와 결과를 조회하기 위한 내부 엔드포인트. **SSE 스트리밍 wrapping은 세션 A 담당**, 본 spec은 REST 인터페이스만 정의.

```
GET  /api/internal/notes/:noteId/enrichment
  → { status, content_type, artifact, skip_reasons, error }
```

세션 A는 이 GET을 polling하거나, `enrichment:done` / `enrichment:failed` SSE 이벤트를 수신한 뒤 한 번 호출해 artifact를 가져온다.

---

## 11. 이벤트 이름 (세션 A 합의용)

세션 A가 SSE 페이로드를 wrapping할 때 참조하는 enrichment 단계 이벤트 이름 초안. **최종 합의는 세션 A 담당.**

| 단계 | 이벤트 이름 제안 |
|---|---|
| detect_content_type 완료 | `enrichment:type_detected` |
| enrich_document 시작 | `enrichment:processing` |
| figure 업로드 완료 (N개) | `enrichment:figures_ready` |
| artifact 저장 완료 | `enrichment:done` |
| 실패 | `enrichment:failed` |

---

## 12. Feature Flag

`FEATURE_CONTENT_ENRICHMENT=true` (기본 off).

flag OFF 시:
- `detect_content_type`, `enrich_document`, `store_enrichment_artifact` activity 미등록
- workflow에서 enrichment 블록 완전 bypass
- `/api/internal/notes/:noteId/enrichment` 404 반환

---

## 13. Open Questions

1. **`IngestInput.workspace_id` 추가** — 현재 `project_id`만 있음. project → workspace 역참조 쿼리로 대체 가능하지만, activity 안에서 DB 쿼리를 늘리는 것보다 workflow input에 포함하는 게 낫다. implementation 시점에 결정.
2. **`requested_enrichments` 기본값** — 사용자가 업로드 시 "번역 요청" 옵션을 주는 UX가 있는지 세션 A와 합의 필요. 현재 spec은 worker가 기본 `["outline","figures","tables","translation"]` 전체 요청으로 가정.
3. **citation graph 구현 타이밍** — `citations: []` 슬롯 예약. DOI 조회 + CrossRef API 연동이 필요한 시점에 별도 plan 작성.
4. **code/notebook symbol_tree 추출 방법** — Python은 `ast` 모듈로 충분. Jupyter `.ipynb`는 cell 분리 후 각 code cell에 적용. 다른 언어(JS, Java) 지원 범위는 구현 시 결정.
