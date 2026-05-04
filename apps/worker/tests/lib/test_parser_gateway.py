from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from worker.lib.canonical_document import CanonicalBlockType
from worker.lib.parser_gateway import (
    PARSER_CANDIDATES,
    CurrentParserAdapter,
    ParserGateway,
    normalize_current_parser_output,
    normalize_docling_output,
)


def _inp(mime_type: str = "application/pdf") -> dict:
    return {
        "object_key": "uploads/u/doc.pdf",
        "file_name": "doc.pdf",
        "mime_type": mime_type,
        "user_id": "u",
        "project_id": "p",
        "note_id": None,
        "workflow_id": "wf",
    }


def test_parser_candidates_do_not_make_heavy_parsers_core_dependencies() -> None:
    candidates = {candidate.name: candidate for candidate in PARSER_CANDIDATES}

    assert candidates["docling"].hard_dependency is False
    assert candidates["marker"].mode == "optional_external_service_candidate"
    assert candidates["mineru"].hard_dependency is False


def test_normalize_current_pdf_pages_to_canonical_document() -> None:
    now = datetime.now(UTC)
    doc = normalize_current_parser_output(
        {
            "text": "ignored when pages exist",
            "has_complex_layout": True,
            "pages": [
                {
                    "text": "page text",
                    "figures": [{"caption": "figure cap", "object_key": "fig.png"}],
                    "tables": [{"caption": "table cap", "cells": [["a", "b"]]}],
                }
            ],
        },
        _inp(),
        parser="current.parse_pdf",
        parser_version=None,
        parse_started_at=now,
        parse_completed_at=now,
    )

    assert doc.source.parser == "current.parse_pdf"
    assert doc.as_plain_text().startswith("page text")
    assert [block.type for block in doc.blocks] == [
        CanonicalBlockType.PARAGRAPH,
        CanonicalBlockType.TABLE,
        CanonicalBlockType.FIGURE,
    ]
    assert doc.tables[0].caption == "table cap"
    assert doc.figures[0].caption == "figure cap"
    assert doc.warnings[0].code == "complex_layout"
    offsets = [block.source_offsets for block in doc.blocks]
    assert all(offset is not None for offset in offsets)
    assert [offset.start for offset in offsets if offset is not None] == [0, 11, 22]
    assert [offset.end for offset in offsets if offset is not None] == [9, 20, 32]


def test_normalize_current_pages_uses_loop_index_for_stable_block_ids() -> None:
    now = datetime.now(UTC)
    doc = normalize_current_parser_output(
        {
            "pages": [
                {"page_number": 1, "text": "first"},
                {"page_number": 1, "text": "duplicate raw page number"},
            ],
        },
        _inp(),
        parser="current.parse_pdf",
        parser_version=None,
        parse_started_at=now,
        parse_completed_at=now,
    )

    assert [block.id for block in doc.blocks] == ["p1-b0", "p2-b0"]
    assert [block.page_number for block in doc.blocks] == [1, 1]


def test_normalize_current_huge_transcript_without_pages() -> None:
    now = datetime.now(UTC)
    transcript = "x" * 250_000
    doc = normalize_current_parser_output(
        {"transcript": transcript},
        _inp("audio/mp3"),
        parser="current.transcribe_audio",
        parser_version=None,
        parse_started_at=now,
        parse_completed_at=now,
    )

    assert len(doc.blocks) == 1
    assert doc.as_plain_text() == transcript
    assert doc.blocks[0].source_offsets is not None
    assert doc.blocks[0].source_offsets.end == len(transcript)


def test_normalize_current_handles_empty_captions_and_malformed_payloads() -> None:
    now = datetime.now(UTC)
    doc = normalize_current_parser_output(
        {
            "pages": [
                {
                    "text": "body",
                    "tables": [{"caption": ""}, "not-a-table"],
                    "figures": [{"caption": None}, "not-a-figure"],
                }
            ],
        },
        _inp(),
        parser="current.parse_pdf",
        parser_version=None,
        parse_started_at=now,
        parse_completed_at=now,
    )

    assert [block.content for block in doc.blocks] == ["body", "", "", "", ""]
    assert [block.source_offsets is None for block in doc.blocks] == [
        False,
        True,
        True,
        True,
        True,
    ]
    assert [table.caption for table in doc.tables] == [None, None]
    assert [figure.caption for figure in doc.figures] == [None, None]


