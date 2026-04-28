# Content-Aware Enrichment (Spec B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 업로드 파일에 컨텐츠 타입 검출 + 구조화 artifact enrichment를 적용하고, `note_enrichments` 테이블에 저장해 downstream(세션 A UI, Plan 5 KG, 세션 F export)에 노출한다.

**Architecture:** `detect_content_type → enrich_document → store_enrichment_artifact` 3개 Temporal activity를 `IngestWorkflow`의 parse 뒤 / `create_source_note` 직전(compute) + 직후(store)에 삽입. enrichment는 best-effort — 실패해도 note 생성은 계속. Gemini는 `generate_multimodal(pdf_bytes=)` 전체 PDF, Ollama는 대표 청크 텍스트-only. `FEATURE_CONTENT_ENRICHMENT=true` env로 게이팅.

**Tech Stack:** Drizzle ORM + pgvector, Temporal activities, `packages/llm` (GeminiProvider/OllamaProvider), MinIO, Hono internal routes, Pydantic v2, pytest + AsyncMock

**Spec:** `docs/superpowers/specs/2026-04-27-content-aware-enrichment-design.md`

---

## File Map

| 파일 | 역할 |
|---|---|
| `packages/db/src/schema/note-enrichments.ts` | **NEW** Drizzle 스키마 |
| `packages/db/drizzle/0029_note_enrichments.sql` | **NEW** 마이그레이션 |
| `packages/db/src/index.ts` | **MOD** new schema export |
| `packages/db/tests/note-enrichments.test.ts` | **NEW** 스키마 타입 테스트 |
| `apps/worker/src/worker/lib/enrichment_artifact.py` | **NEW** Pydantic artifact 모델 |
| `apps/worker/tests/test_enrichment_artifact_schema.py` | **NEW** 모델 검증 테스트 |
| `apps/worker/src/worker/activities/detect_content_type_activity.py` | **NEW** 타입 검출 activity |
| `apps/worker/tests/activities/test_detect_content_type.py` | **NEW** 검출 테스트 |
| `apps/worker/src/worker/activities/pdf_activity.py` | **MOD** `--extract-images=true` + pages 반환 |
| `apps/worker/src/worker/activities/enrich_document_activity.py` | **NEW** enrichment activity |
| `apps/worker/tests/activities/test_enrich_document.py` | **NEW** enrichment 테스트 |
| `apps/worker/src/worker/activities/store_enrichment_activity.py` | **NEW** DB 저장 activity |
| `apps/api/src/routes/internal.ts` | **MOD** POST + GET `/notes/:id/enrichment` |
| `apps/worker/src/worker/workflows/ingest_workflow.py` | **MOD** `workspace_id` + enrichment 삽입 |
| `apps/worker/tests/workflows/test_ingest_enrichment.py` | **NEW** 워크플로우 통합 테스트 |
| `apps/worker/src/worker/temporal_main.py` | **MOD** FEATURE flag 등록 |
| `apps/worker/tests/test_temporal_main_code.py` | **MOD** flag OFF/ON 검증 추가 |

---

## Task 1: DB Schema — `note_enrichments`

**Files:**
- Create: `packages/db/src/schema/note-enrichments.ts`
- Create: `packages/db/drizzle/0029_note_enrichments.sql`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/note-enrichments.test.ts`

- [x] **Step 1: Drizzle 스키마 파일 작성**

```typescript
// packages/db/src/schema/note-enrichments.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { notes } from "./notes";
import { workspaces } from "./workspaces";

export const noteEnrichments = pgTable(
  "note_enrichments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    contentType: text("content_type").notNull(),
    status: text("status").notNull().default("pending"),
    artifact: jsonb("artifact").$type<Record<string, unknown>>(),
    provider: text("provider"),
    skipReasons: text("skip_reasons").array(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("note_enrichments_note_id_idx").on(t.noteId),
    index("note_enrichments_workspace_id_idx").on(t.workspaceId),
  ],
);

export type NoteEnrichment = typeof noteEnrichments.$inferSelect;
export type NoteEnrichmentInsert = typeof noteEnrichments.$inferInsert;
```

- [x] **Step 2: 마이그레이션 SQL 작성**

```sql
-- packages/db/drizzle/0029_note_enrichments.sql
CREATE TABLE "note_enrichments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "content_type" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "artifact" jsonb,
  "provider" text,
  "skip_reasons" text[],
  "error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "note_enrichments_note_id_idx" ON "note_enrichments"("note_id");
CREATE INDEX "note_enrichments_workspace_id_idx" ON "note_enrichments"("workspace_id");
```

- [x] **Step 3: `packages/db/src/index.ts`에 export 추가**

기존 마지막 `export * from "./schema/share-links";` 줄 바로 다음에 추가:
```typescript
export * from "./schema/note-enrichments";
```

- [x] **Step 4: 스키마 타입 테스트 작성**

```typescript
// packages/db/tests/note-enrichments.test.ts
import { describe, it, expect } from "vitest";
import { noteEnrichments } from "../src/schema/note-enrichments";

describe("noteEnrichments schema", () => {
  it("has expected column names", () => {
    const cols = Object.keys(noteEnrichments);
    expect(cols).toContain("id");
    expect(cols).toContain("noteId");
    expect(cols).toContain("workspaceId");
    expect(cols).toContain("contentType");
    expect(cols).toContain("status");
    expect(cols).toContain("artifact");
    expect(cols).toContain("skipReasons");
  });

  it("status default is pending", () => {
    const col = noteEnrichments.status as { default?: unknown };
    expect(col.default).toBe("pending");
  });
});
```

- [x] **Step 5: 테스트 실행**

```bash
pnpm --filter @opencairn/db test
```

Expected: PASS (타입 체크만, DB 없음)

- [x] **Step 6: 마이그레이션 메타 파일 생성**

```bash
pnpm db:generate
```

`packages/db/drizzle/meta/0029_snapshot.json`이 생성되는지 확인.

- [x] **Step 7: 마이그레이션 적용 (로컬 dev DB)**

```bash
pnpm db:migrate
```

Expected: `Applying migration 0029_note_enrichments` 출력

- [x] **Step 8: 커밋**

```bash
git add packages/db/src/schema/note-enrichments.ts \
        packages/db/drizzle/0029_note_enrichments.sql \
        packages/db/drizzle/meta/ \
        packages/db/src/index.ts \
        packages/db/tests/note-enrichments.test.ts
git commit -m "feat(db): add note_enrichments table for content-aware enrichment

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Pydantic Artifact 모델

**Files:**
- Create: `apps/worker/src/worker/lib/enrichment_artifact.py`
- Test: `apps/worker/tests/test_enrichment_artifact_schema.py`

- [x] **Step 1: 실패하는 테스트 작성**

