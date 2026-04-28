"""Spec B — enrich_document activity.

Covers:
- document/paper/slide/code/table/image content-type branches
- Gemini multimodal preferred → text-only fallback
- Ollama: translation + image content type marked skipped
- Figure object_keys reconstructed from live-ingest-visualization upload path
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

_DOC_JSON = (
    '{"outline": [{"level": 1, "title": "Intro", "page": 1}], '
    '"figures": [], "tables": [], "word_count": 500}'
)
_PAPER_JSON = (
    '{"outline": [{"level": 1, "title": "Abstract", "page": 1}], '
    '"figures": [], "tables": [], "word_count": 3000, '
    '"sections": {"abstract": "We study...", "methods": "We used...", '
    '"references_raw": "[1] ..."}}'
)


@pytest.fixture
def gemini_provider():
    p = AsyncMock()
    p.generate_multimodal = AsyncMock(return_value=None)  # force text fallback
    p.generate = AsyncMock(return_value=_DOC_JSON)
    return p


@pytest.mark.asyncio
async def test_document_enrichment_returns_outline(gemini_provider):
    from worker.activities.enrich_document_activity import enrich_document

    with patch(
        "worker.activities.enrich_document_activity.get_provider",
        return_value=gemini_provider,
    ):
        inp = {
            "mime_type": "application/pdf",
            "content_type": "document",
            "object_key": None,
            "workspace_id": "ws-1",
            "user_id": "user-1",
            "workflow_id": "wf-abc",
            "parsed_pages": [
                {"text": "hello world " * 100, "figures": [], "tables": []}
            ],
            "requested_enrichments": ["outline"],
        }
        result = await enrich_document(inp)

    assert "artifact" in result
    assert result["artifact"]["outline"][0]["title"] == "Intro"
    assert result["content_type"] == "document"


@pytest.mark.asyncio
async def test_paper_enrichment_has_sections():
    from worker.activities.enrich_document_activity import enrich_document

    provider = AsyncMock()
    provider.generate_multimodal = AsyncMock(return_value=None)
    provider.generate = AsyncMock(return_value=_PAPER_JSON)

    with patch(
        "worker.activities.enrich_document_activity.get_provider",
        return_value=provider,
    ):
        inp = {
            "mime_type": "application/pdf",
            "content_type": "paper",
            "object_key": None,
            "workspace_id": "ws-1",
            "user_id": "user-1",
            "workflow_id": "wf-abc",
            "parsed_pages": [
                {"text": "abstract methods results", "figures": [], "tables": []}
            ],
            "requested_enrichments": ["outline", "sections"],
        }
        result = await enrich_document(inp)

    sections = result["artifact"].get("sections")
    assert sections is not None
    assert sections.get("abstract") == "We study..."


@pytest.mark.asyncio
async def test_ollama_translation_skipped(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    from worker.activities.enrich_document_activity import enrich_document

    provider = AsyncMock()
    provider.generate_multimodal = AsyncMock(return_value=None)
    provider.generate = AsyncMock(return_value=_DOC_JSON)

    with patch(
        "worker.activities.enrich_document_activity.get_provider",
        return_value=provider,
    ):
        inp = {
            "mime_type": "application/pdf",
            "content_type": "document",
            "object_key": None,
            "workspace_id": "ws-1",
            "user_id": "user-1",
            "workflow_id": "wf-abc",
            "parsed_pages": [{"text": "hello", "figures": [], "tables": []}],
            "requested_enrichments": ["translation"],
        }
        result = await enrich_document(inp)

    assert "translation_provider_unsupported" in result["skip_reasons"]
    assert result["artifact"].get("translation") is None


@pytest.mark.asyncio
async def test_figure_object_keys_match_parse_pdf_layout():
    """parse_pdf already uploaded figures; enrich just records the keys."""
    from worker.activities.enrich_document_activity import enrich_document

    pages = [
        {
            "text": "fig page",
            "figures": [{"file": "p0-f0.png", "caption": "Fig 1"}],
            "tables": [],
        },
        {
            "text": "another",
            "figures": [{"file": "p1-f0.png", "caption": "Fig 2"}],
            "tables": [],
        },
    ]

    provider = AsyncMock()
    provider.generate_multimodal = AsyncMock(return_value=None)
    provider.generate = AsyncMock(
        return_value='{"outline":[],"figures":[],"tables":[],"word_count":0}'
    )

    with patch(
        "worker.activities.enrich_document_activity.get_provider",
        return_value=provider,
    ):
        inp = {
            "mime_type": "application/pdf",
            "content_type": "document",
            "object_key": None,
            "workspace_id": "ws-1",
            "user_id": "user-1",
            "workflow_id": "wf-abc",
            "parsed_pages": pages,
            "requested_enrichments": ["figures"],
        }
        result = await enrich_document(inp)

    figures = result["artifact"]["figures"]
    assert len(figures) == 2
    assert (
        figures[0]["object_key"]
        == "uploads/user-1/figures/wf-abc/p0-f0.png"
    )
    assert figures[1]["page"] == 1
    assert figures[1]["caption"] == "Fig 2"


@pytest.mark.asyncio
async def test_slide_enrichment_constructs_cards_without_llm():
    from worker.activities.enrich_document_activity import enrich_document

    provider = AsyncMock()
    # Slides should NOT call provider.generate
    provider.generate = AsyncMock(side_effect=AssertionError("LLM should not run"))
    provider.generate_multimodal = AsyncMock(
        side_effect=AssertionError("LLM should not run")
    )

    pages = [
        {"text": "Slide 1 Title\nbullet a\nbullet b", "figures": [], "tables": []},
        {"text": "Slide 2 Title\nbullet c", "figures": [], "tables": []},
    ]

    with patch(
        "worker.activities.enrich_document_activity.get_provider",
        return_value=provider,
    ):
        inp = {
            "mime_type": "application/pdf",
            "content_type": "slide",
            "object_key": None,
            "workspace_id": "ws-1",
            "user_id": "user-1",
            "workflow_id": "wf-abc",
            "parsed_pages": pages,
            "requested_enrichments": [],
        }
        result = await enrich_document(inp)

    slides = result["artifact"]["slides"]
    assert len(slides) == 2
    assert slides[0]["title"] == "Slide 1 Title"
    assert "bullet a" in slides[0]["body"]


@pytest.mark.asyncio
async def test_code_enrichment_extracts_python_symbols():
    from worker.activities.enrich_document_activity import enrich_document

    provider = AsyncMock()
    provider.generate = AsyncMock(side_effect=AssertionError("LLM should not run"))
    provider.generate_multimodal = AsyncMock(
        side_effect=AssertionError("LLM should not run")
    )

    code = '''def hello(name):
    """Say hi."""
    return "hi " + name

class Greeter:
    """Greet things."""
    def greet(self):
        return "hello"
'''

    with patch(
        "worker.activities.enrich_document_activity.get_provider",
        return_value=provider,
    ):
        inp = {
            "mime_type": "text/x-python",
            "content_type": "code",
            "object_key": None,
            "workspace_id": "ws-1",
            "user_id": "user-1",
            "workflow_id": "wf-abc",
            "parsed_pages": [{"text": code, "figures": [], "tables": []}],
            "requested_enrichments": [],
        }
        result = await enrich_document(inp)

    symbols = result["artifact"]["symbol_tree"]
    names = {s["name"] for s in symbols}
    assert "hello" in names
    assert "Greeter" in names
    assert "greet" in names


@pytest.mark.asyncio
async def test_ollama_image_skipped(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    from worker.activities.enrich_document_activity import enrich_document

    provider = AsyncMock()
    provider.generate_multimodal = AsyncMock(return_value=None)
    provider.generate = AsyncMock(return_value="{}")

    with patch(
        "worker.activities.enrich_document_activity.get_provider",
        return_value=provider,
    ):
        inp = {
            "mime_type": "image/png",
            "content_type": "image",
            "object_key": "img.png",
            "workspace_id": "ws-1",
            "user_id": "user-1",
            "workflow_id": "wf-abc",
            "parsed_pages": [],
            "requested_enrichments": [],
        }
        result = await enrich_document(inp)

    assert "image_provider_unsupported" in result["skip_reasons"]


@pytest.mark.asyncio
async def test_translation_with_braces_in_source():
    """Regression: paper sections with stray `{` in JSON-like math must not
    crash the prompt builder (str.format would fail; we now concatenate)."""
    from worker.activities.enrich_document_activity import enrich_document

    paper_with_braces = (
        '{"outline":[],"figures":[],"tables":[],"word_count":1000,'
        '"sections":{"abstract":"Let f(x) = {x | x \\\\in R}. We show..."}}'
    )

    provider = AsyncMock()
    provider.generate_multimodal = AsyncMock(return_value=None)
    # First call returns the artifact JSON; second call returns the translation.
    provider.generate = AsyncMock(
        side_effect=[paper_with_braces, "한국어 번역"]
    )

    with patch(
        "worker.activities.enrich_document_activity.get_provider",
        return_value=provider,
    ):
        inp = {
            "mime_type": "application/pdf",
            "content_type": "paper",
            "object_key": None,
            "workspace_id": "ws-1",
            "user_id": "user-1",
            "workflow_id": "wf-abc",
            "parsed_pages": [
                {"text": "abstract", "figures": [], "tables": []}
            ],
            "requested_enrichments": ["sections", "translation"],
        }
        result = await enrich_document(inp)

    assert result["artifact"]["translation"]["text"] == "한국어 번역"
