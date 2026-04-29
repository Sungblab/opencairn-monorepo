import pytest
from pydantic import ValidationError
from worker.agents.synthesis.schemas import (
    SynthesisOutputSchema,
    BibEntry,
    SynthesisSection,
)
from worker.tools_builtin.schema_registry import SCHEMA_REGISTRY


def test_synthesis_output_round_trip():
    payload = {
        "format": "latex",
        "title": "Quantum Computing Survey",
        "abstract": "abstract text",
        "sections": [
            {
                "title": "Introduction",
                "content": "Intro text \\cite{src:abc12345}",
                "source_ids": ["abc12345"],
            },
        ],
        "bibliography": [
            {
                "cite_key": "src:abc12345",
                "author": "Doe",
                "title": "Paper Title",
                "year": 2024,
                "url": "https://example.com",
                "source_id": "abc12345",
            },
        ],
        "template": "ieee",
    }
    obj = SynthesisOutputSchema.model_validate(payload)
    assert obj.format == "latex"
    assert len(obj.sections) == 1
    assert obj.sections[0].source_ids == ["abc12345"]


def test_rejects_unknown_format():
    with pytest.raises(ValidationError):
        SynthesisOutputSchema.model_validate(
            {"format": "pptx", "title": "x", "abstract": None, "sections": [], "bibliography": [], "template": "ieee"}
        )


def test_registered_in_schema_registry():
    assert "SynthesisOutputSchema" in SCHEMA_REGISTRY
    assert SCHEMA_REGISTRY["SynthesisOutputSchema"] is SynthesisOutputSchema
