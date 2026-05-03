"""Parser gateway skeleton for Phase B benchmarking.

The production ingest workflow still calls the existing parser activities
directly. This module exists so benchmarks and tests can normalize current
parser outputs into CanonicalDocument before any default-path replacement.
"""
from __future__ import annotations

import importlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from time import perf_counter
from typing import Any, Protocol, cast

from worker.lib.canonical_document import (
    CanonicalBBox,
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


class ParserUnavailableError(RuntimeError):
    """Raised when an optional benchmark parser is not installed or configured."""


class DoclingParserAdapter:
    """Benchmark-only Docling adapter.

    Docling is intentionally imported lazily so the worker core does not gain a
    hard dependency. Operators can install/configure Docling in their benchmark
    environment and run the candidate without changing production ingest.
    """

    name = "docling"
    version: str | None = None

    async def parse(self, inp: dict[str, Any]) -> CanonicalDocument:
        source_path = inp.get("_benchmark_local_path")
        if not source_path:
            raise ParserUnavailableError("docling benchmark requires a local_path fixture")
        path = Path(str(source_path))
        if not path.exists():
            raise ParserUnavailableError(f"local_path not found: {path}")

        converter = _load_docling_converter()
        started = datetime.now(UTC)
        result = converter.convert(path)
        completed = datetime.now(UTC)
        payload = _docling_result_to_payload(result)
        return normalize_docling_output(
            payload,
            inp,
            parser="docling",
            parser_version=_docling_version(),
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


def normalize_docling_output(
    raw: dict[str, Any],
    inp: dict[str, Any],
    *,
    parser: str,
    parser_version: str | None,
    parse_started_at: datetime,
    parse_completed_at: datetime,
) -> CanonicalDocument:
    """Normalize Docling's structured output into CanonicalDocument.

    The adapter accepts plain dictionaries so tests and external-service
    adapters can exercise the same normalizer without importing Docling.
    """
    if not isinstance(raw, dict):
        raise ValueError("Docling payload must be a JSON object")

    source = CanonicalDocumentSource(
        source_type=_source_type_for_mime(str(inp.get("mime_type") or "")),
        mime_type=str(inp.get("mime_type") or "application/octet-stream"),
        original_file_key=inp.get("object_key"),
        parser=parser,
        parser_version=parser_version,
        parse_started_at=parse_started_at,
        parse_completed_at=parse_completed_at,
    )

    pages = _docling_pages(raw)
    blocks: list[CanonicalBlock] = []
    tables: list[CanonicalTable] = []
    figures: list[CanonicalFigure] = []
    warnings: list[CanonicalWarning] = []
    offset = 0

    text_items = _payload_list(raw, "texts") or _payload_list(raw, "blocks")
    for index, raw_item in enumerate(text_items):
        if not isinstance(raw_item, dict):
            warnings.append(
                CanonicalWarning(
                    code="docling_malformed_text_item",
                    message=f"Docling text item {index} is not an object.",
                )
            )
            continue
        content = _docling_text(raw_item)
        if not content:
            continue
        source_offsets = _source_offsets_from_payload(raw_item)
        if source_offsets is None:
            source_offsets = CanonicalSourceOffsets(start=offset, end=offset + len(content))
        reading_order = _int_or_none(raw_item.get("reading_order"))
        block = CanonicalBlock(
            id=str(raw_item.get("id") or f"docling-b{index}"),
            type=_docling_block_type(raw_item),
            content=content,
            content_type=_docling_content_type(raw_item),
            bbox=_bbox_from_docling_item(raw_item),
            page_number=_page_number_from_docling_item(raw_item),
            reading_order=reading_order if reading_order is not None else index,
            confidence=_float_or_none(raw_item.get("confidence")),
            source_offsets=source_offsets,
            metadata=_docling_metadata(raw_item),
        )
        blocks.append(block)
        offset = block.source_offsets.end + 2 if block.source_offsets else offset

    table_items = _payload_list(raw, "tables")
    for index, raw_item in enumerate(table_items):
        if not isinstance(raw_item, dict):
            warnings.append(
                CanonicalWarning(
                    code="docling_malformed_table_item",
                    message=f"Docling table item {index} is not an object.",
                )
            )
            continue
        table_id = str(raw_item.get("id") or f"docling-t{index}")
        caption = _string_or_none(raw_item.get("caption") or raw_item.get("text"))
        cells = _cells_from_docling_table(raw_item)
        tables.append(
            CanonicalTable(
                id=table_id,
                page_number=_page_number_from_docling_item(raw_item),
                caption=caption,
                cells=cells,
                bbox=_bbox_from_docling_item(raw_item),
            )
        )
        if caption or cells:
            content = caption or _cells_to_text(cells)
            blocks.append(
                CanonicalBlock(
                    id=f"{table_id}-block",
                    type=CanonicalBlockType.TABLE,
                    content=content,
                    content_type=CanonicalContentType.TEXT,
                    bbox=_bbox_from_docling_item(raw_item),
                    page_number=_page_number_from_docling_item(raw_item),
                    reading_order=len(blocks),
                    source_offsets=CanonicalSourceOffsets(start=offset, end=offset + len(content)),
                    metadata=_docling_metadata(raw_item),
                )
            )
            offset += len(content) + 2

    figure_items = _payload_list(raw, "figures") or _payload_list(raw, "pictures")
    for index, raw_item in enumerate(figure_items):
        if not isinstance(raw_item, dict):
            warnings.append(
                CanonicalWarning(
                    code="docling_malformed_figure_item",
                    message=f"Docling figure item {index} is not an object.",
                )
            )
            continue
        figure_id = str(raw_item.get("id") or f"docling-f{index}")
        caption = _string_or_none(raw_item.get("caption") or raw_item.get("text"))
        figures.append(
            CanonicalFigure(
                id=figure_id,
                page_number=_page_number_from_docling_item(raw_item),
                caption=caption,
                object_key=_string_or_none(raw_item.get("object_key")),
                bbox=_bbox_from_docling_item(raw_item),
            )
        )
        if caption:
            blocks.append(
                CanonicalBlock(
                    id=f"{figure_id}-block",
                    type=CanonicalBlockType.FIGURE,
                    content=caption,
                    content_type=CanonicalContentType.TEXT,
                    bbox=_bbox_from_docling_item(raw_item),
                    page_number=_page_number_from_docling_item(raw_item),
                    reading_order=len(blocks),
                    source_offsets=CanonicalSourceOffsets(start=offset, end=offset + len(caption)),
                    metadata=_docling_metadata(raw_item),
                )
            )
            offset += len(caption) + 2

    raw_warnings = _payload_list(raw, "warnings")
    for index, warning in enumerate(raw_warnings):
        if isinstance(warning, dict):
            code = str(warning.get("code") or f"docling_warning_{index}")
            message = str(warning.get("message") or code)
        else:
            code = f"docling_warning_{index}"
            message = str(warning)
        warnings.append(CanonicalWarning(code=code, message=message))

    return CanonicalDocument(
        source=source,
        pages=pages,
        blocks=blocks,
        tables=tables,
        figures=figures,
        warnings=warnings,
        raw_artifact_key=_string_or_none(raw.get("raw_artifact_key")),
    )


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


@lru_cache(maxsize=1)
def _load_docling_converter() -> Any:
    try:
        module = importlib.import_module("docling.document_converter")
    except ImportError as exc:
        raise ParserUnavailableError("docling is not installed") from exc
    converter_cls = getattr(module, "DocumentConverter", None)
    if converter_cls is None:
        raise ParserUnavailableError("docling.document_converter.DocumentConverter is missing")
    return converter_cls()


@lru_cache(maxsize=1)
def _docling_version() -> str | None:
    try:
        module = importlib.import_module("docling")
    except ImportError:
        return None
    version = getattr(module, "__version__", None)
    return str(version) if version is not None else None


def _docling_result_to_payload(result: Any) -> dict[str, Any]:
    document = getattr(result, "document", result)
    for attr in ("export_to_dict", "model_dump", "dict"):
        method = getattr(document, attr, None)
        if callable(method):
            payload = method()
            if isinstance(payload, dict):
                return payload
            raise ValueError("Docling document export did not return a JSON object")
    if isinstance(document, dict):
        return document
    raise ValueError("Docling result cannot be exported to a JSON object")


def _docling_pages(raw: dict[str, Any]) -> list[CanonicalPage]:
    raw_pages = raw.get("pages")
    page_items: list[Any]
    if isinstance(raw_pages, dict):
        page_items = list(raw_pages.values())
    elif isinstance(raw_pages, list):
        page_items = raw_pages
    else:
        return []

    pages: list[CanonicalPage] = []
    for index, raw_page in enumerate(page_items, start=1):
        if not isinstance(raw_page, dict):
            continue
        raw_size = raw_page.get("size")
        size = raw_size if isinstance(raw_size, dict) else {}
        width = raw_page.get("width") or size.get("width")
        height = raw_page.get("height") or size.get("height")
        page_number = _first_int_or_none(raw_page, ("page_no", "page_number"))
        pages.append(
            CanonicalPage(
                page_number=page_number if page_number is not None else index,
                width=_float_or_none(width),
                height=_float_or_none(height),
                blocks=[],
            )
        )
    return pages


def _payload_list(raw: dict[str, Any], key: str) -> list[Any]:
    value = raw.get(key)
    return cast("list[Any]", value) if isinstance(value, list) else []


def _docling_text(item: dict[str, Any]) -> str:
    for key in ("text", "content", "orig"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _docling_block_type(item: dict[str, Any]) -> CanonicalBlockType:
    label = str(item.get("label") or item.get("type") or "").lower()
    if label in {"title", "section_header", "heading", "header"}:
        return CanonicalBlockType.HEADING
    if label in {"list_item", "list"}:
        return CanonicalBlockType.LIST
    if label in {"caption"}:
        return CanonicalBlockType.CAPTION
    if label in {"code", "code_block"}:
        return CanonicalBlockType.CODE
    if label in {"formula", "equation"}:
        return CanonicalBlockType.FORMULA
    if label in {"page_header"}:
        return CanonicalBlockType.PAGE_HEADER
    if label in {"page_footer"}:
        return CanonicalBlockType.PAGE_FOOTER
    if label in {"paragraph", "text"}:
        return CanonicalBlockType.PARAGRAPH
    return CanonicalBlockType.UNKNOWN if label else CanonicalBlockType.PARAGRAPH


def _docling_content_type(item: dict[str, Any]) -> CanonicalContentType:
    value = str(item.get("content_type") or "").lower()
    if value == "markdown":
        return CanonicalContentType.MARKDOWN
    if value == "html":
        return CanonicalContentType.HTML
    return CanonicalContentType.TEXT


def _page_number_from_docling_item(item: dict[str, Any]) -> int | None:
    direct = _first_int_or_none(item, ("page_no", "page_number"))
    if direct is not None:
        return direct
    prov = item.get("prov")
    if isinstance(prov, list) and prov and isinstance(prov[0], dict):
        return _first_int_or_none(prov[0], ("page_no", "page_number"))
    return None


def _bbox_from_docling_item(item: dict[str, Any]) -> CanonicalBBox | None:
    bbox = item.get("bbox")
    if bbox is None:
        prov = item.get("prov")
        if isinstance(prov, list) and prov and isinstance(prov[0], dict):
            bbox = prov[0].get("bbox")
    if not isinstance(bbox, dict):
        return None
    x0 = _float_or_none(_first_present(bbox, ("x0", "l", "left")))
    y0 = _float_or_none(_first_present(bbox, ("y0", "t", "top")))
    x1 = _float_or_none(_first_present(bbox, ("x1", "r", "right")))
    y1 = _float_or_none(_first_present(bbox, ("y1", "b", "bottom")))
    if x0 is None or y0 is None or x1 is None or y1 is None:
        return None
    return CanonicalBBox(x0=x0, y0=y0, x1=x1, y1=y1)


def _source_offsets_from_payload(item: dict[str, Any]) -> CanonicalSourceOffsets | None:
    raw_offsets = item.get("source_offsets")
    if isinstance(raw_offsets, dict):
        start = _int_or_none(raw_offsets.get("start"))
        end = _int_or_none(raw_offsets.get("end"))
    else:
        start = _int_or_none(item.get("char_start") or item.get("start"))
        end = _int_or_none(item.get("char_end") or item.get("end"))
    if start is None or end is None:
        return None
    return CanonicalSourceOffsets(start=start, end=end)


def _cells_from_docling_table(item: dict[str, Any]) -> list[list[str]]:
    raw_cells = item.get("cells")
    if isinstance(raw_cells, list) and all(isinstance(row, list) for row in raw_cells):
        return [[str(cell) for cell in row] for row in raw_cells]
    data = item.get("data")
    if isinstance(data, dict):
        table_cells = data.get("table_cells")
        if isinstance(table_cells, list):
            rows: dict[int, dict[int, str]] = {}
            for cell in table_cells:
                if not isinstance(cell, dict):
                    continue
                row = _int_or_none(cell.get("start_row_offset_idx")) or 0
                col = _int_or_none(cell.get("start_col_offset_idx")) or 0
                rows.setdefault(row, {})[col] = str(cell.get("text") or "")
            return [
                [cols.get(col, "") for col in range(max(cols.keys(), default=-1) + 1)]
                for _row, cols in sorted(rows.items())
            ]
    return []


def _cells_to_text(cells: list[list[str]]) -> str:
    return "\n".join("\t".join(row) for row in cells)


def _docling_metadata(item: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("label", "type", "self_ref"):
        value = item.get(key)
        if isinstance(value, str):
            out[key] = value
    return out


def _string_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int_or_none(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _float_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_present(payload: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in payload:
            return payload[key]
    return None


def _first_int_or_none(payload: dict[str, Any], keys: tuple[str, ...]) -> int | None:
    for key in keys:
        if key in payload:
            value = _int_or_none(payload[key])
            if value is not None:
                return value
    return None
