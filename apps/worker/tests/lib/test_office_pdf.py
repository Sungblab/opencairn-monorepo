"""Tests for the office_pdf shared helpers.

``ensure_extension`` is the H1-review fix: regardless of how the upload's
filename was sniffed, we want unoconvert to see a path with the
MIME-derived suffix so its filter sniffer engages (matters most for
HWP/HWPX where H2Orestart's filter activates on .hwp/.hwpx).
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from worker.lib.office_pdf import ensure_extension, viewer_pdf_object_key

if TYPE_CHECKING:
    from pathlib import Path


def test_ensure_extension_renames_when_suffix_missing(tmp_path: Path):
    src = tmp_path / "report"
    src.write_bytes(b"data")
    out = ensure_extension(src, "hwp")
    assert out.name == "report.hwp"
    assert out.exists()
    assert not src.exists()


def test_ensure_extension_renames_when_suffix_wrong(tmp_path: Path):
    src = tmp_path / "report.bin"
    src.write_bytes(b"data")
    out = ensure_extension(src, "docx")
    assert out.name == "report.docx"
    assert out.exists()
    assert not src.exists()


def test_ensure_extension_idempotent_when_already_correct(tmp_path: Path):
    src = tmp_path / "doc.docx"
    src.write_bytes(b"data")
    out = ensure_extension(src, "docx")
    assert out == src
    assert out.exists()


def test_ensure_extension_case_insensitive(tmp_path: Path):
    """A user uploading ``.HWP`` (uppercase) should not trigger a rename — the
    LO filter sniffer is itself case-insensitive."""
    src = tmp_path / "report.HWP"
    src.write_bytes(b"data")
    out = ensure_extension(src, "hwp")
    assert out == src
    assert out.exists()


@pytest.mark.parametrize("user,wfid,expected", [
    ("u", "wf-1", "uploads/u/viewer-pdf/wf-1.pdf"),
    (
        "user-with-dashes",
        "ingest-abc-123",
        "uploads/user-with-dashes/viewer-pdf/ingest-abc-123.pdf",
    ),
])
def test_viewer_pdf_object_key_format(user: str, wfid: str, expected: str):
    assert viewer_pdf_object_key(user_id=user, workflow_id=wfid) == expected
