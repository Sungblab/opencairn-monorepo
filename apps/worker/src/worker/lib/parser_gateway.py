"""Parser gateway skeleton for Phase B benchmarking.

The production ingest workflow still calls the existing parser activities
directly. This module exists so benchmarks and tests can normalize current
parser outputs into CanonicalDocument before any default-path replacement.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import Any, Protocol, cast

from worker.lib.canonical_document import (
    CanonicalBlock,
    CanonicalBlockType,
    CanonicalContentType,
    CanonicalDocument,
    CanonicalDocumentSource,
    CanonicalFigure,
    CanonicalPage,
    CanonicalSourceOffsets,
    CanonicalTable,
    CanonicalWarning,
)

ParseCallable = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class ParserAdapter(Protocol):
    name: str
    version: str | None

    async def parse(self, inp: dict[str, Any]) -> CanonicalDocument: ...


@dataclass(frozen=True)
class ParserCandidate:
    """Benchmark candidate metadata without importing candidate dependencies."""

    name: str
    mode: str
    hard_dependency: bool
    notes: str


PARSER_CANDIDATES: tuple[ParserCandidate, ...] = (
    ParserCandidate(
        name="current",
        mode="in_process_baseline",
        hard_dependency=True,
        notes="Existing opendataloader-pdf, PyMuPDF, MarkItDown, trafilatura, STT paths.",
    ),
    ParserCandidate(
        name="docling",
        mode="benchmark_candidate",
        hard_dependency=False,
        notes="Candidate only until CPU/RAM fixture results justify a dependency decision.",
    ),
    ParserCandidate(
        name="marker",
        mode="optional_external_service_candidate",
        hard_dependency=False,
        notes="License, GPU, VRAM, and footprint risks keep Marker outside worker core.",
    ),
    ParserCandidate(
        name="mineru",
        mode="benchmark_candidate",
        hard_dependency=False,
        notes="Candidate only until license, quality, and deployment footprint are measured.",
    ),
)


class CurrentParserAdapter:
    """Wrap an existing parser activity and normalize its dict output."""

    name = "current"

    def __init__(
        self,
        parser_name: str,
        parse_fn: ParseCallable,
        *,
        version: str | None = None,
    ) -> None:
        self.parser_name = parser_name
        self.parse_fn = parse_fn
        self.version = version

    async def parse(self, inp: dict[str, Any]) -> CanonicalDocument:
        started = datetime.now(UTC)
        raw = await self.parse_fn(inp)
        completed = datetime.now(UTC)
        return normalize_current_parser_output(
            raw,
            inp,
            parser=self.parser_name,
            parser_version=self.version,
            parse_started_at=started,
            parse_completed_at=completed,
        )


class ParserGateway:
    """Feature-flag-ready gateway; currently selects only baseline adapters."""

    def __init__(self, adapters: dict[str, ParserAdapter]) -> None:
        self.adapters = adapters

    async def parse(self, inp: dict[str, Any], *, parser: str = "current") -> CanonicalDocument:
        try:
            adapter = self.adapters[parser]
        except KeyError as exc:
            raise ValueError(f"Unknown parser adapter: {parser}") from exc
        return await adapter.parse(inp)


def normalize_current_parser_output(
    raw: dict[str, Any],
    inp: dict[str, Any],
    *,
    parser: str,
    parser_version: str | None,
    parse_started_at: datetime,
    parse_completed_at: datetime,
) -> CanonicalDocument:
    """Normalize today's activity result shape into CanonicalDocument."""
    source = CanonicalDocumentSource(
        source_type=_source_type_for_mime(str(inp.get("mime_type") or "")),
        mime_type=str(inp.get("mime_type") or "application/octet-stream"),
        original_file_key=inp.get("object_key"),
        parser=parser,
        parser_version=parser_version,
        parse_started_at=parse_started_at,
        parse_completed_at=parse_completed_at,
    )

    raw_pages = raw.get("pages")
    pages_payload: list[Any] = raw_pages if isinstance(raw_pages, list) else []
    pages: list[CanonicalPage] = []
    blocks: list[CanonicalBlock] = []
    tables: list[CanonicalTable] = []
    figures: list[CanonicalFigure] = []

    offset = 0

    def append_block(target: list[CanonicalBlock], block: CanonicalBlock) -> None:
        nonlocal offset
        target.append(block)
        blocks.append(block)
        if block.content and block.source_offsets is not None:
            offset = block.source_offsets.end + 2

    for page_index, page_payload in enumerate(pages_payload, start=1):
        page = page_payload if isinstance(page_payload, dict) else {}
        page_number = int(page.get("page_number") or page.get("page") or page_index)
        page_id = f"p{page_index}"
        page_blocks: list[CanonicalBlock] = []
        page_text = str(page.get("text") or "").strip()
        if page_text:
            append_block(
                page_blocks,
                _block(
                    f"{page_id}-b0",
                    CanonicalBlockType.PARAGRAPH,
                    page_text,
                    page_number=page_number,
                    reading_order=0,
                    source_start=offset,
                ),
            )

        raw_tables = page.get("tables")
        table_payloads: list[Any] = (
            cast("list[Any]", raw_tables) if isinstance(raw_tables, list) else []
        )
        for table_index, raw_table_payload in enumerate(table_payloads):
            table_payload = raw_table_payload if isinstance(raw_table_payload, dict) else {}
            table_id = f"{page_id}-t{table_index}"
            table_caption = str(table_payload.get("caption") or "").strip()
            tables.append(
                CanonicalTable(
                    id=table_id,
                    page_number=page_number,
                    caption=table_caption or None,
                    cells=table_payload.get("cells") or [],
                )
            )
            append_block(
                page_blocks,
                _block(
                    table_id,
                    CanonicalBlockType.TABLE,
                    table_caption,
                    page_number=page_number,
                    reading_order=len(page_blocks),
                    source_start=offset if table_caption else None,
                ),
            )

        raw_figures = page.get("figures")
        figure_payloads: list[Any] = (
            cast("list[Any]", raw_figures) if isinstance(raw_figures, list) else []
        )
        for figure_index, raw_figure_payload in enumerate(figure_payloads):
            figure_payload = raw_figure_payload if isinstance(raw_figure_payload, dict) else {}
            figure_id = f"{page_id}-f{figure_index}"
            figure_caption = str(figure_payload.get("caption") or "").strip()
            figures.append(
                CanonicalFigure(
                    id=figure_id,
                    page_number=page_number,
                    caption=figure_caption or None,
                    object_key=figure_payload.get("object_key"),
                )
            )
            append_block(
                page_blocks,
                _block(
                    figure_id,
                    CanonicalBlockType.FIGURE,
                    figure_caption,
                    page_number=page_number,
                    reading_order=len(page_blocks),
                    source_start=offset if figure_caption else None,
                ),
            )

        pages.append(
            CanonicalPage(
                page_number=page_number,
                width=page.get("width"),
                height=page.get("height"),
                blocks=page_blocks,
            )
        )

    if not blocks:
        text = str(raw.get("text") or raw.get("transcript") or raw.get("description") or "").strip()
        if text:
            blocks.append(
                _block(
                    "document-b0",
                    CanonicalBlockType.PARAGRAPH,
                    text,
                    page_number=None,
                    reading_order=0,
                    source_start=0,
                )
            )

    warnings = []
    if raw.get("has_complex_layout"):
        warnings.append(
            CanonicalWarning(
                code="complex_layout",
                message="Current parser flagged this document for multimodal enhancement.",
            )
        )
    if raw.get("is_scan"):
        warnings.append(
            CanonicalWarning(
                code="scan_pdf",
                message="Current parser used OCR for an image-only PDF.",
            )
        )

    return CanonicalDocument(
        source=source,
        pages=pages,
        blocks=blocks,
        tables=tables,
        figures=figures,
        warnings=warnings,
    )


async def parse_with_metrics(
    adapter: ParserAdapter,
    inp: dict[str, Any],
) -> tuple[CanonicalDocument, float]:
    """Return document plus wall-clock seconds; peak RAM is measured by CLI."""
    start = perf_counter()
    doc = await adapter.parse(inp)
    return doc, perf_counter() - start


def _block(
    block_id: str,
    block_type: CanonicalBlockType,
    content: str,
    *,
    page_number: int | None,
    reading_order: int,
    source_start: int | None = None,
) -> CanonicalBlock:
    return CanonicalBlock(
        id=block_id,
        type=block_type,
        content=content,
        content_type=CanonicalContentType.TEXT,
        page_number=page_number,
        reading_order=reading_order,
        source_offsets=CanonicalSourceOffsets(
            start=source_start,
            end=source_start + len(content),
        )
        if source_start is not None
        else None,
    )


def _source_type_for_mime(mime_type: str) -> str:
    if mime_type == "x-opencairn/web-url":
        return "web"
    if mime_type == "x-opencairn/youtube":
        return "youtube"
    if mime_type.startswith("audio/") or mime_type.startswith("video/"):
        return "media"
    if mime_type.startswith("image/"):
        return "image"
    return "file"
