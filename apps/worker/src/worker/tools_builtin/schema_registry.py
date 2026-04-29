"""Pydantic schema registry for `emit_structured_output`.

Sub-project A ships a tiny demo schema set; B expands. Registration is
explicit (no auto-discovery) so the tool rejects unknown names with a
clear error the LLM can correct.
"""
from __future__ import annotations

from pydantic import BaseModel

SCHEMA_REGISTRY: dict[str, type[BaseModel]] = {}


def register_schema(name: str, model: type[BaseModel]) -> None:
    SCHEMA_REGISTRY[name] = model


# Demo schemas used by ToolDemoAgent ------------------------------------


class ConceptSummary(BaseModel):
    concept_id: str
    title: str
    synopsis: str
    confidence: float


class ResearchAnswer(BaseModel):
    question: str
    answer: str
    supporting_note_ids: list[str]
    confidence: float


register_schema("ConceptSummary", ConceptSummary)
register_schema("ResearchAnswer", ResearchAnswer)


# Synthesis schema ------------------------------------------------------

from worker.agents.synthesis.schemas import SynthesisOutputSchema  # noqa: E402

register_schema("SynthesisOutputSchema", SynthesisOutputSchema)