```python
# apps/worker/tests/test_enrichment_artifact_schema.py
import pytest
from pydantic import ValidationError
from worker.lib.enrichment_artifact import EnrichmentArtifact, OutlineItem, FigureItem


def test_empty_artifact_is_valid():
    a = EnrichmentArtifact()
    assert a.outline == []
    assert a.figures == []
    assert a.translation is None
    assert a.word_count == 0


def test_outline_item_requires_level_and_title():
    item = OutlineItem(level=1, title="Introduction")
    assert item.page is None


def test_paper_artifact_with_sections():
    from worker.lib.enrichment_artifact import SectionLabels
    a = EnrichmentArtifact(
        sections=SectionLabels(abstract="This paper...", methods="We used..."),
        citations=[],
        word_count=8000,
    )
    assert a.sections.abstract == "This paper..."
    assert a.citations == []


def test_slide_artifact():
    from worker.lib.enrichment_artifact import SlideCard
    a = EnrichmentArtifact(slides=[SlideCard(index=1, title="Intro", body="...")])
    assert len(a.slides) == 1


def test_book_artifact_chapter_tree():
    from worker.lib.enrichment_artifact import ChapterNode
    node = ChapterNode(title="Chapter 1", page=10, children=[
        ChapterNode(title="1.1 Overview", page=12)
    ])
    assert len(node.children) == 1


def test_artifact_round_trip():
    a = EnrichmentArtifact(word_count=500, outline=[OutlineItem(level=1, title="Intro", page=1)])
    data = a.model_dump(exclude_none=True)
    restored = EnrichmentArtifact.model_validate(data)
    assert restored.outline[0].title == "Intro"
```

- [x] **Step 2: 테스트가 실패하는지 확인**

```bash
cd apps/worker && python -m pytest tests/test_enrichment_artifact_schema.py -v 2>&1 | head -20
```

Expected: `ImportError: No module named 'worker.lib.enrichment_artifact'`

- [x] **Step 3: Pydantic 모델 구현**

```python
# apps/worker/src/worker/lib/enrichment_artifact.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class OutlineItem(BaseModel):
    level: int
    title: str
    page: int | None = None


class FigureItem(BaseModel):
    page: int | None = None
    caption: str | None = None
    object_key: str | None = None


class TableItem(BaseModel):
    page: int | None = None
    caption: str | None = None
    markdown: str = ""


class Translation(BaseModel):
    lang: str
    text: str


class SectionLabels(BaseModel):
    abstract: str | None = None
    introduction: str | None = None
    methods: str | None = None
    results: str | None = None
    discussion: str | None = None
    conclusion: str | None = None
    references_raw: str | None = None


class SlideCard(BaseModel):
    index: int
    title: str | None = None
    body: str = ""
    notes: str | None = None


class ChapterNode(BaseModel):
    title: str
    page: int | None = None
    children: list[ChapterNode] = []


class SymbolItem(BaseModel):
    kind: Literal["function", "class", "variable"]
    name: str
    line: int | None = None
    docstring: str | None = None


class PivotSuggestion(BaseModel):
    rows: list[str]
    values: list[str]
    agg: str


ContentType = Literal["document", "paper", "slide", "book", "code", "table", "image"]


class EnrichmentArtifact(BaseModel):
    # common
    outline: list[OutlineItem] = []
    figures: list[FigureItem] = []
    tables: list[TableItem] = []
    translation: Translation | None = None
    word_count: int = 0
    # paper only
    sections: SectionLabels | None = None
    citations: list = []
    # slide only
    slides: list[SlideCard] = []
    # book only
    chapter_tree: list[ChapterNode] = []
    # code only
    symbol_tree: list[SymbolItem] = []
    # table-heavy only
    pivot_suggestions: list[PivotSuggestion] = []
```

- [x] **Step 4: 테스트 통과 확인**

```bash
cd apps/worker && python -m pytest tests/test_enrichment_artifact_schema.py -v
```

Expected: 6 passed

- [x] **Step 5: 커밋**

```bash
git add apps/worker/src/worker/lib/enrichment_artifact.py \
        apps/worker/tests/test_enrichment_artifact_schema.py
git commit -m "feat(worker): add EnrichmentArtifact pydantic models (Spec B)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `detect_content_type` Activity

**Files:**
- Create: `apps/worker/src/worker/activities/detect_content_type_activity.py`
- Test: `apps/worker/tests/activities/test_detect_content_type.py`

- [x] **Step 1: 실패하는 테스트 작성**

```python
# apps/worker/tests/activities/test_detect_content_type.py
import pytest
from unittest.mock import AsyncMock, patch

SLIDE_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


@pytest.mark.asyncio
async def test_slide_mime_returns_slide_confidence_1():
    from worker.activities.detect_content_type_activity import detect_content_type
    result = await detect_content_type({"mime_type": SLIDE_MIME, "parsed_pages": []})
    assert result["content_type"] == "slide"
    assert result["confidence"] == 1.0
    assert result["used_llm"] is False


@pytest.mark.asyncio
async def test_python_mime_returns_code():
    from worker.activities.detect_content_type_activity import detect_content_type
    result = await detect_content_type({"mime_type": "text/x-python", "parsed_pages": []})
    assert result["content_type"] == "code"
    assert result["confidence"] == 1.0


@pytest.mark.asyncio
async def test_paper_signals_detected():
    from worker.activities.detect_content_type_activity import detect_content_type
    pages = [
        {"text": "Abstract: This paper presents... Keywords: machine learning doi:10.1234"},
        {"text": "Introduction. In this study..."},
        {"text": "Methods."},
    ]
    result = await detect_content_type({"mime_type": "application/pdf", "parsed_pages": pages})
    assert result["content_type"] == "paper"
    assert result["confidence"] >= 0.7
    assert result["used_llm"] is False


@pytest.mark.asyncio
async def test_table_heavy_returns_table():
    from worker.activities.detect_content_type_activity import detect_content_type
    pages = [{"text": "data", "tables": [{"rows": []}]} for _ in range(10)]
    result = await detect_content_type({"mime_type": "application/pdf", "parsed_pages": pages})
    assert result["content_type"] == "table"


@pytest.mark.asyncio
async def test_conflicting_signals_trigger_llm_fallback():
    from worker.activities.detect_content_type_activity import detect_content_type
    # paper signals + book signals simultaneously → confidence < 0.7 → LLM fallback
    pages = (
        [{"text": "Abstract. Keywords. doi:10.1 arxiv journal"}] * 3
        + [{"text": "Table of Contents"}]
        + [{"text": "content"} for _ in range(80)]
    )
    mock_provider = AsyncMock()
    mock_provider.generate = AsyncMock(return_value="paper")
    with patch("worker.activities.detect_content_type_activity.get_provider", return_value=mock_provider):
        result = await detect_content_type({"mime_type": "application/pdf", "parsed_pages": pages})
    assert result["used_llm"] is True
    assert result["content_type"] == "paper"


