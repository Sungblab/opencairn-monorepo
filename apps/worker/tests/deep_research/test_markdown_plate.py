"""Markdown → Plate conversion for Deep Research reports.

Thin wrapper over ``notion_activities.md_to_plate`` — we don't
re-implement CommonMark parsing. The Deep Research helper layers on:
  - Image URL mapping (Google URI → MinIO signed URL).
  - Empty-input guard (raises ``ConversionError``).
  - Broken-input fallback (returns a single paragraph with the raw text).
  - Missing-image degradation (falls through to the original path, which
    the Plate image block renders as a broken-image placeholder).
"""
from __future__ import annotations

import json

import pytest

from worker.activities.deep_research.markdown_plate import (
    ConversionError,
    markdown_to_plate,
)


def test_converts_heading_and_paragraph():
    md = "# Headline\n\nA short intro with a [citation](https://example.com/a)."
    result = markdown_to_plate(markdown=md, image_urls={}, citations=[])

    assert result[0]["type"] == "h1"
    assert result[0]["children"][0]["text"] == "Headline"
    assert result[1]["type"] == "p"
    # Paragraph contains an `a` (link) inline child.
    assert any(c.get("type") == "a" for c in result[1]["children"])


def test_image_with_mapping_resolves_to_minio_url():
    md = "![chart1](gs://opencairn-deep-research/chart1.png)"
    image_urls = {
        "gs://opencairn-deep-research/chart1.png": "https://minio.local/r/chart1.png",
    }
    result = markdown_to_plate(markdown=md, image_urls=image_urls, citations=[])

    img_block = next(n for n in result if n.get("type") == "image")
    assert img_block["url"] == "https://minio.local/r/chart1.png"


def test_image_without_mapping_keeps_original_url():
    # Not a hard error — the Plate image block will just show a broken
    # thumbnail, and ops can reconcile from research_run_artifacts later.
    md = "![orphan](gs://missing.png)"
    result = markdown_to_plate(markdown=md, image_urls={}, citations=[])

    img_block = next(n for n in result if n.get("type") == "image")
    assert img_block["url"] == "gs://missing.png"


def test_code_block_preserves_language():
    md = "```python\nprint('hi')\n```"
    result = markdown_to_plate(markdown=md, image_urls={}, citations=[])

    code = next(n for n in result if n.get("type") == "code_block")
    assert code.get("lang") == "python"
    assert "print('hi')" in json.dumps(code)


def test_empty_markdown_raises():
    with pytest.raises(ConversionError):
        markdown_to_plate(markdown="", image_urls={}, citations=[])


def test_whitespace_only_markdown_raises():
    with pytest.raises(ConversionError):
        markdown_to_plate(markdown="   \n\n  \t", image_urls={}, citations=[])


def test_broken_markdown_returns_fallback_paragraph(monkeypatch):
    # Force the underlying converter to raise so we exercise the except path.
    from worker.activities.deep_research import markdown_plate as mp

    def _boom(*_a, **_kw):
        raise RuntimeError("simulated parser crash")

    monkeypatch.setattr(mp, "_md_to_plate", _boom)
    result = markdown_to_plate(markdown="some markdown", image_urls={}, citations=[])

    assert len(result) == 1
    assert result[0]["type"] == "p"
    assert "some markdown" in json.dumps(result[0])
