from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

from scripts import parser_benchmark
from scripts.parser_benchmark import (
    async_main,
    load_fixtures,
    run_current_fixture,
    run_docling_fixture,
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
            plain_text_chars=4,
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
        "warnings",
        "plain_text_chars",
        "status",
        "error",
    } <= set(docling_row)


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