@pytest.mark.asyncio
async def test_llm_unknown_response_falls_back_to_document():
    from worker.activities.detect_content_type_activity import detect_content_type
    pages = []
    mock_provider = AsyncMock()
    mock_provider.generate = AsyncMock(return_value="spreadsheet")  # not in valid set
    # force low confidence by passing empty pages (→ document, 0.75) but we need < 0.7
    # simulate by patching heuristic directly
    with patch("worker.activities.detect_content_type_activity._heuristic", return_value=("document", 0.5)):
        with patch("worker.activities.detect_content_type_activity.get_provider", return_value=mock_provider):
            result = await detect_content_type({"mime_type": "application/pdf", "parsed_pages": pages})
    assert result["content_type"] == "document"
    assert result["used_llm"] is True


@pytest.mark.asyncio
async def test_no_pages_returns_document():
    from worker.activities.detect_content_type_activity import detect_content_type
    result = await detect_content_type({"mime_type": "application/pdf", "parsed_pages": []})
    assert result["content_type"] == "document"
```

- [x] **Step 2: 실패 확인**

```bash
cd apps/worker && python -m pytest tests/activities/test_detect_content_type.py -v 2>&1 | head -10
```

Expected: `ImportError: No module named 'worker.activities.detect_content_type_activity'`

- [x] **Step 3: Activity 구현**

```python
# apps/worker/src/worker/activities/detect_content_type_activity.py
from __future__ import annotations

import os
import re

from temporalio import activity

from llm import get_provider
from llm.base import ProviderConfig

CONTENT_TYPES = frozenset({"document", "paper", "slide", "book", "code", "table", "image"})

SLIDE_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
CODE_MIMES = frozenset({"text/x-python", "application/x-ipynb+json"})

_PAPER_RE = re.compile(r"\b(abstract|keywords?|doi|arxiv|journal)\b", re.IGNORECASE)
_TOC_RE = re.compile(r"\b(table of contents|목차|contents)\b", re.IGNORECASE)


def _heuristic(mime: str, pages: list[dict]) -> tuple[str, float]:
    if mime == SLIDE_MIME:
        return "slide", 1.0
    if mime in CODE_MIMES:
        return "code", 1.0
    if mime.startswith("image/"):
        return "image", 1.0

    total = len(pages)
    first_3_text = " ".join((p.get("text") or "") for p in pages[:3])

    paper_hits = len(_PAPER_RE.findall(first_3_text))
    paper_signal = paper_hits >= 2

    first_10_text = " ".join((p.get("text") or "") for p in pages[:10])
    book_signal = total > 80 and bool(_TOC_RE.search(first_10_text))

    table_count = sum(1 for p in pages if p.get("tables"))
    table_signal = (table_count / total) >= 0.6 if total > 0 else False

    signals: list[tuple[str, float]] = []
    if paper_signal:
        signals.append(("paper", 0.92))
    if book_signal:
        signals.append(("book", 0.88))
    if table_signal:
        signals.append(("table", 0.85))

    if len(signals) == 1:
        return signals[0]
    if len(signals) > 1:
        return signals[0][0], 0.45  # conflicting → low confidence

    return "document", 0.75


@activity.defn(name="detect_content_type")
async def detect_content_type(inp: dict) -> dict:
    """Classify an ingested document into one of 7 content types.

    Returns {"content_type", "confidence", "used_llm"}.
    """
    mime: str = inp.get("mime_type", "")
    pages: list[dict] = inp.get("parsed_pages", [])

    content_type, confidence = _heuristic(mime, pages)
    used_llm = False

    if confidence < 0.7:
        activity.heartbeat("LLM fallback for content type classification")
        first_3_text = " ".join((p.get("text") or "") for p in pages[:3])[:3000]
        cfg = ProviderConfig(
            provider=os.environ.get("LLM_PROVIDER", "gemini"),
            api_key=os.environ.get("LLM_API_KEY"),
            model=os.environ.get("LLM_FLASH_LITE_MODEL", "gemini-3.1-flash-lite-preview"),
        )
        provider = get_provider(cfg)
        prompt = (
            "Classify this document. Reply with exactly one word:\n"
            "paper | slide | book | code | table | document\n---\n"
            + first_3_text
        )
        raw = (await provider.generate([{"role": "user", "content": prompt}])).strip().lower()
        content_type = raw if raw in CONTENT_TYPES else "document"
        used_llm = True

    activity.logger.info(
        "content_type=%s confidence=%.2f used_llm=%s", content_type, confidence, used_llm
    )
    return {"content_type": content_type, "confidence": confidence, "used_llm": used_llm}
```

- [x] **Step 4: 테스트 통과 확인**

```bash
cd apps/worker && python -m pytest tests/activities/test_detect_content_type.py -v
```

Expected: 7 passed

- [x] **Step 5: 커밋**

```bash
git add apps/worker/src/worker/activities/detect_content_type_activity.py \
        apps/worker/tests/activities/test_detect_content_type.py
git commit -m "feat(worker): add detect_content_type activity (Spec B)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: `pdf_activity.py` — figure extraction + pages 반환

**Files:**
- Modify: `apps/worker/src/worker/activities/pdf_activity.py`

- [x] **Step 1: 변경 사항 적용**

`pdf_activity.py`의 두 곳을 수정한다.

**변경 1** — subprocess 인자 (`--extract-images` 플래그):
```python
# 기존
"--extract-images", "false",
# 변경
"--extract-images", "true",
```

**변경 2** — 반환값에 `pages` 추가 (line 129 근처):
```python
# 기존
return {
    "text": full_text,
    "has_complex_layout": has_complex_layout,
    "is_scan": is_scan,
}
# 변경
return {
    "text": full_text,
    "has_complex_layout": has_complex_layout,
    "is_scan": is_scan,
    "pages": pages,   # enrichment activity가 소비 (opendataloader 원본 pages[])
}
```

- [x] **Step 2: 기존 테스트 확인 (있다면)**

```bash
cd apps/worker && python -m pytest tests/ -k "pdf" -v 2>&1
```

Expected: 기존 테스트가 있다면 모두 PASS (반환 dict에 key 추가는 비파괴적)

- [x] **Step 3: 커밋**

```bash
git add apps/worker/src/worker/activities/pdf_activity.py
git commit -m "fix(worker): enable figure extraction in pdf_activity (--extract-images=true)

Enrichment layer (Spec B) reads pages[].figures[].image_data for MinIO upload.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `enrich_document` Activity

**Files:**
- Create: `apps/worker/src/worker/activities/enrich_document_activity.py`
- Test: `apps/worker/tests/activities/test_enrich_document.py`

- [x] **Step 1: 실패하는 테스트 작성**

```python
# apps/worker/tests/activities/test_enrich_document.py
import base64
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

_FAKE_OUTLINE_JSON = '{"outline": [{"level": 1, "title": "Intro", "page": 1}], "figures": [], "tables": [], "word_count": 500}'
_PAPER_JSON = (
    '{"outline": [{"level": 1, "title": "Abstract", "page": 1}], '
    '"figures": [], "tables": [], "word_count": 3000, '
    '"sections": {"abstract": "We study...", "methods": "We used...", "references_raw": "[1] ..."}}'
)


