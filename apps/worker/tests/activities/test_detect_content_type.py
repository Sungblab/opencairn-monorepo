"""Spec B — content type detection.

Heuristics first; LLM fallback only when signals conflict (confidence < 0.7).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

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

    result = await detect_content_type(
        {"mime_type": "text/x-python", "parsed_pages": []}
    )
    assert result["content_type"] == "code"
    assert result["confidence"] == 1.0


@pytest.mark.asyncio
async def test_image_mime_returns_image():
    from worker.activities.detect_content_type_activity import detect_content_type

    result = await detect_content_type(
        {"mime_type": "image/png", "parsed_pages": []}
    )
    assert result["content_type"] == "image"
    assert result["used_llm"] is False


@pytest.mark.asyncio
async def test_paper_signals_detected():
    from worker.activities.detect_content_type_activity import detect_content_type

    pages = [
        {
            "text": (
                "Abstract: This paper presents... Keywords: machine learning "
                "doi:10.1234"
            )
        },
        {"text": "Introduction. In this study..."},
        {"text": "Methods."},
    ]
    result = await detect_content_type(
        {"mime_type": "application/pdf", "parsed_pages": pages}
    )
    assert result["content_type"] == "paper"
    assert result["confidence"] >= 0.7
    assert result["used_llm"] is False


@pytest.mark.asyncio
async def test_table_heavy_returns_table():
    from worker.activities.detect_content_type_activity import detect_content_type

    pages = [{"text": "data", "tables": [{"rows": []}]} for _ in range(10)]
    result = await detect_content_type(
        {"mime_type": "application/pdf", "parsed_pages": pages}
    )
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
    with patch(
        "worker.activities.detect_content_type_activity.get_provider",
        return_value=mock_provider,
    ):
        result = await detect_content_type(
            {"mime_type": "application/pdf", "parsed_pages": pages}
        )
    assert result["used_llm"] is True
    assert result["content_type"] == "paper"


@pytest.mark.asyncio
async def test_llm_unknown_response_falls_back_to_document():
    from worker.activities.detect_content_type_activity import detect_content_type

    mock_provider = AsyncMock()
    mock_provider.generate = AsyncMock(return_value="spreadsheet")  # not in valid set
    with patch(
        "worker.activities.detect_content_type_activity._heuristic",
        return_value=("document", 0.5),
    ):
        with patch(
            "worker.activities.detect_content_type_activity.get_provider",
            return_value=mock_provider,
        ):
            result = await detect_content_type(
                {"mime_type": "application/pdf", "parsed_pages": []}
            )
    assert result["content_type"] == "document"
    assert result["used_llm"] is True


@pytest.mark.asyncio
async def test_no_pages_returns_document():
    from worker.activities.detect_content_type_activity import detect_content_type

    result = await detect_content_type(
        {"mime_type": "application/pdf", "parsed_pages": []}
    )
    assert result["content_type"] == "document"