def test_normalize_docling_output_to_canonical_document() -> None:
    now = datetime.now(UTC)
    doc = normalize_docling_output(
        {
            "pages": [{"page_no": 1, "size": {"width": 612, "height": 792}}],
            "tables": [
                {
                    "id": "table-1",
                    "caption": "Table caption",
                    "cells": [["A", "B"]],
                    "prov": [{"page_no": 1}],
                },
            ],
            "texts": [
                {
                    "id": "heading-1",
                    "label": "section_header",
                    "text": "Introduction",
                    "prov": [{"page_no": 1, "bbox": {"l": 10, "t": 20, "r": 200, "b": 40}}],
                },
                {
                    "id": "para-1",
                    "label": "text",
                    "text": "Body text",
                    "reading_order": 0,
                    "prov": [{"page_no": 1}],
                },
                {
                    "id": "formula-1",
                    "label": "formula",
                    "text": "E = mc^2",
                    "content_type": "latex",
                    "prov": [{"page_no": 1}],
                },
            ],
            "pictures": [{"id": "fig-1", "caption": "Figure caption", "prov": [{"page_no": 1}]}],
        },
        _inp(),
        parser="docling",
        parser_version="mock",
        parse_started_at=now,
        parse_completed_at=now,
    )

    assert doc.source.parser == "docling"
    assert doc.pages[0].width == 612
    assert [block.type for block in doc.blocks] == [
        CanonicalBlockType.HEADING,
        CanonicalBlockType.PARAGRAPH,
        CanonicalBlockType.FORMULA,
        CanonicalBlockType.TABLE,
        CanonicalBlockType.FIGURE,
    ]
    assert doc.blocks[0].bbox is not None
    assert doc.blocks[1].reading_order == 0
    assert doc.tables[0].cells == [["A", "B"]]
    assert doc.figures[0].caption == "Figure caption"
    assert doc.formulas[0].content == "E = mc^2"
    assert doc.formulas[0].content_type == "latex"
    assert doc.as_plain_text().startswith("Introduction")


def test_normalize_docling_output_rejects_malformed_root_payload() -> None:
    now = datetime.now(UTC)

    with pytest.raises(ValueError, match="Docling payload must be a JSON object"):
        normalize_docling_output(
            "not-a-dict",  # type: ignore[arg-type]
            _inp(),
            parser="docling",
            parser_version=None,
            parse_started_at=now,
            parse_completed_at=now,
        )


def test_normalize_docling_output_does_not_override_explicit_zero_page_number() -> None:
    now = datetime.now(UTC)

    with pytest.raises(ValidationError):
        normalize_docling_output(
            {"pages": [{"page_no": 0}]},
            _inp(),
            parser="docling",
            parser_version="mock",
            parse_started_at=now,
            parse_completed_at=now,
        )


def test_normalize_docling_output_records_malformed_items_as_warnings() -> None:
    now = datetime.now(UTC)
    doc = normalize_docling_output(
        {"texts": ["bad-text"], "tables": ["bad-table"], "figures": ["bad-figure"]},
        _inp(),
        parser="docling",
        parser_version=None,
        parse_started_at=now,
        parse_completed_at=now,
    )

    assert [warning.code for warning in doc.warnings] == [
        "docling_malformed_text_item",
        "docling_malformed_table_item",
        "docling_malformed_figure_item",
    ]


@pytest.mark.asyncio
async def test_parser_gateway_wraps_current_adapter() -> None:
    async def fake_parse(_inp: dict) -> dict:
        return {"text": "hello from current parser"}

    gateway = ParserGateway({
        "current": CurrentParserAdapter("current.fake", fake_parse),
    })

    doc = await gateway.parse(_inp("text/plain"))

    assert doc.source.parser == "current.fake"
    assert doc.as_plain_text() == "hello from current parser"