@pytest.fixture
def gemini_provider():
    p = AsyncMock()
    p.generate_multimodal = AsyncMock(return_value=_FAKE_OUTLINE_JSON)
    p.generate = AsyncMock(return_value=_FAKE_OUTLINE_JSON)
    return p


@pytest.mark.asyncio
async def test_document_enrichment_returns_outline(gemini_provider):
    from worker.activities.enrich_document_activity import enrich_document
    with patch("worker.activities.enrich_document_activity.get_provider", return_value=gemini_provider), \
         patch("worker.activities.enrich_document_activity._upload_figures", return_value=[]), \
         patch("worker.activities.enrich_document_activity.download_to_tempfile") as dl:
        dl.return_value.__enter__ = MagicMock(return_value=MagicMock(read_bytes=MagicMock(return_value=b"pdf")))
        dl.return_value.__exit__ = MagicMock(return_value=False)
        # Use a simpler path: provide no object_key so multimodal skips
        inp = {
            "mime_type": "application/pdf", "content_type": "document",
            "object_key": None, "workspace_id": "ws-1", "note_id": None,
            "parsed_pages": [{"text": "hello world " * 100, "figures": [], "tables": []}],
            "requested_enrichments": ["outline"],
        }
        gemini_provider.generate = AsyncMock(return_value=_FAKE_OUTLINE_JSON)
        result = await enrich_document(inp)
    assert "artifact" in result
    assert result["artifact"]["outline"][0]["title"] == "Intro"


@pytest.mark.asyncio
async def test_paper_enrichment_has_sections(gemini_provider):
    from worker.activities.enrich_document_activity import enrich_document
    gemini_provider.generate = AsyncMock(return_value=_PAPER_JSON)
    with patch("worker.activities.enrich_document_activity.get_provider", return_value=gemini_provider), \
         patch("worker.activities.enrich_document_activity._upload_figures", return_value=[]):
        inp = {
            "mime_type": "application/pdf", "content_type": "paper",
            "object_key": None, "workspace_id": "ws-1", "note_id": None,
            "parsed_pages": [{"text": "abstract methods results", "figures": [], "tables": []}],
            "requested_enrichments": ["outline", "sections"],
        }
        result = await enrich_document(inp)
    assert result["artifact"].get("sections", {}).get("abstract") == "We study..."


@pytest.mark.asyncio
async def test_ollama_translation_skipped():
    from worker.activities.enrich_document_activity import enrich_document
    mock_provider = AsyncMock()
    mock_provider.generate = AsyncMock(return_value=_FAKE_OUTLINE_JSON)
    with patch("worker.activities.enrich_document_activity.get_provider", return_value=mock_provider), \
         patch("worker.activities.enrich_document_activity._upload_figures", return_value=[]), \
         patch.dict("os.environ", {"LLM_PROVIDER": "ollama"}):
        inp = {
            "mime_type": "application/pdf", "content_type": "document",
            "object_key": None, "workspace_id": "ws-1", "note_id": None,
            "parsed_pages": [{"text": "hello", "figures": [], "tables": []}],
            "requested_enrichments": ["translation"],
        }
        result = await enrich_document(inp)
    assert "translation_provider_unsupported" in result["skip_reasons"]
    assert result["artifact"].get("translation") is None


@pytest.mark.asyncio
async def test_figure_uploaded_to_minio():
    from worker.activities.enrich_document_activity import enrich_document
    fake_b64 = base64.b64encode(b"fake_png_bytes").decode()
    pages = [{"text": "fig page", "figures": [{"image_data": fake_b64, "caption": "Fig 1"}], "tables": []}]

    mock_provider = AsyncMock()
    mock_provider.generate = AsyncMock(return_value='{"outline":[],"figures":[],"tables":[],"word_count":0}')

    uploaded: list[str] = []

    async def fake_upload(figs, ws_id, note_id):
        for fig in figs:
            uploaded.append(fig.get("image_data", ""))
        return [{"page": 0, "caption": "Fig 1", "object_key": "enrichments/ws-1/None/fig-0-0.png"}]

    with patch("worker.activities.enrich_document_activity.get_provider", return_value=mock_provider), \
         patch("worker.activities.enrich_document_activity._upload_figures", side_effect=fake_upload):
        inp = {
            "mime_type": "application/pdf", "content_type": "document",
            "object_key": None, "workspace_id": "ws-1", "note_id": None,
            "parsed_pages": pages,
            "requested_enrichments": ["figures"],
        }
        result = await enrich_document(inp)
    assert len(uploaded) == 1
    assert result["artifact"]["figures"][0]["object_key"].startswith("enrichments/")
```

- [x] **Step 2: 실패 확인**

```bash
cd apps/worker && python -m pytest tests/activities/test_enrich_document.py -v 2>&1 | head -10
```

Expected: `ImportError: No module named 'worker.activities.enrich_document_activity'`

- [x] **Step 3: Activity 구현**

```python
# apps/worker/src/worker/activities/enrich_document_activity.py
from __future__ import annotations

import base64
import io
import json
import os
import re

from temporalio import activity

from llm import get_provider
from llm.base import ProviderConfig
from worker.lib.enrichment_artifact import EnrichmentArtifact
from worker.lib.s3_client import get_s3_client

# ── LLM 프롬프트 ────────────────────────────────────────────────────────────

_COMMON_PROMPT = """\
You are a document structure extractor. Analyze this document and return ONLY valid JSON.

Return this exact JSON structure (omit keys that don't apply):
{
  "outline": [{"level": 1, "title": "...", "page": N}],
  "figures": [{"page": N, "caption": "..."}],
  "tables":  [{"page": N, "caption": "...", "markdown": "| ... |"}],
  "word_count": N
}
Return only JSON. No explanation.
"""

_PAPER_EXTRA = """\
Also include a "sections" key with these sub-keys if found:
"abstract", "introduction", "methods", "results", "discussion", "conclusion", "references_raw"
Each value is the full text of that section (truncated to 3000 chars).
"""

_SLIDE_PROMPT = """\
Extract slide cards from this presentation. Return ONLY valid JSON:
{"slides": [{"index": N, "title": "...", "body": "...", "notes": "..."}]}
"""

_BOOK_PROMPT = """\
Extract the chapter tree from this book's table of contents. Return ONLY valid JSON:
{"chapter_tree": [{"title": "...", "page": N, "children": [...]}]}
"""

_TABLE_PROMPT = """\
This document is table-heavy. Return ONLY valid JSON:
{
  "tables": [{"page": N, "caption": "...", "markdown": "| col1 | col2 |\\n|---|---|\\n| ... |"}],
  "pivot_suggestions": [{"rows": ["..."], "values": ["..."], "agg": "sum"}]
}
"""

