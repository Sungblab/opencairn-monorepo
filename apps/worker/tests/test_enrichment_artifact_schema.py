"""Spec B — EnrichmentArtifact pydantic model.

These tests define the shape of the artifact that downstream consumers
(session A UI, KG ingest, synthesis export) read out of `note_enrichments.artifact`.
"""

from __future__ import annotations

from worker.lib.enrichment_artifact import (
    ChapterNode,
    EnrichmentArtifact,
    FigureItem,
    OutlineItem,
    SectionLabels,
    SlideCard,
)


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
    a = EnrichmentArtifact(
        sections=SectionLabels(abstract="This paper...", methods="We used..."),
        citations=[],
        word_count=8000,
    )
    assert a.sections is not None
    assert a.sections.abstract == "This paper..."
    assert a.citations == []


def test_slide_artifact():
    a = EnrichmentArtifact(slides=[SlideCard(index=1, title="Intro", body="...")])
    assert len(a.slides) == 1
    assert a.slides[0].index == 1


def test_book_artifact_chapter_tree():
    node = ChapterNode(
        title="Chapter 1",
        page=10,
        children=[ChapterNode(title="1.1 Overview", page=12)],
    )
    assert len(node.children) == 1
    assert node.children[0].title == "1.1 Overview"


def test_artifact_round_trip():
    a = EnrichmentArtifact(
        word_count=500,
        outline=[OutlineItem(level=1, title="Intro", page=1)],
        figures=[FigureItem(page=2, caption="Fig 1", object_key="enrichments/x.png")],
    )
    data = a.model_dump(exclude_none=True)
    restored = EnrichmentArtifact.model_validate(data)
    assert restored.outline[0].title == "Intro"
    assert restored.figures[0].object_key == "enrichments/x.png"
