"""Tests for the HWP/HWPX parsing activity.

unoconvert + opendataloader-pdf JAR + MinIO are all patched; the tests
verify the activity wiring (dispatch, event emission, viewer-PDF upload,
error contracts) without touching LibreOffice or Java.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from worker.activities.hwp_activity import parse_hwp


def _hwp_input(*, mime: str = "application/x-hwp", workflow_id: str = "wf-hwp-1") -> dict:
    return {
        "object_key": f"uploads/u/x.{'hwp' if 'hwpx' not in mime else 'hwpx'}",
        "user_id": "u",
        "project_id": "p",
        "note_id": None,
        "file_name": "x.hwp",
        "mime_type": mime,
        "url": None,
        "workflow_id": workflow_id,
    }


@pytest.mark.asyncio
async def test_parse_hwp_converts_then_extracts(tmp_path: Path):
    """Happy path: HWP → PDF via unoconvert, PDF → text via opendataloader-pdf,
    viewer PDF uploaded to MinIO."""
    fake_src = tmp_path / "in.hwp"
    fake_src.write_bytes(b"HWP Document File V5.00")

    fake_pdf_bytes = b"%PDF-1.4 from hwp"

    def fake_unoconvert(_src, dst):
        Path(dst).write_bytes(fake_pdf_bytes)

    def fake_jar(_pdf, out_dir):
        out_dir = Path(out_dir)
        (out_dir / "hwp.json").write_text(json.dumps({
            "pages": [
                {"text": "안녕하세요. 첫 페이지입니다."},
                {"text": "두 번째 페이지."},
            ]
        }))
        return out_dir

    upload_calls: list[tuple[str, bytes, str]] = []

    def fake_upload(key, data, ctype):
        upload_calls.append((key, data, ctype))

    publish_calls: list[tuple[str, dict]] = []

    async def fake_publish(_wfid, kind, payload):
        publish_calls.append((kind, payload))

    with (
        patch(
            "worker.activities.hwp_activity.download_to_tempfile",
            return_value=fake_src,
        ),
        patch(
            "worker.activities.hwp_activity.convert_to_pdf_unoconvert",
            side_effect=fake_unoconvert,
        ),
        patch(
            "worker.activities.hwp_activity._run_opendataloader",
            side_effect=fake_jar,
        ),
        patch(
            "worker.activities.hwp_activity.upload_object",
            side_effect=fake_upload,
        ),
        patch(
            "worker.activities.hwp_activity.publish_safe",
            side_effect=fake_publish,
        ),
    ):
        result = await parse_hwp(_hwp_input())

    # Korean text round-trips intact through json + concat.
    assert "안녕하세요" in result["text"]
    assert "두 번째 페이지" in result["text"]
    assert result["has_complex_layout"] is False
    assert result["viewer_pdf_object_key"] == "uploads/u/viewer-pdf/wf-hwp-1.pdf"

    assert len(upload_calls) == 1
    key, data, ctype = upload_calls[0]
    assert key == "uploads/u/viewer-pdf/wf-hwp-1.pdf"
    assert ctype == "application/pdf"
    assert data == fake_pdf_bytes

    kinds = [c[0] for c in publish_calls]
    assert "stage_changed" in kinds
    assert "unit_parsed" in kinds


@pytest.mark.asyncio
async def test_parse_hwpx_uses_same_pipeline(tmp_path: Path):
    """HWPX (zip-based) takes the exact same code path; just a different MIME."""
    fake_src = tmp_path / "in.hwpx"
    fake_src.write_bytes(b"PK\x03\x04...")

    def fake_unoconvert(_src, dst):
        Path(dst).write_bytes(b"%PDF-1.4")

    def fake_jar(_pdf, out_dir):
        out_dir = Path(out_dir)
        (out_dir / "hwpx.json").write_text(json.dumps({"pages": [{"text": "ok"}]}))
        return out_dir

    async def fake_publish(*_args, **_kw):
        pass

    with (
        patch(
            "worker.activities.hwp_activity.download_to_tempfile",
            return_value=fake_src,
        ),
        patch(
            "worker.activities.hwp_activity.convert_to_pdf_unoconvert",
            side_effect=fake_unoconvert,
        ),
        patch(
            "worker.activities.hwp_activity._run_opendataloader",
            side_effect=fake_jar,
        ),
        patch("worker.activities.hwp_activity.upload_object"),
        patch(
            "worker.activities.hwp_activity.publish_safe",
            side_effect=fake_publish,
        ),
    ):
        result = await parse_hwp(_hwp_input(
            mime="application/vnd.hancom.hwpx",
            workflow_id="wf-hwpx-1",
        ))

    assert result["text"] == "ok"
    assert result["viewer_pdf_object_key"] == "uploads/u/viewer-pdf/wf-hwpx-1.pdf"


@pytest.mark.asyncio
async def test_parse_hwp_unoconvert_failure_propagates(tmp_path: Path):
    """If H2Orestart isn't installed unoconvert exits non-zero — that should
    surface as a RuntimeError so Temporal retries / the user gets a real
    failure (NOT silent empty text — the original audit antipattern)."""
    fake_src = tmp_path / "in.hwp"
    fake_src.write_bytes(b"")

    async def fake_publish(*_args, **_kw):
        pass

    def boom(*_args, **_kw):
        raise RuntimeError("unoconvert failed: no filter for HWP")

    with (
        patch(
            "worker.activities.hwp_activity.download_to_tempfile",
            return_value=fake_src,
        ),
        patch(
            "worker.activities.hwp_activity.convert_to_pdf_unoconvert",
            side_effect=boom,
        ),
        patch(
            "worker.activities.hwp_activity.publish_safe",
            side_effect=fake_publish,
        ),
        pytest.raises(RuntimeError, match="no filter for HWP"),
    ):
        await parse_hwp(_hwp_input())


@pytest.mark.asyncio
async def test_parse_hwp_rejects_unsupported_mime(tmp_path: Path):
    fake_src = tmp_path / "x.bin"
    fake_src.write_bytes(b"")
    with (
        patch(
            "worker.activities.hwp_activity.download_to_tempfile",
            return_value=fake_src,
        ),
        pytest.raises(ValueError, match="unsupported mime_type"),
    ):
        await parse_hwp(_hwp_input(mime="application/pdf"))
