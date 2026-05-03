from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

from scripts.parser_benchmark import async_main, load_fixtures

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
                    "object_key": "benchmarks/pdf.pdf",
                    "expected_features": ["tables"],
                }
            ]
        }),
        encoding="utf-8",
    )

    fixtures = load_fixtures(manifest)

    assert fixtures[0].id == "pdf"
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
