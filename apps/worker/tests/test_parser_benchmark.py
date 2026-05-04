from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from scripts import parser_benchmark
from scripts.parser_benchmark import (
    async_main,
    load_fixtures,
    run_current_fixture,
    run_docling_fixture,
)
from worker.lib.canonical_document import (
    CanonicalBlock,
    CanonicalBlockType,
    CanonicalDocument,
    CanonicalDocumentSource,
    CanonicalSourceOffsets,
)
from worker.lib.parser_gateway import ParserUnavailableError

if TYPE_CHECKING:
    from pathlib import Path


def test_load_fixture_manifest(tmp_path: Path) -> None:
    manifest = tmp_path / "fixtures.json"
    manifest.write_text(
        json.dumps({
            "fixtures": [
                {
                    "id": "pdf",
                    "description": "PDF",
                    "source_type": "file",
                    "mime_type": "application/pdf",
                    "local_path": "fixtures/sample.pdf",
                    "object_key": "benchmarks/pdf.pdf",
                    "expected_features": ["tables"],
                }
            ]
        }),
        encoding="utf-8",
    )

    fixtures = load_fixtures(manifest)

    assert fixtures[0].id == "pdf"
    assert fixtures[0].local_path == tmp_path / "fixtures" / "sample.pdf"
    assert fixtures[0].expected_features == ("tables",)


@pytest.mark.asyncio
async def test_parser_benchmark_dry_run_writes_jsonl(tmp_path: Path) -> None:
    manifest = tmp_path / "fixtures.json"
    out = tmp_path / "results.jsonl"
    manifest.write_text(
        json.dumps({
            "fixtures": [
                {
                    "id": "pdf",
                    "description": "PDF",
                    "source_type": "file",
                    "mime_type": "application/pdf",
                    "object_key": "benchmarks/pdf.pdf",
                }
            ]
        }),
        encoding="utf-8",
    )

    code = await async_main([
        "--manifest",
        str(manifest),
        "--out",
        str(out),
        "--dry-run",
    ])

    assert code == 0
    row = json.loads(out.read_text(encoding="utf-8").strip())
    assert row["fixture_id"] == "pdf"
    assert row["parser"] == "current"
    assert row["status"] == "dry_run"
    assert row["plain_text_chars"] == 0
    assert set(row["quality_scores"]) == {
        "table_structure",
        "heading_structure",
        "reading_order",
        "figure_coverage",
        "formula_coverage",
        "korean_text",
        "source_offset_coverage",
        "downstream_chunk_quality",
        "overall",
    }


@pytest.mark.asyncio
async def test_parser_benchmark_current_text_local_fixture_writes_success(
    tmp_path: Path,
) -> None:
    fixture_path = tmp_path / "sample.md"
    fixture_path.write_text("# Title\n\nBody", encoding="utf-8", newline="\n")
    manifest = tmp_path / "fixtures.json"
    out = tmp_path / "results.jsonl"
    manifest.write_text(
        json.dumps({
            "fixtures": [
                {
                    "id": "markdown",
                    "description": "Markdown",
                    "source_type": "file",
                    "mime_type": "text/markdown",
                    "local_path": str(fixture_path),
                }
            ]
        }),
        encoding="utf-8",
    )

    code = await async_main([
        "--manifest",
        str(manifest),
        "--out",
        str(out),
    ])

    assert code == 0
    row = json.loads(out.read_text(encoding="utf-8").strip())
    assert row["fixture_id"] == "markdown"
    assert row["parser"] == "current.read_text_object"
    assert row["status"] == "success"
    assert row["blocks"] == 1
    assert row["plain_text_chars"] == len(fixture_path.read_text(encoding="utf-8"))
    assert row["quality_scores"]["source_offset_coverage"] == 1.0
    assert row["quality_scores"]["downstream_chunk_quality"] == 1.0


@pytest.mark.asyncio
async def test_parser_benchmark_current_skips_unsupported_media() -> None:
    fixture = parser_benchmark.BenchmarkFixture(
        id="image",
        description="Image",
        source_type="file",
        mime_type="image/png",
    )

    result = await run_current_fixture(fixture)

    assert result.status == "skipped"
    assert "does not execute image/png yet" in str(result.error)


@pytest.mark.asyncio
async def test_parser_benchmark_current_skips_missing_local_path(tmp_path: Path) -> None:
    fixture = parser_benchmark.BenchmarkFixture(
        id="missing",
        description="Missing",
        source_type="file",
        mime_type="text/plain",
        local_path=tmp_path / "missing.txt",
    )

    result = await run_current_fixture(fixture)

    assert result.status == "skipped"
    assert "local_path not found" in str(result.error)


@pytest.mark.asyncio
async def test_parser_benchmark_docling_skips_when_not_installed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture_path = tmp_path / "sample.pdf"
    fixture_path.write_bytes(b"%PDF-1.4")
    fixture = parser_benchmark.BenchmarkFixture(
        id="pdf",
        description="PDF",
        source_type="file",
        mime_type="application/pdf",
        local_path=fixture_path,
    )

    def raise_missing() -> object:
        raise ParserUnavailableError("docling is not installed")

    monkeypatch.setattr("worker.lib.parser_gateway._load_docling_converter", raise_missing)

    result = await run_docling_fixture(fixture)

    assert result.parser == "docling"
    assert result.status == "skipped"
    assert result.error == "docling is not installed"


