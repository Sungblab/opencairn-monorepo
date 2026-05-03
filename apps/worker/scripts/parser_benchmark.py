#!/usr/bin/env python
"""Parser gateway benchmark command skeleton.

The command intentionally supports only the current baseline parser in this
Phase B preparation PR. Docling, Marker, and MinerU stay benchmark candidates
without becoming worker-core dependencies.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tracemalloc
from dataclasses import asdict, dataclass
from pathlib import Path
from time import perf_counter
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

from worker.lib.parser_gateway import PARSER_CANDIDATES


@dataclass(frozen=True)
class BenchmarkFixture:
    id: str
    description: str
    source_type: str
    mime_type: str
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
    warnings: tuple[str, ...]
    error: str | None = None


def load_fixtures(path: Path) -> list[BenchmarkFixture]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    fixtures = payload.get("fixtures")
    if not isinstance(fixtures, list):
        raise ValueError("fixture manifest must contain a fixtures array")
    return [
        BenchmarkFixture(
            id=str(item["id"]),
            description=str(item.get("description") or item["id"]),
            source_type=str(item.get("source_type") or "file"),
            mime_type=str(item["mime_type"]),
            object_key=item.get("object_key"),
            url=item.get("url"),
            expected_features=tuple(item.get("expected_features") or ()),
        )
        for item in fixtures
    ]


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
        warnings=(),
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
    return parser


async def async_main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    fixtures = load_fixtures(args.manifest)
    if not args.dry_run:
        raise SystemExit(
            "Only --dry-run is implemented in the Phase B skeleton. "
            "Wire current parser calls after fixture files are available."
        )

    results = [await run_dry_fixture(fixture, args.parser) for fixture in fixtures]
    write_jsonl(args.out, results)
    print(f"Wrote {len(results)} parser benchmark rows to {args.out}")
    return 0


def main(argv: list[str] | None = None, *, runner: Callable[..., Any] = asyncio.run) -> int:
    return int(runner(async_main(argv)))


if __name__ == "__main__":
    raise SystemExit(main())