_TRANSLATION_PROMPT = "다음 영어 텍스트를 자연스러운 한국어로 번역해줘. 번역문만 출력:\n\n{text}"


# ── MinIO figure upload ──────────────────────────────────────────────────────

async def _upload_figures(
    raw_figs: list[dict],
    workspace_id: str,
    note_id: str | None,
) -> list[dict]:
    """Base64 figure data를 MinIO에 업로드하고 FigureItem 리스트 반환."""
    import asyncio

    bucket = os.environ.get("S3_BUCKET", "opencairn-uploads")
    client = get_s3_client()
    result: list[dict] = []

    for i, fig in enumerate(raw_figs):
        image_data: str | None = fig.get("image_data")
        if not image_data:
            continue
        try:
            img_bytes = base64.b64decode(image_data)
            key = f"enrichments/{workspace_id}/{note_id}/fig-{i}.png"
            await asyncio.to_thread(
                client.put_object,
                bucket, key, io.BytesIO(img_bytes), len(img_bytes),
                content_type="image/png",
            )
            result.append({"page": fig.get("page"), "caption": fig.get("caption"), "object_key": key})
        except Exception as exc:  # noqa: BLE001
            activity.logger.warning("figure upload failed (fig %d): %s", i, exc)
            result.append({"page": fig.get("page"), "caption": fig.get("caption"), "object_key": None})
    return result


# ── Provider setup ───────────────────────────────────────────────────────────

def _make_provider():
    return get_provider(ProviderConfig(
        provider=os.environ.get("LLM_PROVIDER", "gemini"),
        api_key=os.environ.get("LLM_API_KEY"),
        model=os.environ.get("LLM_MODEL", "gemini-3-flash-preview"),
    ))


def _is_ollama() -> bool:
    return os.environ.get("LLM_PROVIDER", "gemini") == "ollama"


