"""HWP / HWPX (Hancom 한글) parsing activity.

Plan 3 follow-up — Office/HWP. The Korean office suite Hancom Office's
default formats need a special LibreOffice extension (H2Orestart) to import
into the LO codepath. The Dockerfile installs the extension shared so every
``unoconvert`` call inherits the filter.

Strategy:
  1. Download the HWP/HWPX file to a tempfile (preserving the extension —
     unoconvert sniffs by suffix when the explicit ``--input-filter`` is
     omitted, and H2Orestart's filter activates on .hwp/.hwpx).
  2. ``unoconvert`` → PDF using the running unoserver daemon.
  3. Run opendataloader-pdf against the PDF for text extraction (per spec
     "opendataloader-pdf 재파싱"). We share the JAR path env with
     :mod:`worker.activities.pdf_activity` so a single JAR mount serves both.
  4. Upload the converted PDF as the viewer PDF.

Why opendataloader-pdf and not pymupdf for HWP-derived PDFs (vs. the legacy
office path that uses pymupdf)? HWP documents frequently contain complex
table layouts and Korean glyphs that benefit from opendataloader-pdf's
layout-aware extraction. The 1-2s extra JVM cost is acceptable on a
non-batch path. If this turns out wrong empirically, swap to pymupdf later
— the activity contract doesn't depend on the inner extractor.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from temporalio import activity

from worker.lib.ingest_events import publish_safe
from worker.lib.office_pdf import (
    UNOSERVER_HOST,
    UNOSERVER_PORT,
    convert_to_pdf_unoconvert,
    ensure_extension,
    viewer_pdf_object_key,
)
from worker.lib.s3_client import download_to_tempfile, upload_object

# Reuse the same JAR location parse_pdf uses — operators only have to mount
# one file regardless of how many activities consume it.
JAR_PATH = os.environ.get("OPENDATALOADER_JAR", "/app/opendataloader-pdf.jar")

_HWP_MIME_TO_EXT: dict[str, str] = {
    "application/x-hwp": "hwp",
    "application/haansofthwp": "hwp",
    "application/vnd.hancom.hwp": "hwp",
    "application/vnd.hancom.hwpx": "hwpx",
}


def _run_opendataloader(pdf_path: Path, out_dir: Path) -> Path:
    """Run opendataloader-pdf JAR against ``pdf_path``.

    Test seam — patched in unit tests to bypass Java entirely. Mirrors
    :func:`worker.activities.pdf_activity._run_jar` rather than importing
    it: we want figure-extraction OFF here (HWP documents are typically
    text-dense, and we don't have a downstream consumer for HWP figures
    yet — Spec B figure enrichment runs only for PDFs).
    """
    activity.heartbeat("running opendataloader-pdf for HWP")
    result = subprocess.run(
        [
            "java", "-jar", JAR_PATH,
            "--input", str(pdf_path),
            "--output", str(out_dir),
            "--format", "json",
            "--extract-images", "false",
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"opendataloader-pdf failed: {result.stderr}")
    return out_dir


def _read_text_from_jar_output(out_dir: Path) -> str:
    """Collect plain text from opendataloader-pdf's JSON sidecar.

    UTF-8 is explicit because the activity is exercised on Windows dev
    machines too: Python's default ``open`` mode picks the locale codec
    on Windows (typically cp949 for Korean Windows installs), which would
    mojibake every Korean glyph the JAR extracted from an HWP page.
    """
    json_files = list(out_dir.glob("*.json"))
    if not json_files:
        raise FileNotFoundError("opendataloader-pdf produced no JSON output")
    with open(json_files[0], encoding="utf-8") as f:
        data = json.load(f)
    parts: list[str] = []
    for page in data.get("pages", []):
        text = (page.get("text") or "").strip()
        if text:
            parts.append(text)
    return "\n\n".join(parts)


@activity.defn(name="parse_hwp")
async def parse_hwp(inp: dict[str, Any]) -> dict[str, Any]:
    """Parse an HWP/HWPX document via H2Orestart-equipped unoserver.

    Returns the same shape as :func:`worker.activities.office_activity.parse_office`
    so the workflow can treat both branches uniformly.
    """
    object_key: str = inp["object_key"]
    user_id: str = inp["user_id"]
    workflow_id: str = inp["workflow_id"]
    mime: str = inp["mime_type"]

    ext = _HWP_MIME_TO_EXT.get(mime)
    if ext is None:
        raise ValueError(f"parse_hwp invoked with unsupported mime_type: {mime}")

    activity.logger.info(
        "Parsing HWP (%s): %s (wf=%s) via unoserver=%s:%s",
        ext, object_key, workflow_id, UNOSERVER_HOST, UNOSERVER_PORT,
    )

    raw_path = download_to_tempfile(object_key)
    # H2Orestart's HWP/HWPX import filter activates on the .hwp / .hwpx
    # path suffix. The original upload may have arrived with a missing or
    # mismatched extension; rename to the MIME-derived suffix so the
    # filter sniffer always engages.
    src_path = ensure_extension(raw_path, ext)
    work_dir = Path(tempfile.mkdtemp())
    pdf_path = work_dir / f"{workflow_id}.pdf"
    jar_out_dir = work_dir / "jar-out"
    jar_out_dir.mkdir()

    try:
        await publish_safe(
            workflow_id, "stage_changed", {"stage": "parsing", "pct": 0.0}
        )

        # Step 1: HWP → PDF via unoserver+H2Orestart. This is the call that
        # depends on the H2Orestart extension being present in the LO shared
        # profile — it'll fail with "no filter found" if the unopkg step in
        # the Dockerfile fell through (network / version mismatch).
        t_start = time.time()
        await asyncio.to_thread(convert_to_pdf_unoconvert, src_path, pdf_path)

        # Step 2: PDF → text via opendataloader-pdf. We don't enable
        # figure extraction here (HWP figures aren't currently enriched
        # by Spec B), so the JAR run stays fast.
        await asyncio.to_thread(_run_opendataloader, pdf_path, jar_out_dir)
        text = _read_text_from_jar_output(jar_out_dir)

        duration_ms = int((time.time() - t_start) * 1000)
        await publish_safe(workflow_id, "unit_parsed", {
            "index": 0,
            "unitKind": "document",
            "charCount": len(text),
            "durationMs": duration_ms,
        })

        # Step 3: upload the converted PDF as the viewer artifact. Best-
        # effort, same contract as parse_office.
        viewer_pdf_key: str | None = None
        try:
            viewer_pdf_key = viewer_pdf_object_key(
                user_id=user_id, workflow_id=workflow_id
            )
            pdf_bytes = pdf_path.read_bytes()
            await asyncio.to_thread(
                upload_object, viewer_pdf_key, pdf_bytes, "application/pdf"
            )
        except Exception as exc:  # noqa: BLE001 — best-effort viewer step
            activity.logger.warning(
                "HWP viewer PDF upload failed for %s: %s", object_key, exc
            )
            viewer_pdf_key = None

        activity.logger.info(
            "HWP parsed (%s): %d chars, viewer_pdf=%s",
            ext, len(text), viewer_pdf_key is not None,
        )
        return {
            "text": text,
            "viewer_pdf_object_key": viewer_pdf_key,
            "has_complex_layout": False,
        }
    finally:
        src_path.unlink(missing_ok=True)
        shutil.rmtree(work_dir, ignore_errors=True)
