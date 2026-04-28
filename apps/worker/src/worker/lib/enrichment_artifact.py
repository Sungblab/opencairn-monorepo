"""Spec B — pydantic models for the content-aware enrichment artifact.

`EnrichmentArtifact` is the canonical shape stored in
`note_enrichments.artifact`. Each content type populates a different
subset of fields; downstream consumers (UI, KG, synthesis export) decide
what to render based on the parent row's `content_type`.
"""

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