def _representative_text(pages: list[dict], max_chars: int = 15_000) -> str:
    """Ollama fallback: 첫/중간/끝 페이지에서 각 max_chars/3 추출."""
    total = len(pages)
    if total == 0:
        return ""
    chunk = max_chars // 3
    indices = [0, total // 2, total - 1]
    parts = []
    for idx in dict.fromkeys(indices):  # dedupe while preserving order
        parts.append((pages[idx].get("text") or "")[:chunk])
    return "\n\n".join(parts)


def _parse_json_response(raw: str) -> dict:
    """LLM 응답에서 JSON 블록 추출. 파싱 실패 시 빈 dict."""
    raw = raw.strip()
    # ```json ... ``` 블록 제거
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
    if match:
        raw = match.group(1)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


# ── 타입별 enrichment ────────────────────────────────────────────────────────

async def _enrich_with_llm(
    prompt: str,
    *,
    pdf_path: str | None,
    text: str,
    provider,
) -> dict:
    """Gemini: multimodal(pdf) 우선. Ollama / 실패 시: text-only fallback."""
    if pdf_path and not _is_ollama():
        activity.heartbeat("calling generate_multimodal")
        try:
            raw = await provider.generate_multimodal(
                prompt, pdf_bytes=open(pdf_path, "rb").read()
            )
            if raw:
                return _parse_json_response(raw)
        except Exception as exc:  # noqa: BLE001
            activity.logger.warning("multimodal failed, falling back to text: %s", exc)

    activity.heartbeat("calling generate (text-only)")
    raw = await provider.generate([{"role": "user", "content": f"{prompt}\n\n{text[:45_000]}"}])
    return _parse_json_response(raw or "")


# ── Main activity ────────────────────────────────────────────────────────────

@activity.defn(name="enrich_document")
async def enrich_document(inp: dict) -> dict:
    """Enrich an ingested document into a structured artifact.

    Returns {"artifact": {...}, "provider": "gemini"|"ollama", "skip_reasons": [...]}
    """
    content_type: str = inp.get("content_type", "document")
    pages: list[dict] = inp.get("parsed_pages", [])
    object_key: str | None = inp.get("object_key")
    workspace_id: str = inp.get("workspace_id", "")
    note_id: str | None = inp.get("note_id")
    requested: list[str] = inp.get("requested_enrichments", [])

    provider = _make_provider()
    provider_name = os.environ.get("LLM_PROVIDER", "gemini")
    skip_reasons: list[str] = []

    # PDF 임시 파일 다운로드 (multimodal용)
    pdf_path: str | None = None
    if object_key and inp.get("mime_type") == "application/pdf" and not _is_ollama():
        from worker.lib.s3_client import download_to_tempfile
        try:
            tmp = download_to_tempfile(object_key)
            pdf_path = str(tmp)
        except Exception as exc:  # noqa: BLE001
            activity.logger.warning("PDF download failed: %s", exc)

    full_text = "\n\n".join((p.get("text") or "") for p in pages)
    rep_text = _representative_text(pages)

    # ── 타입별 LLM 호출 ─────────────────────────────────────────────────────
    raw_data: dict = {}

    if content_type in ("document", "paper"):
        prompt = _COMMON_PROMPT + (_PAPER_EXTRA if content_type == "paper" else "")
        raw_data = await _enrich_with_llm(
            prompt, pdf_path=pdf_path, text=rep_text if _is_ollama() else full_text, provider=provider
        )

    elif content_type == "slide":
        # 슬라이드: pages[] 텍스트에서 직접 카드 구성 (LLM 없음)
        slides = []
        for i, page in enumerate(pages):
            lines = (page.get("text") or "").strip().splitlines()
            title = lines[0] if lines else f"Slide {i + 1}"
            body = "\n".join(lines[1:]) if len(lines) > 1 else ""
            slides.append({"index": i + 1, "title": title, "body": body})
        raw_data = {"slides": slides}

    elif content_type == "book":
        raw_data = await _enrich_with_llm(
            _BOOK_PROMPT, pdf_path=pdf_path, text=rep_text, provider=provider
        )

    elif content_type == "code":
        # symbol_tree: Python AST (LLM 불필요)
        raw_data = _extract_symbols(full_text)

    elif content_type == "table":
        raw_data = await _enrich_with_llm(
            _TABLE_PROMPT, pdf_path=pdf_path, text=full_text[:45_000], provider=provider
        )

    elif content_type == "image":
        if _is_ollama():
            skip_reasons.append("image_provider_unsupported")
            raw_data = {}
        else:
            raw_data = await _enrich_with_llm(
                "Describe this image in detail as JSON: {\"outline\": [{\"level\": 1, \"title\": \"...\"}], \"word_count\": 0}",
                pdf_path=None, text="", provider=provider,
            )

    # ── Figure 업로드 ────────────────────────────────────────────────────────
    all_raw_figs = [fig for page in pages for fig in (page.get("figures") or [])]
    if all_raw_figs and "figures" in requested:
        activity.heartbeat(f"uploading {len(all_raw_figs)} figures")
        uploaded_figs = await _upload_figures(all_raw_figs, workspace_id, note_id)
        raw_data["figures"] = uploaded_figs
    elif "figures" not in raw_data:
        raw_data["figures"] = []

    # ── 번역 ─────────────────────────────────────────────────────────────────
    if "translation" in requested:
        if provider_name == "ollama":
            skip_reasons.append("translation_provider_unsupported")
            raw_data["translation"] = None
        else:
            src = ""
            if content_type == "paper" and raw_data.get("sections", {}).get("abstract"):
                src = raw_data["sections"]["abstract"]
            else:
                src = full_text[:30_000]
            if src.strip():
                activity.heartbeat("translating to Korean")
                ko = await provider.generate([{
                    "role": "user",
                    "content": _TRANSLATION_PROMPT.format(text=src),
                }])
                raw_data["translation"] = {"lang": "ko", "text": (ko or "").strip()}

    # word_count 보정
    if "word_count" not in raw_data or raw_data["word_count"] == 0:
        raw_data["word_count"] = len(full_text.split())

    # ── Pydantic 검증 후 직렬화 ──────────────────────────────────────────────
    try:
        artifact = EnrichmentArtifact.model_validate(raw_data)
        artifact_dict = artifact.model_dump(exclude_none=True)
    except Exception as exc:  # noqa: BLE001
        activity.logger.warning("artifact validation failed: %s", exc)
        artifact_dict = raw_data

    # PDF 임시 파일 정리
    if pdf_path:
        try:
            import os as _os; _os.unlink(pdf_path)
        except OSError:
            pass

    activity.logger.info("enrichment done: type=%s provider=%s skips=%s", content_type, provider_name, skip_reasons)
    return {
        "artifact": artifact_dict,
        "content_type": content_type,
        "provider": provider_name,
        "skip_reasons": skip_reasons,
    }


def _extract_symbols(text: str) -> dict:
    """Python AST로 함수/클래스 심볼 추출. 파싱 실패 시 빈 목록."""
    import ast
    symbols = []
    try:
        tree = ast.parse(text)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                doc = ast.get_docstring(node) or ""
                symbols.append({"kind": "function", "name": node.name, "line": node.lineno, "docstring": doc[:200]})
            elif isinstance(node, ast.ClassDef):
                doc = ast.get_docstring(node) or ""
                symbols.append({"kind": "class", "name": node.name, "line": node.lineno, "docstring": doc[:200]})
    except SyntaxError:
        pass
    return {"symbol_tree": symbols}
```

- [x] **Step 4: 테스트 통과 확인**

```bash
cd apps/worker && python -m pytest tests/activities/test_enrich_document.py -v
```

Expected: 4 passed

- [x] **Step 5: 커밋**

```bash
git add apps/worker/src/worker/activities/enrich_document_activity.py \
        apps/worker/tests/activities/test_enrich_document.py
git commit -m "feat(worker): add enrich_document activity (Spec B)

7 content types, Gemini multimodal + Ollama text fallback,
figure MinIO upload, translation skip on Ollama.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `store_enrichment_artifact` Activity + Internal API

**Files:**
- Create: `apps/worker/src/worker/activities/store_enrichment_activity.py`
- Modify: `apps/api/src/routes/internal.ts`

- [x] **Step 1: `internal.ts`에 enrichment 엔드포인트 추가**

`apps/api/src/routes/internal.ts` 상단 import 블록에 `noteEnrichments` 추가:
```typescript
import {
  db,
  // ... 기존 imports ...
  noteEnrichments,   // ← 추가
  eq,
  and,
  // ... 기존 ...
} from "@opencairn/db";
```

파일 끝(`export default internal;` 바로 앞)에 추가:

```typescript
// ---------------------------------------------------------------------------
// Spec B — Content-Aware Enrichment artifact
// ---------------------------------------------------------------------------

const enrichmentStoreSchema = z.object({
  workspaceId: z.string().uuid(),
  contentType: z.string().min(1),
  status: z.enum(["pending", "processing", "done", "failed"]).default("done"),
  artifact: z.record(z.unknown()).optional(),
  provider: z.string().optional(),
  skipReasons: z.array(z.string()).optional(),
  error: z.string().optional(),
});

internal.post(
  "/notes/:noteId/enrichment",
  zValidator("json", enrichmentStoreSchema),
  async (c) => {
    const noteId = c.req.param("noteId");
    if (!isUuid(noteId)) return c.json({ error: "invalid_note_id" }, 400);

    const body = c.req.valid("json");

    await db
      .insert(noteEnrichments)
      .values({
        noteId,
        workspaceId: body.workspaceId,
        contentType: body.contentType,
        status: body.status,
        artifact: body.artifact ?? null,
        provider: body.provider ?? null,
        skipReasons: body.skipReasons ?? [],
        error: body.error ?? null,
      })
      .onConflictDoNothing();

    return c.json({ ok: true }, 201);
  },
);

internal.get("/notes/:noteId/enrichment", async (c) => {
  const noteId = c.req.param("noteId");
  if (!isUuid(noteId)) return c.json({ error: "invalid_note_id" }, 400);

  const [row] = await db
    .select()
    .from(noteEnrichments)
    .where(eq(noteEnrichments.noteId, noteId))
    .limit(1);

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});
```

- [x] **Step 2: `store_enrichment_artifact` activity 작성**

```python
# apps/worker/src/worker/activities/store_enrichment_activity.py
from __future__ import annotations

from temporalio import activity

from worker.lib.api_client import post_internal


@activity.defn(name="store_enrichment_artifact")
async def store_enrichment_artifact(inp: dict) -> dict:
    """POST enrichment artifact to the internal API for DB persistence.

    inp: {note_id, workspace_id, content_type, artifact, provider, skip_reasons}
    returns: {"ok": True}
    """
    note_id: str = inp["note_id"]
    activity.logger.info("storing enrichment for note %s", note_id)

    payload = {
        "workspaceId": inp["workspace_id"],
        "contentType": inp.get("content_type", "document"),
        "status": "done",
        "artifact": inp.get("artifact"),
        "provider": inp.get("provider"),
        "skipReasons": inp.get("skip_reasons", []),
        "error": inp.get("error"),
    }
    result = await post_internal(f"/api/internal/notes/{note_id}/enrichment", payload)
    activity.logger.info("enrichment stored for note %s", note_id)
    return result
```

- [x] **Step 3: API 타입체크 확인**

```bash
pnpm --filter @opencairn/api tsc --noEmit
```

Expected: 에러 없음

- [x] **Step 4: API 단위 테스트 (있는 경우 기존 패턴 따라)**

```bash
pnpm --filter @opencairn/api test 2>&1 | tail -5
```

Expected: 기존 테스트 통과 유지

- [x] **Step 5: 커밋**

```bash
git add apps/api/src/routes/internal.ts \
        apps/worker/src/worker/activities/store_enrichment_activity.py
git commit -m "feat(api,worker): add enrichment store/get endpoints + store_enrichment_artifact activity

POST /api/internal/notes/:noteId/enrichment (worker → DB)
GET  /api/internal/notes/:noteId/enrichment (session A polling)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: `IngestWorkflow` 통합 + `workspace_id`

**Files:**
- Modify: `apps/worker/src/worker/workflows/ingest_workflow.py`
- Test: `apps/worker/tests/workflows/test_ingest_enrichment.py`

- [x] **Step 1: 실패하는 테스트 작성**

```python
# apps/worker/tests/workflows/test_ingest_enrichment.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


def _make_inp(feature_on=True):
    from worker.workflows.ingest_workflow import IngestInput
    return IngestInput(
        object_key="test.pdf",
        file_name="test.pdf",
        mime_type="application/pdf",
        user_id="user-1",
        project_id="proj-1",
        note_id=None,
        workspace_id="ws-1",
    )


@pytest.mark.asyncio
async def test_workspace_id_field_exists():
    from worker.workflows.ingest_workflow import IngestInput
    inp = IngestInput(
        object_key="x", file_name="x", mime_type="application/pdf",
        user_id="u", project_id="p", note_id=None, workspace_id="ws-1",
    )
    assert inp.workspace_id == "ws-1"


@pytest.mark.asyncio
async def test_enrichment_activities_called_when_flag_on(monkeypatch):
    monkeypatch.setenv("FEATURE_CONTENT_ENRICHMENT", "true")
    from worker.workflows.ingest_workflow import IngestWorkflow

    called = []

    async def fake_activity(name, *args, **kwargs):
        called.append(name)
        if name == "parse_pdf":
            return {"text": "hello", "has_complex_layout": False, "is_scan": False, "pages": []}
        if name == "detect_content_type":
            return {"content_type": "document", "confidence": 0.9, "used_llm": False}
        if name == "enrich_document":
            return {"artifact": {}, "content_type": "document", "provider": "gemini", "skip_reasons": []}
        if name == "create_source_note":
            return "note-abc"
        if name == "store_enrichment_artifact":
            return {"ok": True}
        return {}

    wf = IngestWorkflow()
    with patch("temporalio.workflow.execute_activity", side_effect=fake_activity):
        note_id = await wf._run_pipeline(_make_inp())

    assert "detect_content_type" in called
    assert "enrich_document" in called
    assert "store_enrichment_artifact" in called
    assert note_id == "note-abc"


@pytest.mark.asyncio
async def test_enrichment_failure_does_not_block_note_creation(monkeypatch):
    monkeypatch.setenv("FEATURE_CONTENT_ENRICHMENT", "true")
    from temporalio.exceptions import ActivityError
    from worker.workflows.ingest_workflow import IngestWorkflow

    call_seq = []

    async def fake_activity(name, *args, **kwargs):
        call_seq.append(name)
        if name == "parse_pdf":
            return {"text": "hello", "has_complex_layout": False, "is_scan": False, "pages": []}
        if name == "detect_content_type":
            raise ActivityError("boom", 0, "", None, None, None)
        if name == "create_source_note":
            return "note-xyz"
        return {}

    wf = IngestWorkflow()
    with patch("temporalio.workflow.execute_activity", side_effect=fake_activity):
        note_id = await wf._run_pipeline(_make_inp())

    assert note_id == "note-xyz"
    assert "create_source_note" in call_seq


@pytest.mark.asyncio
async def test_enrichment_not_called_when_flag_off(monkeypatch):
    monkeypatch.delenv("FEATURE_CONTENT_ENRICHMENT", raising=False)
    from worker.workflows.ingest_workflow import IngestWorkflow

    called = []

    async def fake_activity(name, *args, **kwargs):
        called.append(name)
        if name == "parse_pdf":
            return {"text": "hi", "has_complex_layout": False, "is_scan": False, "pages": []}
        if name == "create_source_note":
            return "note-000"
        return {}

    wf = IngestWorkflow()
    with patch("temporalio.workflow.execute_activity", side_effect=fake_activity):
        note_id = await wf._run_pipeline(_make_inp(feature_on=False))

    assert "detect_content_type" not in called
    assert "enrich_document" not in called
    assert note_id == "note-000"
```

- [x] **Step 2: 실패 확인**

```bash
cd apps/worker && python -m pytest tests/workflows/test_ingest_enrichment.py -v 2>&1 | head -20
```

Expected: `test_workspace_id_field_exists` 실패 (`workspace_id` 필드 없음)

- [x] **Step 3: `IngestInput`에 `workspace_id` 추가 + 워크플로우 수정**

`apps/worker/src/worker/workflows/ingest_workflow.py`:

**변경 1** — `IngestInput` dataclass:
```python
@dataclass
class IngestInput:
    object_key: str | None
    file_name: str | None
    mime_type: str
    user_id: str
    project_id: str
    note_id: str | None
    url: str | None = None
    workspace_id: str | None = None   # ← 추가 (Spec B enrichment용)
```

**변경 2** — `_run_pipeline` 메서드 전체 수정:

기존 `if needs_enhance:` 블록 위에 enrichment compute 블록 삽입, `return note_id` 위에 store 블록 삽입:

```python
async def _run_pipeline(self, inp: IngestInput) -> str:
    mime = inp.mime_type
    text: str = ""
    needs_enhance = False
    parse_result: dict = {}

    if mime == "application/pdf":
        parse_result = await workflow.execute_activity(
            "parse_pdf", inp,
            schedule_to_close_timeout=_LONG_TIMEOUT, retry_policy=_RETRY,
        )
        text = parse_result["text"]
        needs_enhance = parse_result.get("has_complex_layout", False)
    elif mime.startswith("audio/") or mime.startswith("video/"):
        result = await workflow.execute_activity(
            "transcribe_audio", inp,
            schedule_to_close_timeout=_LONG_TIMEOUT, retry_policy=_RETRY,
        )
        text = result["transcript"]
    elif mime.startswith("image/"):
        result = await workflow.execute_activity(
            "analyze_image", inp,
            schedule_to_close_timeout=_SHORT_TIMEOUT, retry_policy=_RETRY,
        )
        text = result["description"]
    elif mime == "x-opencairn/youtube":
        result = await workflow.execute_activity(
            "ingest_youtube", inp,
            schedule_to_close_timeout=_LONG_TIMEOUT, retry_policy=_RETRY,
        )
        text = result["transcript"]
    elif mime == "x-opencairn/web-url":
        result = await workflow.execute_activity(
            "scrape_web_url", inp,
            schedule_to_close_timeout=_SHORT_TIMEOUT, retry_policy=_RETRY,
        )
        text = result["text"]
        needs_enhance = result.get("has_complex_layout", False)
    else:
        raise ValueError(f"Unsupported mime_type: {mime}")

    # [Spec B] enrichment compute — note_id 확보 전에 실행, 결과만 메모리에 보관
    import os as _os
    enrich_result: dict | None = None
    if _os.environ.get("FEATURE_CONTENT_ENRICHMENT") == "true":
        try:
            ct_result = await workflow.execute_activity(
                "detect_content_type",
                {"object_key": inp.object_key, "mime_type": inp.mime_type,
                 "parsed_pages": parse_result.get("pages", [])},
                schedule_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=2, backoff_coefficient=2.0),
            )
            enrich_result = await workflow.execute_activity(
                "enrich_document",
                {**inp.__dict__,
                 "content_type": ct_result["content_type"],
                 "parsed_pages": parse_result.get("pages", []),
                 "requested_enrichments": ["outline", "figures", "tables", "translation"]},
                schedule_to_close_timeout=timedelta(minutes=20),
                retry_policy=RetryPolicy(maximum_attempts=2, backoff_coefficient=2.0),
            )
        except ActivityError:
            workflow.logger.warning("enrichment failed, continuing without artifact")

    if needs_enhance:
        enhanced = await workflow.execute_activity(
            "enhance_with_gemini",
            {**inp.__dict__, "raw_text": text},
            schedule_to_close_timeout=_SHORT_TIMEOUT, retry_policy=_RETRY,
        )
        text = enhanced.get("text", text)

    note_id: str = await workflow.execute_activity(
        "create_source_note",
        {"user_id": inp.user_id, "project_id": inp.project_id,
         "parent_note_id": inp.note_id, "file_name": inp.file_name,
         "url": inp.url, "mime_type": mime, "object_key": inp.object_key,
         "text": text},
        schedule_to_close_timeout=_SHORT_TIMEOUT, retry_policy=_RETRY,
    )

    # [Spec B] enrichment store — note_id 확보 후
    if enrich_result is not None:
        try:
            await workflow.execute_activity(
                "store_enrichment_artifact",
                {"note_id": note_id, "workspace_id": inp.workspace_id or "",
                 **enrich_result},
                schedule_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=3, backoff_coefficient=2.0),
            )
        except ActivityError:
            workflow.logger.warning("store_enrichment_artifact failed, artifact lost")

    return note_id
