from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from worker.lib.canonical_document import (
    MAX_BLOCKS,
    MAX_CONTENT_CHARS,
    CanonicalBlock,
    CanonicalBlockType,
    CanonicalDocument,
    CanonicalDocumentSource,
)


def _source() -> CanonicalDocumentSource:
    now = datetime.now(UTC)
    return CanonicalDocumentSource(
        source_type="file",
        mime_type="application/pdf",
        original_file_key="uploads/u/doc.pdf",
        parser="current",
        parser_version=None,
        parse_started_at=now,
        parse_completed_at=now,
    )


def test_canonical_document_uses_single_content_field_projection() -> None:
    doc = CanonicalDocument(
        source=_source(),
        blocks=[
            CanonicalBlock(
                id="b2",
                type=CanonicalBlockType.PARAGRAPH,
                content="second",
                page_number=2,
                reading_order=0,
            ),
            CanonicalBlock(
                id="b1",
                type=CanonicalBlockType.HEADING,
                content="first",
                page_number=1,
                reading_order=0,
            ),
        ],
    )

    assert doc.as_plain_text() == "first\n\nsecond"


def test_canonical_document_rejects_unbounded_block_arrays() -> None:
    with pytest.raises(ValidationError):
        CanonicalDocument(
            source=_source(),
            blocks=[
                CanonicalBlock(
                    id=f"b{i}",
                    type=CanonicalBlockType.PARAGRAPH,
                    content="x",
                )
                for i in range(MAX_BLOCKS + 1)
            ],
        )


def test_canonical_block_allows_large_single_block_documents() -> None:
    block = CanonicalBlock(
        id="long-transcript",
        type=CanonicalBlockType.PARAGRAPH,
        content="x" * MAX_CONTENT_CHARS,
    )

    assert len(block.content) == MAX_CONTENT_CHARS


def test_canonical_document_rejects_duplicate_block_ids() -> None:
    with pytest.raises(ValidationError, match="block ids must be unique"):
        CanonicalDocument(
            source=_source(),
            blocks=[
                CanonicalBlock(id="dup", type=CanonicalBlockType.PARAGRAPH, content="a"),
                CanonicalBlock(id="dup", type=CanonicalBlockType.PARAGRAPH, content="b"),
            ],
        )
