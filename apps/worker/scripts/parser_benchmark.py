#!/usr/bin/env python
"""Parser gateway benchmark command skeleton.

The command intentionally supports only the current baseline parser in this
Phase B preparation PR. Docling, Marker, and MinerU stay benchmark candidates
without becoming worker-core dependencies.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import shutil
import sys
import tempfile
import tracemalloc
from dataclasses import asdict, dataclass, field
from pathlib import Path
from time import perf_counter
from typing import TYPE_CHECKING, Any
from unittest.mock import patch

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from worker.lib.canonical_document import CanonicalDocument

from worker.lib.parser_gateway import (
    PARSER_CANDIDATES,
    CurrentParserAdapter,
    DoclingParserAdapter,
    ParserAdapter,
    ParserUnavailableError,
    parse_with_metrics,
)

_OFFICE_MIMES = frozenset({
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.ms-powerpoint",
    "application/vnd.ms-excel",
})

_HWP_MIMES = frozenset({
    "application/x-hwp",
    "application/haansofthwp",
    "application/vnd.hancom.hwp",
    "application/vnd.hancom.hwpx",
})

_TEXT_MIMES = frozenset({"text/plain", "text/markdown"})

_UNSUPPORTED_CURRENT_MIME_PREFIXES = ("image/", "audio/", "video/")
_UNSUPPORTED_CURRENT_MIMES = frozenset({"x-opencairn/youtube"})


@dataclass(frozen=True)
class BenchmarkFixture:
    id: str
    description: str
    source_type: str
    mime_type: str
    local_path: Path | None = None
    object_key: str | None = None
    url: str | None = None
    expected_features: tuple[str, ...] = ()


@dataclass(frozen=True)
class BenchmarkResult:
    fixture_id: str
    parser: str
    status: str
    wall_clock_ms: int
    peak_python_heap_bytes: int
    peak_rss_bytes: int | None
    pages: int
    blocks: int
    tables: int
    figures: int
    formulas: int
    plain_text_chars: int
    expected_features: tuple[str, ...]
    warnings: tuple[str, ...]
    quality_scores: dict[str, float] = field(default_factory=dict)
    quality_notes: tuple[str, ...] = ()
    error: str | None = None


def load_fixtures(path: Path, *, local_root: Path | None = None) -> list[BenchmarkFixture]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    fixtures = payload.get("fixtures")
    if not isinstance(fixtures, list):
        raise ValueError("fixture manifest must contain a fixtures array")
    base = local_root or path.parent
    out: list[BenchmarkFixture] = []
    for item in fixtures:
        raw_local_path = item.get("local_path")
        local_path = None
        if raw_local_path:
            local_path = Path(str(raw_local_path))
            if not local_path.is_absolute():
                local_path = base / local_path
        out.append(
            BenchmarkFixture(
                id=str(item["id"]),
                description=str(item.get("description") or item["id"]),
                source_type=str(item.get("source_type") or "file"),
                mime_type=str(item["mime_type"]),
                local_path=local_path,
                object_key=item.get("object_key"),
                url=item.get("url"),
                expected_features=tuple(item.get("expected_features") or ()),
            )
        )
    return out


async def run_dry_fixture(fixture: BenchmarkFixture, parser: str) -> BenchmarkResult:
    """Validate manifest shape without invoking object storage or parsers."""
    start = perf_counter()
    tracemalloc.start()
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return BenchmarkResult(
        fixture_id=fixture.id,
        parser=parser,
        status="dry_run",
        wall_clock_ms=int((perf_counter() - start) * 1000),
        peak_python_heap_bytes=peak,
        peak_rss_bytes=_peak_rss_bytes(),
        pages=0,
        blocks=0,
        tables=0,
        figures=0,
        formulas=0,
        plain_text_chars=0,
        expected_features=fixture.expected_features,
        quality_scores=_empty_quality_scores(),
        warnings=(),
    )


async def run_current_fixture(fixture: BenchmarkFixture) -> BenchmarkResult:
    """Run one fixture through the current parser baseline."""
    start = perf_counter()
    tracemalloc.start()
    try:
        if fixture.local_path is not None and not fixture.local_path.exists():
            return _result(
                fixture,
                parser="current",
                status="skipped",
                started_at=start,
                peak_python_heap_bytes=_stop_tracemalloc(),
                error=f"local_path not found: {fixture.local_path}",
            )
        adapter = _current_adapter_for(fixture)
        if adapter is None:
            return _result(
                fixture,
                parser="current",
                status="skipped",
                started_at=start,
                peak_python_heap_bytes=_stop_tracemalloc(),
                error=f"current parser benchmark does not execute {fixture.mime_type} yet",
            )
        inp = _activity_input_for(fixture)
        async with _benchmark_activity_patches(fixture):
            doc, wall_clock_s = await parse_with_metrics(adapter, inp)
        _current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        return _result_from_doc(
            fixture,
            doc,
            wall_clock_ms=int(wall_clock_s * 1000),
            peak_python_heap_bytes=peak,
        )
    except Exception as exc:  # noqa: BLE001 - benchmark rows should capture per-fixture failures.
        return _result(
            fixture,
            parser="current",
            status="failed",
            started_at=start,
            peak_python_heap_bytes=_stop_tracemalloc(),
            error=f"{type(exc).__name__}: {exc}",
        )


async def run_docling_fixture(fixture: BenchmarkFixture) -> BenchmarkResult:
    """Run one fixture through Docling when it is installed in the benchmark env."""
    start = perf_counter()
    tracemalloc.start()
    try:
        if fixture.local_path is None:
            return _result(
                fixture,
                parser="docling",
                status="skipped",
                started_at=start,
                peak_python_heap_bytes=_stop_tracemalloc(),
                error="docling benchmark requires local_path; object storage wiring is not enabled",
            )
        if not fixture.local_path.exists():
            return _result(
                fixture,
                parser="docling",
                status="skipped",
                started_at=start,
                peak_python_heap_bytes=_stop_tracemalloc(),
                error=f"local_path not found: {fixture.local_path}",
            )
        doc, wall_clock_s = await parse_with_metrics(
            DoclingParserAdapter(),
            _activity_input_for(fixture),
        )
        _current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        return _result_from_doc(
            fixture,
            doc,
            wall_clock_ms=int(wall_clock_s * 1000),
            peak_python_heap_bytes=peak,
        )
    except ParserUnavailableError as exc:
        return _result(
            fixture,
            parser="docling",
            status="skipped",
            started_at=start,
            peak_python_heap_bytes=_stop_tracemalloc(),
            error=str(exc),
        )
    except Exception as exc:  # noqa: BLE001 - benchmark rows should capture per-fixture failures.
        return _result(
            fixture,
            parser="docling",
            status="failed",
            started_at=start,
            peak_python_heap_bytes=_stop_tracemalloc(),
            error=f"{type(exc).__name__}: {exc}",
        )


def write_jsonl(path: Path, rows: list[BenchmarkResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(asdict(row), ensure_ascii=False, sort_keys=True))
            f.write("\n")


def _peak_rss_bytes() -> int | None:
    """Best-effort process peak RSS without adding psutil as a dependency."""
    if os.name == "nt":
        return None
    try:
        import resource
    except ImportError:
        return None
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return int(usage)
    return int(usage) * 1024


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark parser gateway candidates.")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("benchmarks/parser-fixtures.example.json"),
        help="Fixture manifest JSON path, relative to apps/worker by default.",
    )
    parser.add_argument(
        "--parser",
        choices=[candidate.name for candidate in PARSER_CANDIDATES],
        default="current",
        help="Parser candidate to benchmark.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("benchmarks/results/parser-benchmark.jsonl"),
        help="JSONL result output path, relative to apps/worker by default.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate fixture manifest and output schema without running parsers.",
    )
    parser.add_argument(
        "--local-root",
        type=Path,
        default=None,
        help=(
            "Base directory for relative fixture local_path values. "
            "Defaults to the manifest's parent directory."
        ),
    )
    return parser


async def async_main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    fixtures = load_fixtures(args.manifest, local_root=args.local_root)
    if args.parser in {"marker", "mineru"} and not args.dry_run:
        raise SystemExit(
            "Only current and Docling have non-dry execution wiring. "
            "Marker and MinerU remain benchmark gap candidates only."
        )
    if args.dry_run:
        results = [await run_dry_fixture(fixture, args.parser) for fixture in fixtures]
    elif args.parser == "docling":
        results = [await run_docling_fixture(fixture) for fixture in fixtures]
    else:
        results = [await run_current_fixture(fixture) for fixture in fixtures]

    write_jsonl(args.out, results)
    print(f"Wrote {len(results)} parser benchmark rows to {args.out}")
    return 0


def main(argv: list[str] | None = None, *, runner: Callable[..., Any] = asyncio.run) -> int:
    return int(runner(async_main(argv)))


def _activity_input_for(fixture: BenchmarkFixture) -> dict[str, Any]:
    object_key = fixture.object_key
    if fixture.local_path is not None:
        object_key = f"local-fixtures/{fixture.local_path.name}"
    return {
        "object_key": object_key,
        "file_name": fixture.local_path.name if fixture.local_path else object_key,
        "mime_type": fixture.mime_type,
        "user_id": "benchmark-user",
        "project_id": "benchmark-project",
        "note_id": None,
        "workspace_id": "benchmark-workspace",
        "url": fixture.url,
        "workflow_id": f"parser-benchmark-{fixture.id}",
        "started_at_ms": 0,
        "_benchmark_local_path": str(fixture.local_path) if fixture.local_path else None,
    }


def _current_adapter_for(fixture: BenchmarkFixture) -> ParserAdapter | None:
    mime = fixture.mime_type
    if mime == "application/pdf":
        from worker.activities.pdf_activity import parse_pdf

        return CurrentParserAdapter("current.parse_pdf", parse_pdf)
    if mime in _OFFICE_MIMES:
        from worker.activities.office_activity import parse_office

        return CurrentParserAdapter("current.parse_office", parse_office)
    if mime in _HWP_MIMES:
        from worker.activities.hwp_activity import parse_hwp

        return CurrentParserAdapter("current.parse_hwp", parse_hwp)
    if mime == "x-opencairn/web-url":
        from worker.activities.web_activity import scrape_web_url

        return CurrentParserAdapter("current.scrape_web_url", scrape_web_url)
    if mime in _TEXT_MIMES:
        return CurrentParserAdapter("current.read_text_object", _parse_text_fixture)
    if mime in _UNSUPPORTED_CURRENT_MIMES or mime.startswith(_UNSUPPORTED_CURRENT_MIME_PREFIXES):
        return None
    return None


async def _parse_text_fixture(inp: dict[str, Any]) -> dict[str, str]:
    local_path = inp.get("_benchmark_local_path")
    if local_path:
        raw = Path(str(local_path)).read_bytes()
    else:
        from worker.workflows.ingest_workflow import read_text_object

        return await read_text_object(inp)
    return {"text": raw.decode("utf-8-sig")}


@contextlib.asynccontextmanager
async def _benchmark_activity_patches(fixture: BenchmarkFixture) -> AsyncIterator[None]:
    if fixture.local_path is None:
        yield
        return

    local_path = fixture.local_path
    temp_files: list[Path] = []

    def copy_local_to_tempfile(_object_key: str) -> Path:
        suffix = local_path.suffix or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_name = tmp.name
        path = Path(tmp_name)
        shutil.copyfile(local_path, path)
        temp_files.append(path)
        return path

    async def noop_publish(*_args: Any, **_kwargs: Any) -> None:
        return None

    def noop_upload(*_args: Any, **_kwargs: Any) -> None:
        return None

    def noop_heartbeat(*_args: Any, **_kwargs: Any) -> None:
        return None

    patchers = [
        patch(
            "worker.activities.pdf_activity.download_to_tempfile",
            side_effect=copy_local_to_tempfile,
        ),
        patch("worker.activities.pdf_activity.publish_safe", side_effect=noop_publish),
        patch("worker.activities.pdf_activity._upload_figure", return_value=None),
        patch("worker.activities.pdf_activity.activity.heartbeat", side_effect=noop_heartbeat),
        patch(
            "worker.activities.office_activity.download_to_tempfile",
            side_effect=copy_local_to_tempfile,
        ),
        patch("worker.activities.office_activity.publish_safe", side_effect=noop_publish),
        patch("worker.activities.office_activity.upload_object", side_effect=noop_upload),
        patch("worker.activities.office_activity.activity.heartbeat", side_effect=noop_heartbeat),
        patch(
            "worker.activities.hwp_activity.download_to_tempfile",
            side_effect=copy_local_to_tempfile,
        ),
        patch("worker.activities.hwp_activity.publish_safe", side_effect=noop_publish),
        patch("worker.activities.hwp_activity.upload_object", side_effect=noop_upload),
        patch("worker.activities.hwp_activity.activity.heartbeat", side_effect=noop_heartbeat),
    ]
    with contextlib.ExitStack() as stack:
        for patcher in patchers:
            stack.enter_context(patcher)
        try:
            yield
        finally:
            for temp_file in temp_files:
                temp_file.unlink(missing_ok=True)


_QUALITY_SCORE_KEYS = (
    "table_structure",
    "heading_structure",
    "reading_order",
    "figure_coverage",
    "formula_coverage",
    "korean_text",
    "source_offset_coverage",
    "downstream_chunk_quality",
    "overall",
)


def _empty_quality_scores() -> dict[str, float]:
    return dict.fromkeys(_QUALITY_SCORE_KEYS, 0.0)


def _quality_scores_for_doc(doc: CanonicalDocument, fixture: BenchmarkFixture) -> dict[str, float]:
    scores = {
        "table_structure": _table_structure_score(doc, fixture),
        "heading_structure": _heading_structure_score(doc, fixture),
        "reading_order": _reading_order_score(doc),
        "figure_coverage": _feature_presence_score(
            expected=_expects(fixture, "figures", "images"),
            count=len(doc.figures) + _block_count(doc, "figure"),
        ),
        "formula_coverage": _feature_presence_score(
            expected=_expects(fixture, "formulas", "formula", "equations"),
            count=len(doc.formulas) + _block_count(doc, "formula"),
        ),
        "korean_text": _korean_text_score(doc, fixture),
        "source_offset_coverage": _source_offset_coverage_score(doc),
        "downstream_chunk_quality": _downstream_chunk_quality_score(doc),
    }
    scores["overall"] = _average(scores.values())
    return {key: round(value, 4) for key, value in scores.items()}


def _quality_notes_for_doc(doc: CanonicalDocument, fixture: BenchmarkFixture) -> tuple[str, ...]:
    notes: list[str] = []
    if _expects(fixture, "tables") and not doc.tables:
        notes.append("expected_tables_missing")
    if _expects(fixture, "headings") and _block_count(doc, "heading") == 0:
        notes.append("expected_headings_missing")
    if _expects(fixture, "figures") and not doc.figures:
        notes.append("expected_figures_missing")
    if _expects(fixture, "formulas") and len(doc.formulas) + _block_count(doc, "formula") == 0:
        notes.append("expected_formulas_missing")
    if _expects(fixture, "korean_text") and _korean_char_count(doc.as_plain_text()) == 0:
        notes.append("expected_korean_text_missing")
    if _source_offset_coverage_score(doc) < 0.9:
        notes.append("source_offset_coverage_below_90_percent")
    if _downstream_chunk_quality_score(doc) < 0.8:
        notes.append("downstream_chunk_quality_below_80_percent")
    return tuple(notes)


def _table_structure_score(doc: CanonicalDocument, fixture: BenchmarkFixture) -> float:
    expected = _expects(fixture, "tables", "cell_order", "sheet_order")
    if not doc.tables:
        return 0.0 if expected else 1.0
    structured_tables = sum(1 for table in doc.tables if table.cells and any(table.cells))
    if _expects(fixture, "tables", "cell_order", "sheet_order"):
        return structured_tables / len(doc.tables)
    return 1.0 if structured_tables else 0.5


def _heading_structure_score(doc: CanonicalDocument, fixture: BenchmarkFixture) -> float:
    heading_blocks = [block for block in doc.blocks if str(block.type) == "heading"]
    expected = _expects(fixture, "headings")
    if not heading_blocks:
        return 0.0 if expected else 1.0
    with_order = sum(1 for block in heading_blocks if block.reading_order is not None)
    return with_order / len(heading_blocks)


def _reading_order_score(doc: CanonicalDocument) -> float:
    if not doc.blocks:
        return 0.0
    blocks_with_order = [block for block in doc.blocks if block.reading_order is not None]
    coverage = len(blocks_with_order) / len(doc.blocks)
    page_groups: dict[int, list[int]] = {}
    for block in blocks_with_order:
        page_groups.setdefault(block.page_number or 0, []).append(block.reading_order or 0)
    if not page_groups:
        return coverage
    monotonic_groups = sum(1 for values in page_groups.values() if values == sorted(values))
    return (coverage + monotonic_groups / len(page_groups)) / 2


def _feature_presence_score(*, expected: bool, count: int) -> float:
    if count > 0:
        return 1.0
    return 0.0 if expected else 1.0


def _korean_text_score(doc: CanonicalDocument, fixture: BenchmarkFixture) -> float:
    text = doc.as_plain_text()
    korean_chars = _korean_char_count(text)
    if korean_chars == 0:
        return 0.0 if _expects(fixture, "korean_text") else 1.0
    if not text:
        return 0.0
    return min(korean_chars / max(len(text), 1) * 20, 1.0)


def _source_offset_coverage_score(doc: CanonicalDocument) -> float:
    content_blocks = [block for block in doc.blocks if block.content]
    if not content_blocks:
        return 0.0
    covered = sum(1 for block in content_blocks if block.source_offsets is not None)
    return covered / len(content_blocks)


def _downstream_chunk_quality_score(doc: CanonicalDocument) -> float:
    plain_text = doc.as_plain_text()
    if not plain_text:
        return 0.0
    chunks = _project_downstream_chunks(doc)
    if not chunks:
        return 0.0
    non_empty_score = sum(1 for chunk in chunks if chunk.strip()) / len(chunks)
    size_score = sum(1 for chunk in chunks if 120 <= len(chunk) <= 1_800) / len(chunks)
    if len(plain_text) < 120:
        size_score = 1.0
    heading_blocks = _block_count(doc, "heading")
    heading_score = 1.0
    if heading_blocks:
        heading_score = min(
            sum(
                1
                for chunk in chunks
                for block_text in chunk.split("\n\n")
                if block_text.startswith("# ")
            )
            / heading_blocks,
            1.0,
        )
    offset_score = _source_offset_coverage_score(doc)
    return _average((non_empty_score, size_score, heading_score, offset_score))


def _project_downstream_chunks(doc: CanonicalDocument, *, max_chars: int = 1_200) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for block in sorted(
        doc.blocks,
        key=lambda b: (
            b.page_number or 0,
            b.reading_order if b.reading_order is not None else 1_000_000,
            b.id,
        ),
    ):
        if not block.content:
            continue
        prefix = "# " if str(block.type) == "heading" else ""
        text = f"{prefix}{block.content.strip()}"
        if current and current_len + len(text) + 2 > max_chars:
            chunks.append("\n\n".join(current))
            current = []
            current_len = 0
        current.append(text)
        current_len += len(text) + 2
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def _expects(fixture: BenchmarkFixture, *features: str) -> bool:
    expected = {feature.lower() for feature in fixture.expected_features}
    return any(feature in expected for feature in features)


def _block_count(doc: CanonicalDocument, block_type: str) -> int:
    return sum(1 for block in doc.blocks if str(block.type) == block_type)


def _korean_char_count(text: str) -> int:
    return sum(1 for char in text if "\uac00" <= char <= "\ud7a3")


def _average(values: Any) -> float:
    items = list(values)
    if not items:
        return 0.0
    return sum(float(value) for value in items) / len(items)


def _result_from_doc(
    fixture: BenchmarkFixture,
    doc: CanonicalDocument,
    *,
    wall_clock_ms: int,
    peak_python_heap_bytes: int,
) -> BenchmarkResult:
    plain_text = doc.as_plain_text()
    return BenchmarkResult(
        fixture_id=fixture.id,
        parser=doc.source.parser,
        status="success",
        wall_clock_ms=wall_clock_ms,
        peak_python_heap_bytes=peak_python_heap_bytes,
        peak_rss_bytes=_peak_rss_bytes(),
        pages=len(doc.pages),
        blocks=len(doc.blocks),
        tables=len(doc.tables),
        figures=len(doc.figures),
        formulas=len(doc.formulas),
        plain_text_chars=len(plain_text),
        expected_features=fixture.expected_features,
        quality_scores=_quality_scores_for_doc(doc, fixture),
        quality_notes=_quality_notes_for_doc(doc, fixture),
        warnings=tuple(warning.code for warning in doc.warnings),
    )


def _result(
    fixture: BenchmarkFixture,
    *,
    parser: str,
    status: str,
    started_at: float,
    peak_python_heap_bytes: int,
    error: str | None = None,
) -> BenchmarkResult:
    return BenchmarkResult(
        fixture_id=fixture.id,
        parser=parser,
        status=status,
        wall_clock_ms=int((perf_counter() - started_at) * 1000),
        peak_python_heap_bytes=peak_python_heap_bytes,
        peak_rss_bytes=_peak_rss_bytes(),
        pages=0,
        blocks=0,
        tables=0,
        figures=0,
        formulas=0,
        plain_text_chars=0,
        expected_features=fixture.expected_features,
        quality_scores=_empty_quality_scores(),
        warnings=(),
        error=error,
    )


def _stop_tracemalloc() -> int:
    if not tracemalloc.is_tracing():
        return 0
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return peak


if __name__ == "__main__":
    raise SystemExit(main())