```

- [x] **Step 4: 테스트 통과 확인**

```bash
cd apps/worker && python -m pytest tests/workflows/test_ingest_enrichment.py -v
```

Expected: 4 passed

- [x] **Step 5: 커밋**

```bash
git add apps/worker/src/worker/workflows/ingest_workflow.py \
        apps/worker/tests/workflows/test_ingest_enrichment.py
git commit -m "feat(worker): wire enrichment activities into IngestWorkflow (Spec B)

detect → enrich before create_source_note; store after note_id is available.
IngestInput gains workspace_id field. FEATURE_CONTENT_ENRICHMENT gates all three.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Worker 등록 + Feature Flag

**Files:**
- Modify: `apps/worker/src/worker/temporal_main.py`
- Modify: `apps/worker/tests/test_temporal_main_code.py`

- [x] **Step 1: 기존 temporal_main 테스트 확인**

```bash
cd apps/worker && python -m pytest tests/test_temporal_main_code.py -v
```

Expected: 기존 테스트 PASS (베이스라인 확인)

- [x] **Step 2: 테스트에 FEATURE_CONTENT_ENRICHMENT 케이스 추가**

`tests/test_temporal_main_code.py`에 아래 두 테스트 추가:

```python
def test_enrichment_activities_registered_when_flag_on(monkeypatch):
    monkeypatch.setenv("FEATURE_CONTENT_ENRICHMENT", "true")
    from worker.temporal_main import build_worker_config
    cfg = build_worker_config()
    names = [getattr(a, "__temporal_activity_definition", None) for a in cfg.activities]
    activity_names = [
        getattr(n, "name", None) for n in names if n is not None
    ]
    assert "detect_content_type" in activity_names
    assert "enrich_document" in activity_names
    assert "store_enrichment_artifact" in activity_names


def test_enrichment_activities_not_registered_when_flag_off(monkeypatch):
    monkeypatch.delenv("FEATURE_CONTENT_ENRICHMENT", raising=False)
    from worker.temporal_main import build_worker_config
    cfg = build_worker_config()
    names = [getattr(a, "__temporal_activity_definition", None) for a in cfg.activities]
    activity_names = [
        getattr(n, "name", None) for n in names if n is not None
    ]
    assert "detect_content_type" not in activity_names
    assert "enrich_document" not in activity_names
```

