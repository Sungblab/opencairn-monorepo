"""Shared helpers for the Office and HWP parsing activities.

Both ``office_activity`` and ``hwp_activity`` need to talk to the
``unoserver`` daemon and agree on a viewer-PDF storage layout. Keeping
those concerns in one module avoids the ``hwp_activity`` → private
``office_activity`` import that would otherwise couple the two siblings.

This module owns:

* ``UNOSERVER_HOST`` / ``UNOSERVER_PORT`` — env-driven daemon address.
* ``ensure_extension`` — rename a downloaded tempfile so unoconvert's
  filter sniffer (which keys off the path suffix) sees the right
  extension even if the original upload had a missing or wrong one
  (closes the H1 review finding).
* ``convert_to_pdf_unoconvert`` — invoke the ``unoconvert`` CLI.
* ``viewer_pdf_object_key`` — canonical MinIO/R2 key for the converted
  viewer PDF.
"""
from __future__ import annotations

import os
import subprocess
from typing import TYPE_CHECKING

from temporalio import activity

if TYPE_CHECKING:
    from pathlib import Path

UNOSERVER_HOST: str = os.environ.get("UNOSERVER_HOST", "127.0.0.1")
UNOSERVER_PORT: str = os.environ.get("UNOSERVER_PORT", "2003")


def ensure_extension(src_path: Path, ext: str) -> Path:
    """Return ``src_path`` renamed to end with ``.{ext}`` if it does not already.

    ``unoconvert`` sniffs by suffix when the explicit ``--input-filter`` is
    omitted (and H2Orestart's HWP/HWPX filters in particular activate on
    ``.hwp`` / ``.hwpx``). The MIME we receive from the API allowlist is
    authoritative — but the original upload's file name might have no
    extension or the wrong one (e.g. ``report`` or ``report.bin``). Rename
    the temp file to a MIME-derived suffix so the converter never gets
    confused.

    The original path is removed only when the rename succeeds, so a failed
    rename leaves the source intact for the activity's ``finally`` cleanup.
    """
    if src_path.suffix.lower() == f".{ext}".lower():
        return src_path
    target = src_path.with_suffix(f".{ext}")
    src_path.rename(target)
    return target


def convert_to_pdf_unoconvert(src_path: Path, out_path: Path) -> None:
    """Run ``unoconvert`` against the running unoserver daemon.

    Test seam — unit tests patch this to skip the LibreOffice round-trip.
    The CLI ships with ``unoserver`` (installed system-wide in the
    Dockerfile) and talks to the daemon over TCP. We use a fixed timeout
    so a wedged LibreOffice can't hang the activity indefinitely.
    """
    activity.heartbeat("running unoconvert")
    # encoding="utf-8" is explicit because unoconvert / LibreOffice can
    # emit non-ASCII filenames or error messages and the system default
    # encoding (cp1252 / cp949 etc) would raise UnicodeDecodeError that
    # masks the real conversion failure.
    result = subprocess.run(
        [
            "unoconvert",
            "--host", UNOSERVER_HOST,
            "--port", UNOSERVER_PORT,
            "--convert-to", "pdf",
            str(src_path),
            str(out_path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"unoconvert failed (exit {result.returncode}): "
            f"{result.stderr.strip() or '<no stderr>'}"
        )


def viewer_pdf_object_key(*, user_id: str, workflow_id: str) -> str:
    """Canonical MinIO/R2 key for the office/hwp-converted viewer PDF.

    Mirrors :func:`worker.lib.ingest_paths.figure_object_key`'s style; both
    ``parse_office`` and ``parse_hwp`` write to this key.
    """
    return f"uploads/{user_id}/viewer-pdf/{workflow_id}.pdf"
