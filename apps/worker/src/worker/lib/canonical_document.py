"""Parser-agnostic document schema for parser gateway benchmarks.

This module is worker-local on purpose. Phase B needs a stable contract for
benchmarking parser candidates before any DB/API contract or ingest default
path changes.
"""
from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

MAX_PAGES = 1_000
MAX_BLOCKS = 20_000
MAX_BLOCKS_PER_PAGE = 300
MAX_TABLES = 2_000
MAX_FIGURES = 2_000
MAX_FORMULAS = 5_000
MAX_WARNINGS = 500
MAX_RELATIONSHIPS = 2_000
MAX_CONTENT_CHARS = 5_000_000


class CanonicalContentType(StrEnum):
    TEXT = "text"
    MARKDOWN = "markdown"
    HTML = "html"


class CanonicalBlockType(StrEnum):
    PARAGRAPH = "paragraph"
    HEADING = "heading"
    LIST = "list"
    TABLE = "table"
    FIGURE = "figure"
    FORMULA = "formula"
    CAPTION = "caption"
    CODE = "code"
    PAGE_HEADER = "page_header"
    PAGE_FOOTER = "page_footer"
    UNKNOWN = "unknown"


class CanonicalBBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x0: float
    y0: float
    x1: float
    y1: float

    @model_validator(mode="after")
    def validate_ordering(self) -> CanonicalBBox:
        if self.x1 < self.x0 or self.y1 < self.y0:
            raise ValueError("bbox max coordinates must be greater than min coordinates")
        return self


class CanonicalSourceOffsets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: int = Field(ge=0)
    end: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_ordering(self) -> CanonicalSourceOffsets:
        if self.end < self.start:
            raise ValueError("source offset end must be >= start")
        return self


class CanonicalRelationship(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(min_length=1, max_length=64)
    target_id: str = Field(min_length=1, max_length=200)


class CanonicalDocumentSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: str = Field(min_length=1, max_length=64)
    mime_type: str = Field(min_length=1, max_length=255)
    original_file_key: str | None = Field(default=None, max_length=2_000)
    parser: str = Field(min_length=1, max_length=100)
    parser_version: str | None = Field(default=None, max_length=100)
    parse_started_at: AwareDatetime
    parse_completed_at: AwareDatetime

    @model_validator(mode="after")
    def validate_time_order(self) -> CanonicalDocumentSource:
        if self.parse_completed_at < self.parse_started_at:
            raise ValueError("parse_completed_at must be >= parse_started_at")
        return self


class CanonicalBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=200)
    type: CanonicalBlockType
    content: str = Field(max_length=MAX_CONTENT_CHARS)
    content_type: CanonicalContentType = CanonicalContentType.TEXT
    bbox: CanonicalBBox | None = None
    page_number: int | None = Field(default=None, ge=1)
    reading_order: int | None = Field(default=None, ge=0)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    source_offsets: CanonicalSourceOffsets | None = None
    relationships: list[CanonicalRelationship] = Field(
        default_factory=list,
        max_length=MAX_RELATIONSHIPS,
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


class CanonicalPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_number: int = Field(ge=1)
    width: float | None = Field(default=None, gt=0)
    height: float | None = Field(default=None, gt=0)
    blocks: list[CanonicalBlock] = Field(default_factory=list, max_length=MAX_BLOCKS_PER_PAGE)


class CanonicalTable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=200)
    page_number: int | None = Field(default=None, ge=1)
    caption: str | None = Field(default=None, max_length=5_000)
    cells: list[list[str]] = Field(default_factory=list, max_length=2_000)
    bbox: CanonicalBBox | None = None


class CanonicalFigure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=200)
    page_number: int | None = Field(default=None, ge=1)
    caption: str | None = Field(default=None, max_length=5_000)
    object_key: str | None = Field(default=None, max_length=2_000)
    bbox: CanonicalBBox | None = None


class CanonicalFormula(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=200)
    page_number: int | None = Field(default=None, ge=1)
    content: str = Field(max_length=20_000)
    content_type: Literal["latex", "mathml", "text"] = "text"
    bbox: CanonicalBBox | None = None


class CanonicalWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=2_000)
    page_number: int | None = Field(default=None, ge=1)


class CanonicalDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: CanonicalDocumentSource
    pages: list[CanonicalPage] = Field(default_factory=list, max_length=MAX_PAGES)
    blocks: list[CanonicalBlock] = Field(default_factory=list, max_length=MAX_BLOCKS)
    tables: list[CanonicalTable] = Field(default_factory=list, max_length=MAX_TABLES)
    figures: list[CanonicalFigure] = Field(default_factory=list, max_length=MAX_FIGURES)
    formulas: list[CanonicalFormula] = Field(default_factory=list, max_length=MAX_FORMULAS)
    warnings: list[CanonicalWarning] = Field(default_factory=list, max_length=MAX_WARNINGS)
    raw_artifact_key: str | None = Field(default=None, max_length=2_000)

    @field_validator("blocks")
    @classmethod
    def validate_unique_block_ids(cls, blocks: list[CanonicalBlock]) -> list[CanonicalBlock]:
        ids = [block.id for block in blocks]
        if len(ids) != len(set(ids)):
            raise ValueError("CanonicalDocument block ids must be unique")
        return blocks

    def as_plain_text(self) -> str:
        """Return a text projection for existing note/chunk code paths."""
        return "\n\n".join(
            block.content
            for block in sorted(
                self.blocks,
                key=lambda b: (
                    b.page_number or 0,
                    b.reading_order if b.reading_order is not None else 1_000_000,
                    b.id,
                ),
            )
            if block.content and block.content_type in {
                CanonicalContentType.TEXT,
                CanonicalContentType.MARKDOWN,
            }
        )