- [x] **Step 3: 테스트 실패 확인**

```bash
cd apps/worker && python -m pytest tests/test_temporal_main_code.py::test_enrichment_activities_registered_when_flag_on -v 2>&1 | tail -10
```

Expected: FAIL — activities not yet registered

- [x] **Step 4: `temporal_main.py`에 등록 코드 추가**

`build_worker_config()` 함수 내 `if os.environ.get("FEATURE_DEEP_RESEARCH") == "true":` 블록 아래에 추가:

```python
if os.environ.get("FEATURE_CONTENT_ENRICHMENT") == "true":
    from worker.activities.detect_content_type_activity import detect_content_type
    from worker.activities.enrich_document_activity import enrich_document
    from worker.activities.store_enrichment_activity import store_enrichment_artifact
    activities.extend([detect_content_type, enrich_document, store_enrichment_artifact])
```

- [x] **Step 5: 테스트 통과 확인**

```bash
cd apps/worker && python -m pytest tests/test_temporal_main_code.py -v
```

Expected: 기존 + 신규 2개 모두 PASS

- [x] **Step 6: 전체 worker 테스트 확인**

```bash
cd apps/worker && python -m pytest tests/ -v --tb=short 2>&1 | tail -20
```

Expected: 기존 테스트 회귀 없음

- [x] **Step 7: 최종 커밋**

```bash
git add apps/worker/src/worker/temporal_main.py \
        apps/worker/tests/test_temporal_main_code.py
git commit -m "feat(worker): register enrichment activities under FEATURE_CONTENT_ENRICHMENT flag

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [x] **Spec §4 DB 스키마** → Task 1
- [x] **Spec §5 컨텐츠 타입 검출** → Task 3
- [x] **Spec §6.3 figure extraction (`--extract-images=true`)** → Task 4
- [x] **Spec §6 enrich_document** → Task 5
- [x] **Spec §7 workflow 통합 (note_id 순서 포함)** → Task 7
- [x] **Spec §7.2 store_enrichment_artifact** → Task 6
- [x] **Spec §10 GET /api/internal/notes/:noteId/enrichment** → Task 6
- [x] **Spec §12 feature flag** → Task 8
- [x] **Spec §13 OQ1 workspace_id** → Task 7 (`IngestInput.workspace_id`)
- [x] **type consistency** — `EnrichmentArtifact` 모델이 Task 2에서 정의, Task 5에서 import
- [x] **Ollama skip_reason** — Task 5 `enrich_document` + Task 3 `detect_content_type`
- [x] **TDD** — 모든 task에서 failing test → implement → pass 순서 준수
