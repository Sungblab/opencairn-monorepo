"""Tests for the PDF activity event-emission refactor.

The activity's I/O surfaces (Java JAR subprocess, MinIO, scan detection) are
patched, so these run without docker / java / pymupdf-readable fixtures.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from temporalio.exceptions import ApplicationError

from worker.activities.pdf_activity import parse_pdf


@pytest.mark.asyncio
async def test_parse_pdf_emits_unit_events_per_page(tmp_path: Path):
    """parse_pdf publishes started + per-page unit events + figure events."""
    fake_pdf = tmp_path / "sample.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n...")

    fake_json = {
        "pages": [
            {"text": "Page one body", "figures": [{"file": "p0-f0.png", "kind": "image"}]},
            {"text": "Page two body", "tables": [{}]},
        ],
    }
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    (out_dir / "sample.json").write_text(json.dumps(fake_json))
    (out_dir / "p0-f0.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    publish_calls: list[tuple[str, dict]] = []

    async def fake_publish(_wfid, kind, payload):
        publish_calls.append((kind, payload))

    with (
        patch("worker.activities.pdf_activity.download_to_tempfile", return_value=fake_pdf),
        patch("worker.activities.pdf_activity._run_jar", return_value=out_dir),
        patch("worker.activities.pdf_activity._detect_scan", return_value=False),
        patch(
            "worker.activities.pdf_activity._upload_figure",
            return_value="uploads/u/figures/wf-1/p0-f0.png",
        ),
        patch("worker.activities.pdf_activity.publish_safe", side_effect=fake_publish),
    ):
        result = await parse_pdf({
            "object_key": "uploads/u/x.pdf",
            "user_id": "u",
            "project_id": "p",
            "note_id": None,
            "file_name": "x.pdf",
            "mime_type": "application/pdf",
            "url": None,
            "workflow_id": "wf-1",
        })

    assert "text" in result
    kinds = [c[0] for c in publish_calls]
    assert "stage_changed" in kinds
    assert kinds.count("unit_started") == 2
    assert kinds.count("unit_parsed") == 2
    assert kinds.count("figure_extracted") == 1

    figure_payload = next(p for k, p in publish_calls if k == "figure_extracted")
    assert figure_payload["objectKey"] == "uploads/u/figures/wf-1/p0-f0.png"
    assert figure_payload["sourceUnit"] == 0


@pytest.mark.asyncio
async def test_parse_pdf_skips_missing_figure_files(tmp_path: Path):
    """When JAR JSON references a figure file that wasn't actually written,
    the activity must skip rather than crash, and not emit figure_extracted."""
    fake_pdf = tmp_path / "sample.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n...")

    fake_json = {
        "pages": [{"text": "p1", "figures": [{"file": "missing.png", "kind": "image"}]}]
    }
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    (out_dir / "sample.json").write_text(json.dumps(fake_json))
    # NOTE: missing.png intentionally not written.

    publish_calls: list[tuple[str, dict]] = []

    async def fake_publish(_wfid, kind, payload):
        publish_calls.append((kind, payload))

    with (
        patch("worker.activities.pdf_activity.download_to_tempfile", return_value=fake_pdf),
        patch("worker.activities.pdf_activity._run_jar", return_value=out_dir),
        patch("worker.activities.pdf_activity._detect_scan", return_value=False),
        patch("worker.activities.pdf_activity.publish_safe", side_effect=fake_publish),
    ):
        await parse_pdf({
            "object_key": "uploads/u/x.pdf",
            "user_id": "u",
            "project_id": "p",
            "note_id": None,
            "file_name": "x.pdf",
            "mime_type": "application/pdf",
            "url": None,
            "workflow_id": "wf-2",
        })

    kinds = [c[0] for c in publish_calls]
    assert "figure_extracted" not in kinds


@pytest.mark.asyncio
async def test_parse_pdf_scan_ocrs_each_page(tmp_path: Path):
    """Scan PDFs (no text layer) get OCR'd page-by-page via provider.ocr.

    Each page emits unit_started + unit_parsed; the JAR is *not* invoked
    because its text output would be empty for image-only pages anyway,
    and skipping it keeps Java off the worker's hot path for scans.
    """
    fake_pdf = tmp_path / "scan.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n...")

    publish_calls: list[tuple[str, dict]] = []

    async def fake_publish(_wfid, kind, payload):
        publish_calls.append((kind, payload))

    fake_provider = MagicMock()
    fake_provider.supports_ocr.return_value = True
    fake_provider.ocr = AsyncMock(side_effect=["page one text", "page two text"])

    with (
        patch("worker.activities.pdf_activity.download_to_tempfile", return_value=fake_pdf),
        patch("worker.activities.pdf_activity._detect_scan", return_value=True),
        patch(
            "worker.activities.pdf_activity._render_pages_to_png",
            return_value=[b"\x89PNG\r\np1", b"\x89PNG\r\np2"],
        ),
        patch("worker.activities.pdf_activity.get_provider", return_value=fake_provider),
        patch("worker.activities.pdf_activity.publish_safe", side_effect=fake_publish),
    ):
        result = await parse_pdf({
            "object_key": "uploads/u/scan.pdf",
            "user_id": "u",
            "project_id": "p",
            "note_id": None,
            "file_name": "scan.pdf",
            "mime_type": "application/pdf",
            "url": None,
            "workflow_id": "wf-scan",
        })

    assert result["is_scan"] is True
    # Concatenated text preserves page order.
    assert "page one text" in result["text"]
    assert "page two text" in result["text"]
    assert result["text"].index("page one text") < result["text"].index("page two text")

    # OCR was called once per page with the rendered PNG bytes.
    assert fake_provider.ocr.await_count == 2
    first_call_args = fake_provider.ocr.await_args_list[0]
    assert first_call_args.args[0] == b"\x89PNG\r\np1"

    kinds = [c[0] for c in publish_calls]
    assert kinds.count("unit_started") == 2
    assert kinds.count("unit_parsed") == 2
    # Per-page metadata uses unitKind="page" so the dock UI labels match
    # the JAR-text path.
    parsed_payloads = [p for k, p in publish_calls if k == "unit_parsed"]
    assert all(p["unitKind"] == "page" for p in parsed_payloads)


@pytest.mark.asyncio
async def test_parse_pdf_scan_without_ocr_provider_raises_non_retryable(
    tmp_path: Path,
):
    """A scan PDF on a provider without OCR support must fail loudly.

    Silent empty-text returns would create a blank note and leave the user
    debugging in the dark; ApplicationError(non_retryable=True) surfaces
    "Scan PDF requires Gemini provider" through the workflow.
    """
    fake_pdf = tmp_path / "scan.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n...")

    fake_provider = MagicMock()
    fake_provider.supports_ocr.return_value = False
    fake_provider.ocr = AsyncMock(
        side_effect=NotImplementedError(
            "Ollama OCR not supported. Use Gemini provider for scan PDF."
        )
    )

    async def fake_publish(_wfid, _kind, _payload):
        return None

    with (
        patch("worker.activities.pdf_activity.download_to_tempfile", return_value=fake_pdf),
        patch("worker.activities.pdf_activity._detect_scan", return_value=True),
        patch(
            "worker.activities.pdf_activity._render_pages_to_png",
            return_value=[b"\x89PNG"],
        ),
        patch("worker.activities.pdf_activity.get_provider", return_value=fake_provider),
        patch("worker.activities.pdf_activity.publish_safe", side_effect=fake_publish),
    ):
        with pytest.raises(ApplicationError) as info:
            await parse_pdf({
                "object_key": "uploads/u/scan.pdf",
                "user_id": "u",
                "project_id": "p",
                "note_id": None,
                "file_name": "scan.pdf",
                "mime_type": "application/pdf",
                "url": None,
                "workflow_id": "wf-scan-fail",
            })

    assert info.value.non_retryable is True
    assert "Gemini" in str(info.value)
