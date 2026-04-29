"""Pydantic schemas for SynthesisAgent output.

Mirrors `packages/shared/src/synthesis-types.ts`. Single source of truth
for the LLM emit_structured_output payload shape.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


SynthesisFormat = Literal["latex", "docx", "pdf", "md"]
SynthesisTemplate = Literal["ieee", "acm", "apa", "korean_thesis", "report"]


class BibEntry(BaseModel):
    cite_key: str           # e.g. "src:abc12345"
    author: str
    title: str
    year: Optional[int] = None
    url: Optional[str] = None
    source_id: str          # synthesis_sources.id reference


class SynthesisSection(BaseModel):
    title: str
    content: str            # markup matches `format` (tex / html / md)
    source_ids: list[str] = Field(default_factory=list)


class SynthesisOutputSchema(BaseModel):
    format: SynthesisFormat
    title: str
    abstract: Optional[str] = None
    sections: list[SynthesisSection]
    bibliography: list[BibEntry] = Field(default_factory=list)
    template: SynthesisTemplate
