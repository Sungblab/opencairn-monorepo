"""Tests for the Office (DOCX/PPTX/XLSX/DOC/PPT/XLS) parsing activity.

The activity's I/O surfaces (markitdown, ``unoconvert`` subprocess, MinIO
download/upload, pymupdf) are patched so tests run without LibreOffice or
real fixture documents.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from worker.activities.office_activity import parse_office


@pytest.fixture(autouse=True)
def _mock_activity_heartbeat():
    """``parse_office`` calls ``activity.heartbeat()`` between conversion steps
    (S3-006). The Temporal call raises ``RuntimeError("Not in activity context")``
    outside the worker, so unit tests stub it. Production wiring is verified by
    the workflow-level test in ``tests/workflows/test_ingest_heartbeat.py``."""
    with patch("worker.activities.office_activity.activity.heartbeat"):
        yield


def _base_input(*, mime: str, workflow_id: str = "wf-office-1") -> dict:
    return {
        "object_key": "uploads/u/x.docx",
        "user_id": "u",
        "project_id": "p",
        "note_id": None,
        "file_name": "x.docx",
        "mime_type": mime,
        "url": None,
        "workflow_id": workflow_id,
    }


@pytest.mark.asyncio
async def test_parse_office_docx_uses_markitdown(tmp_path: Path):
    """OOXML docx routes through markitdown for text + unoconvert for viewer PDF."""
    fake_src = tmp_path / "in.docx"
    fake_src.write_bytes(b"PK\x03\x04...")  # zip-ish header

    publish_calls: list[tuple[str, dict]] = []

    async def fake_publish(_wfid, kind, payload):
        publish_calls.append((kind, payload))

    upload_calls: list[tuple[str, bytes, str]] = []

    def fake_upload(key, data, ctype):
        upload_calls.append((key, data, ctype))

    def fake_unoconvert(_src, dst):
        Path(dst).write_bytes(b"%PDF-1.4 fake")

    with (
        patch(
            "worker.activities.office_activity.download_to_tempfile",
            return_value=fake_src,
        ),
        patch(
            "worker.activities.office_activity._extract_text_markitdown",
            return_value="# Heading\n\nBody",
        ),
        patch(
            "worker.activities.office_activity.convert_to_pdf_unoconvert",
            side_effect=fake_unoconvert,
        ),
        patch(
            "worker.activities.office_activity.upload_object",
            side_effect=fake_upload,
        ),
        patch(
            "worker.activities.office_activity.publish_safe",
            side_effect=fake_publish,
        ),
    ):
        result = await parse_office(_base_input(
            mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ))

    assert result["text"] == "# Heading\n\nBody"
    assert result["has_complex_layout"] is False
    assert result["viewer_pdf_object_key"] == "uploads/u/viewer-pdf/wf-office-1.pdf"

    kinds = [c[0] for c in publish_calls]
    assert "stage_changed" in kinds
    assert "unit_parsed" in kinds

    assert len(upload_calls) == 1
    key, data, ctype = upload_calls[0]
    assert key == "uploads/u/viewer-pdf/wf-office-1.pdf"
    assert ctype == "application/pdf"
    assert data == b"%PDF-1.4 fake"


@pytest.mark.asyncio
async def test_parse_office_legacy_doc_uses_pymupdf(tmp_path: Path):
    """Legacy .doc routes through unoconvert → pymupdf (markitdown skipped)."""
    fake_src = tmp_path / "in.doc"
    fake_src.write_bytes(b"\xd0\xcf\x11\xe0...")  # OLE2 header

    md_called = False

    def fake_markitdown(_src):
        nonlocal md_called
        md_called = True
        return "should not be called"

    convert_calls: list[tuple[Path, Path]] = []

    def fake_unoconvert(src, dst):
        convert_calls.append((Path(src), Path(dst)))
        Path(dst).write_bytes(b"%PDF-1.4 from doc")

    async def fake_publish(*_args, **_kw):
        pass

    with (
        patch(
            "worker.activities.office_activity.download_to_tempfile",
            return_value=fake_src,
        ),
        patch(
            "worker.activities.office_activity._extract_text_markitdown",
            side_effect=fake_markitdown,
        ),
        patch(
            "worker.activities.office_activity.convert_to_pdf_unoconvert",
            side_effect=fake_unoconvert,
        ),
        patch(
            "worker.activities.office_activity._extract_text_pymupdf",
            return_value="legacy body",
        ),
        patch("worker.activities.office_activity.upload_object"),
        patch(
            "worker.activities.office_activity.publish_safe",
            side_effect=fake_publish,
        ),
    ):
        result = await parse_office(_base_input(mime="application/msword"))

    assert result["text"] == "legacy body"
    assert md_called is False
    # Only one unoconvert call: the text-extraction PDF doubles as viewer PDF.
    assert len(convert_calls) == 1


@pytest.mark.asyncio
async def test_parse_office_viewer_pdf_failure_is_best_effort(tmp_path: Path):
    """A failed viewer-PDF upload returns ``viewer_pdf_object_key=None`` but
    still succeeds the activity (text extraction is the contract)."""
    fake_src = tmp_path / "in.xlsx"
    fake_src.write_bytes(b"PK\x03\x04...")

    async def fake_publish(*_args, **_kw):
        pass

    def boom(*_args, **_kw):
        raise RuntimeError("unoserver wedged")

    with (
        patch(
            "worker.activities.office_activity.download_to_tempfile",
            return_value=fake_src,
        ),
        patch(
            "worker.activities.office_activity._extract_text_markitdown",
            return_value="rows",
        ),
        patch(
            "worker.activities.office_activity.convert_to_pdf_unoconvert",
            side_effect=boom,
        ),
        patch("worker.activities.office_activity.upload_object"),
        patch(
            "worker.activities.office_activity.publish_safe",
            side_effect=fake_publish,
        ),
    ):
        result = await parse_office(_base_input(
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            workflow_id="wf-office-2",
        ))

    assert result["text"] == "rows"
    assert result["viewer_pdf_object_key"] is None


@pytest.mark.asyncio
async def test_parse_office_rejects_unsupported_mime(tmp_path: Path):
    """A non-office MIME reaching parse_office is a programmer error — fail
    loudly rather than emit empty text (the silent-fail antipattern)."""
    fake_src = tmp_path / "in.bin"
    fake_src.write_bytes(b"")

    with (
        patch(
            "worker.activities.office_activity.download_to_tempfile",
            return_value=fake_src,
        ),
        pytest.raises(ValueError, match="unsupported mime_type"),
    ):
        await parse_office(_base_input(mime="application/octet-stream"))
