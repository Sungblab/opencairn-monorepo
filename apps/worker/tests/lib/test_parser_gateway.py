from __future__ import annotations

from datetime import UTC, datetime

import pytest

from worker.lib.canonical_document import CanonicalBlockType
from worker.lib.parser_gateway import (
    PARSER_CANDIDATES,
    CurrentParserAdapter,
    ParserGateway,
    normalize_current_parser_output,
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