@pytest.mark.asyncio
async def test_parser_benchmark_docling_jsonl_schema_matches_current(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture_path = tmp_path / "sample.pdf"
    fixture_path.write_bytes(b"%PDF-1.4")
    manifest = tmp_path / "fixtures.json"
    current_out = tmp_path / "current.jsonl"
    docling_out = tmp_path / "docling.jsonl"
    manifest.write_text(
        json.dumps({
            "fixtures": [
                {
                    "id": "pdf",
                    "description": "PDF",
                    "source_type": "file",
                    "mime_type": "application/pdf",
                    "local_path": str(fixture_path),
                }
            ]
        }),
        encoding="utf-8",
    )

    async def fake_current(
        _fixture: parser_benchmark.BenchmarkFixture,
    ) -> parser_benchmark.BenchmarkResult:
        return parser_benchmark.BenchmarkResult(
            fixture_id="pdf",
            parser="current.fake",
            status="success",
            wall_clock_ms=1,
            peak_python_heap_bytes=2,
            peak_rss_bytes=None,
            pages=1,
            blocks=1,
            tables=0,
            figures=0,
            formulas=0,
            plain_text_chars=4,
            expected_features=("headings",),
            warnings=(),
            error=None,
        )

    def raise_missing() -> object:
        raise ParserUnavailableError("docling is not installed")

    monkeypatch.setattr(parser_benchmark, "run_current_fixture", fake_current)
    monkeypatch.setattr("worker.lib.parser_gateway._load_docling_converter", raise_missing)

    await async_main([
        "--manifest",
        str(manifest),
        "--parser",
        "current",
        "--out",
        str(current_out),
    ])
    await async_main([
        "--manifest",
        str(manifest),
        "--parser",
        "docling",
        "--out",
        str(docling_out),
    ])

    current_row = json.loads(current_out.read_text(encoding="utf-8").strip())
    docling_row = json.loads(docling_out.read_text(encoding="utf-8").strip())
    assert set(docling_row) == set(current_row)
    assert {
        "wall_clock_ms",
        "peak_python_heap_bytes",
        "peak_rss_bytes",
        "pages",
        "blocks",
        "tables",
        "figures",
        "formulas",
        "warnings",
        "plain_text_chars",
        "expected_features",
        "quality_scores",
        "quality_notes",
        "status",
        "error",
    } <= set(docling_row)


def test_quality_scores_capture_expected_feature_gaps() -> None:
    now = datetime.now(UTC)
    doc = CanonicalDocument(
        source=CanonicalDocumentSource(
            source_type="file",
            mime_type="application/pdf",
            parser="current.fake",
            parse_started_at=now,
            parse_completed_at=now,
        ),
        blocks=[
            CanonicalBlock(
                id="b1",
                type=CanonicalBlockType.PARAGRAPH,
                content="영어 없는 한국어 본문",
                reading_order=0,
                source_offsets=CanonicalSourceOffsets(start=0, end=11),
            )
        ],
    )
    fixture = parser_benchmark.BenchmarkFixture(
        id="fixture",
        description="fixture",
        source_type="file",
        mime_type="application/pdf",
        expected_features=("tables", "headings", "korean_text"),
    )

    result = parser_benchmark._result_from_doc(
        fixture,
        doc,
        wall_clock_ms=1,
        peak_python_heap_bytes=1,
    )

    assert result.quality_scores["table_structure"] == 0.0
    assert result.quality_scores["heading_structure"] == 0.0
    assert result.quality_scores["korean_text"] > 0
    assert "expected_tables_missing" in result.quality_notes
    assert "expected_headings_missing" in result.quality_notes


def test_downstream_chunk_quality_counts_all_headings_in_chunk() -> None:
    now = datetime.now(UTC)
    doc = CanonicalDocument(
        source=CanonicalDocumentSource(
            source_type="file",
            mime_type="text/markdown",
            parser="current.fake",
            parse_started_at=now,
            parse_completed_at=now,
        ),
        blocks=[
            CanonicalBlock(
                id="h1",
                type=CanonicalBlockType.HEADING,
                content="First heading",
                reading_order=0,
                source_offsets=CanonicalSourceOffsets(start=0, end=13),
            ),
            CanonicalBlock(
                id="p1",
                type=CanonicalBlockType.PARAGRAPH,
                content="Short body",
                reading_order=1,
                source_offsets=CanonicalSourceOffsets(start=15, end=25),
            ),
            CanonicalBlock(
                id="h2",
                type=CanonicalBlockType.HEADING,
                content="Second heading",
                reading_order=2,
                source_offsets=CanonicalSourceOffsets(start=27, end=41),
            ),
        ],
    )

    assert parser_benchmark._downstream_chunk_quality_score(doc) == 1.0


@pytest.mark.asyncio
async def test_parser_benchmark_current_uses_local_patch_for_pdf(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture_path = tmp_path / "sample.pdf"
    fixture_path.write_bytes(b"%PDF-1.4")
    fixture = parser_benchmark.BenchmarkFixture(
        id="pdf",
        description="PDF",
        source_type="file",
        mime_type="application/pdf",
        local_path=fixture_path,
    )
    temp_paths: list[Path] = []

    async def fake_parse_pdf(inp: dict) -> dict:
        from worker.activities import pdf_activity

        path = pdf_activity.download_to_tempfile(inp["object_key"])
        temp_paths.append(path)
        assert path.read_bytes() == b"%PDF-1.4"
        return {"text": "pdf body", "pages": [{"text": "pdf body"}]}

    monkeypatch.setattr(
        parser_benchmark,
        "_current_adapter_for",
        lambda _fixture: parser_benchmark.CurrentParserAdapter(
            "current.parse_pdf",
            fake_parse_pdf,
        ),
    )

    result = await run_current_fixture(fixture)

    assert result.status == "success"
    assert result.parser == "current.parse_pdf"
    assert result.plain_text_chars == len("pdf body")
    assert temp_paths
    assert not temp_paths[0].exists()
