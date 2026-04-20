"""PDF parsing activity — opendataloader-pdf + PyMuPDF scan detection.

Plan 3 Task 3. The workflow (:mod:`worker.workflows.ingest_workflow`) calls this
activity by name (``parse_pdf``) with the :class:`IngestInput` dataclass, which
Temporal serialises into a ``dict`` on the activity side.

Flow:
    1. Download the uploaded object from MinIO/R2 to a temp file.
    2. Use :mod:`pymupdf` to check whether the PDF is a scan (no extractable
       text but images present on majority of pages).
    3. Run opendataloader-pdf (Java JAR) via :mod:`subprocess` to produce JSON.
    4. Concatenate per-page text, flag complex layout when enough pages contain
       tables or figures (so the workflow can route through the enhance step).

OCR for scans is **out of scope** for this task — we still return whatever text
opendataloader extracted (usually empty) plus the ``is_scan`` flag for the
downstream enhance step / caller to handle.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path

import pymupdf  # PyMuPDF — thin binding for scan detection only.
from temporalio import activity

from worker.lib.s3_client import download_to_tempfile

JAR_PATH = os.environ.get("OPENDATALOADER_JAR", "/app/opendataloader-pdf.jar")
COMPLEX_PAGE_THRESHOLD = int(os.environ.get("COMPLEX_PAGE_THRESHOLD", "3"))


def _detect_scan(pdf_path: Path) -> bool:
    """Return ``True`` if the majority of pages look like scanned images.

    A page is considered "scanned" when it has zero extractable text but at
    least one embedded image. Majority = ``floor(total/2) + 1``.
    """
    doc = pymupdf.open(str(pdf_path))
    try:
        scan_pages = 0
        total = doc.page_count
        if total == 0:
            return False
        for page in doc:
            text = page.get_text().strip()
            images = page.get_images(full=False)
            if not text and images:
                scan_pages += 1
        return scan_pages >= (total // 2 + 1)
    finally:
        doc.close()


@activity.defn(name="parse_pdf")
async def parse_pdf(inp: dict) -> dict:
    """Parse a PDF uploaded to MinIO/R2 into plain text + layout metadata.

    Returns a dict with keys:
      - ``text`` (str): concatenated text of all pages.
      - ``has_complex_layout`` (bool): true when enough pages have tables /
        figures that a multimodal enhance pass is worthwhile.
      - ``is_scan`` (bool): majority-of-pages heuristic from
        :func:`_detect_scan`; downstream OCR TBD.
    """
    object_key: str = inp["object_key"]
    activity.logger.info("Parsing PDF: %s", object_key)

    pdf_path = download_to_tempfile(object_key)
    out_dir = Path(tempfile.mkdtemp())

    try:
        is_scan = _detect_scan(pdf_path)
        if is_scan:
            # TODO Plan 3: route scans through provider.generate() with PDF
            # bytes for OCR via multimodal LLM. For now, we still run
            # opendataloader and return whatever text it extracted (usually
            # empty), plus the ``is_scan`` flag so the caller can decide.
            activity.logger.warning("PDF appears to be a scan: %s", object_key)

        activity.heartbeat("running opendataloader-pdf")
        result = await asyncio.to_thread(
            subprocess.run,
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

        # opendataloader writes <out_dir>/<input_stem>.json (among possibly
        # other artefacts); pick the first .json file we find.
        json_files = list(out_dir.glob("*.json"))
        if not json_files:
            raise FileNotFoundError("opendataloader-pdf produced no JSON output")
        with open(json_files[0]) as f:
            data = json.load(f)

        pages = data.get("pages", [])
        text_parts: list[str] = []
        complex_page_count = 0

        for page in pages:
            page_text = (page.get("text") or "").strip()
            if page_text:
                text_parts.append(page_text)
            if page.get("tables") or page.get("figures"):
                complex_page_count += 1

        full_text = "\n\n".join(text_parts)
        has_complex_layout = complex_page_count >= COMPLEX_PAGE_THRESHOLD

        activity.logger.info(
            "PDF parsed: %d pages, %d chars, complex=%s, scan=%s",
            len(pages), len(full_text), has_complex_layout, is_scan,
        )
        return {
            "text": full_text,
            "has_complex_layout": has_complex_layout,
            "is_scan": is_scan,
        }

    finally:
        pdf_path.unlink(missing_ok=True)
        for f in out_dir.iterdir():
            f.unlink(missing_ok=True)
        out_dir.rmdir()
