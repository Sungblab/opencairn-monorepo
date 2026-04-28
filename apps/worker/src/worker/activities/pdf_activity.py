"""PDF parsing activity — opendataloader-pdf + per-page event emission.

Plan 3 Task 3 + Plan: live-ingest-visualization Task 4 + Plan 3 Scan PDF OCR.

Flow:
    1. Download the uploaded object from MinIO/R2 to a temp file.
    2. Use :mod:`pymupdf` to check whether the PDF is a scan (no extractable
       text but images present on majority of pages).
    3a. Text PDFs: run opendataloader-pdf (Java JAR) via :mod:`subprocess`
        with image extraction enabled, producing JSON + per-figure PNGs.
    3b. Scan PDFs: render each page to PNG via :mod:`pymupdf` and call
        ``provider.ocr()`` per page. Providers without OCR support raise
        ``ApplicationError(non_retryable=True)`` so the user gets a clear
        "Gemini provider required" error instead of a silent empty note.
    4. Walk pages emitting per-page IngestEvents (unit_started/unit_parsed/
       figure_extracted) via :func:`publish_safe` so Redis downtime never
       breaks parsing itself.
    5. Concatenate text and flag complex layout for the downstream enhance
       step, same as before.
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

import pymupdf
from temporalio import activity
from temporalio.exceptions import ApplicationError

from llm.factory import get_provider

from worker.lib.ingest_events import publish_safe
from worker.lib.s3_client import download_to_tempfile, upload_object

JAR_PATH = os.environ.get("OPENDATALOADER_JAR", "/app/opendataloader-pdf.jar")
COMPLEX_PAGE_THRESHOLD = int(os.environ.get("COMPLEX_PAGE_THRESHOLD", "3"))


def _detect_scan(pdf_path: Path) -> bool:
    """Return ``True`` if the majority of pages look like scanned images."""
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


def _render_pages_to_png(pdf_path: Path, dpi: int = 200) -> list[bytes]:
    """Render each page of the PDF to PNG bytes for vision OCR.

    Test seam — patched in unit tests so we don't need a readable fixture.
    200 DPI is the rule-of-thumb sweet spot for OCR quality vs. token cost
    on Gemini Vision; smaller pages would lose fine print, larger ones
    inflate request size without measurable accuracy gains.
    """
    doc = pymupdf.open(str(pdf_path))
    try:
        return [page.get_pixmap(dpi=dpi).tobytes("png") for page in doc]
    finally:
        doc.close()


def _run_jar(pdf_path: Path, out_dir: Path) -> Path:
    """Run opendataloader-pdf JAR and return its output directory.

    Test seam — patched in unit tests to bypass Java entirely.
    """
    activity.heartbeat("running opendataloader-pdf")
    result = subprocess.run(
        [
            "java", "-jar", JAR_PATH,
            "--input", str(pdf_path),
            "--output", str(out_dir),
            "--format", "json",
            "--extract-images", "true",
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"opendataloader-pdf failed: {result.stderr}")
    return out_dir


def _upload_figure(
    local_path: Path,
    user_id: str,
    workflow_id: str,
    page_idx: int,
    fig_idx: int,
) -> str:
    """Upload an extracted figure to MinIO and return its object_key.

    Uses ``worker.lib.ingest_paths.figure_object_key`` so the path stays in
    lockstep with the consumer (Spec B enrichment artifact).
    """
    from worker.lib.ingest_paths import figure_object_key

    object_key = figure_object_key(
        user_id=user_id,
        workflow_id=workflow_id,
        page_idx=page_idx,
        fig_idx=fig_idx,
    )
    upload_object(object_key, local_path.read_bytes(), "image/png")
    return object_key


def _classify_figure(fig: dict[str, Any]) -> str:
    """Map JAR figure metadata to our IngestEvent figureKind enum.

    Heuristic only — chart/equation classification is left for the B
    (content-aware enrichment) spec to refine via enrichment events.
    """
    kind = (fig.get("kind") or "").lower()
    if kind == "table":
        return "table"
    return "image"


async def _ocr_scan_pdf(pdf_path: Path, workflow_id: str) -> dict[str, Any]:
    """Render each page + OCR via the configured LLM provider.

    Skipped when ``provider.supports_ocr()`` is False — we fail fast with
    a non-retryable ``ApplicationError`` so the user gets "Gemini provider
    required" instead of a silent empty note. The same error is raised if
    ``provider.ocr()`` itself signals ``NotImplementedError`` mid-loop
    (defensive: subclasses may forget to keep ``supports_ocr`` in sync).
    """
    provider = get_provider()
    if not provider.supports_ocr():
        raise ApplicationError(
            "Scan PDF requires Gemini provider with OCR support. "
            "Set LLM_PROVIDER=gemini and provide GEMINI_API_KEY.",
            non_retryable=True,
        )

    png_pages: list[bytes] = await asyncio.to_thread(_render_pages_to_png, pdf_path)
    total_pages = len(png_pages)

    await publish_safe(
        workflow_id, "stage_changed", {"stage": "parsing", "pct": 0.0}
    )

    text_parts: list[str] = []
    pages_meta: list[dict[str, Any]] = []

    for page_idx, png_bytes in enumerate(png_pages):
        await publish_safe(workflow_id, "unit_started", {
            "index": page_idx,
            "total": total_pages,
            "label": f"Page {page_idx + 1}/{total_pages}",
        })

        t_start = time.time()
        try:
            page_text = await provider.ocr(png_bytes, mime_type="image/png")
        except NotImplementedError as e:
            raise ApplicationError(
                f"Scan PDF requires Gemini provider: {e}",
                non_retryable=True,
            ) from e

        text_parts.append(page_text)
        # Mirror the JAR-text return shape so downstream Spec B enrichment
        # can iterate ``pages[].text`` uniformly across both branches.
        pages_meta.append({"text": page_text, "figures": [], "tables": []})

        duration_ms = int((time.time() - t_start) * 1000)
        await publish_safe(workflow_id, "unit_parsed", {
            "index": page_idx,
            "unitKind": "page",
            "charCount": len(page_text),
            "durationMs": duration_ms,
        })

    full_text = "\n\n".join(text_parts)
    activity.logger.info(
        "Scan PDF OCR done: %d pages, %d chars", total_pages, len(full_text)
    )
    return {
        "text": full_text,
        "has_complex_layout": False,
        "is_scan": True,
        "pages": pages_meta,
    }


@activity.defn(name="parse_pdf")
async def parse_pdf(inp: dict[str, Any]) -> dict[str, Any]:
    """Parse a PDF + emit per-page IngestEvents.

    ``inp["workflow_id"]`` is required (the workflow now always passes it).
    Events are emitted via :func:`publish_safe`, so Redis downtime never
    breaks parsing itself.
    """
    object_key: str = inp["object_key"]
    user_id: str = inp["user_id"]
    workflow_id: str = inp["workflow_id"]

    activity.logger.info("Parsing PDF: %s (wf=%s)", object_key, workflow_id)

    pdf_path = download_to_tempfile(object_key)
    out_dir = Path(tempfile.mkdtemp())

    try:
        is_scan = _detect_scan(pdf_path)
        if is_scan:
            activity.logger.warning("PDF appears to be a scan: %s", object_key)
            return await _ocr_scan_pdf(pdf_path, workflow_id)

        out_dir = await asyncio.to_thread(_run_jar, pdf_path, out_dir)

        json_files = list(out_dir.glob("*.json"))
        if not json_files:
            raise FileNotFoundError("opendataloader-pdf produced no JSON output")
        with open(json_files[0]) as f:
            data = json.load(f)

        pages = data.get("pages", [])
        total_pages = len(pages)

        await publish_safe(
            workflow_id, "stage_changed", {"stage": "parsing", "pct": 0.0}
        )

        text_parts: list[str] = []
        complex_page_count = 0

        for page_idx, page in enumerate(pages):
            await publish_safe(workflow_id, "unit_started", {
                "index": page_idx,
                "total": total_pages,
                "label": f"Page {page_idx + 1}/{total_pages}",
            })

            t_start = time.time()
            page_text = (page.get("text") or "").strip()
            if page_text:
                text_parts.append(page_text)
            if page.get("tables") or page.get("figures"):
                complex_page_count += 1

            for fig_idx, fig in enumerate(page.get("figures") or []):
                fname = fig.get("file")
                if not fname:
                    continue
                local = out_dir / fname
                if not local.exists():
                    continue
                obj_key = await asyncio.to_thread(
                    _upload_figure, local, user_id, workflow_id, page_idx, fig_idx,
                )
                await publish_safe(workflow_id, "figure_extracted", {
                    "sourceUnit": page_idx,
                    "objectKey": obj_key,
                    "figureKind": _classify_figure(fig),
                    "caption": fig.get("caption"),
                    "width": fig.get("width"),
                    "height": fig.get("height"),
                })

            duration_ms = int((time.time() - t_start) * 1000)
            await publish_safe(workflow_id, "unit_parsed", {
                "index": page_idx,
                "unitKind": "page",
                "charCount": len(page_text),
                "durationMs": duration_ms,
            })

        full_text = "\n\n".join(text_parts)
        has_complex_layout = complex_page_count >= COMPLEX_PAGE_THRESHOLD

        activity.logger.info(
            "PDF parsed: %d pages, %d chars, complex=%s, scan=%s",
            total_pages, len(full_text), has_complex_layout, is_scan,
        )
        return {
            "text": full_text,
            "has_complex_layout": has_complex_layout,
            "is_scan": is_scan,
            # Spec B — enrich_document reads pages[].text for type detection
            # and pages[].figures[] for caption / page metadata. Live-ingest-
            # visualization already uploaded each figure under
            # uploads/{user_id}/figures/{workflow_id}/p{p}-f{f}.png; the
            # enrichment activity does not re-upload.
            "pages": pages,
        }

    finally:
        # Recursive cleanup — opendataloader-pdf with --extract-images=true
        # can write nested figure directories under out_dir, which the older
        # iterdir+rmdir loop would fail on with "Directory not empty". Using
        # rmtree(ignore_errors=True) keeps the activity exit clean even if
        # the JAR layout changes between releases.
        pdf_path.unlink(missing_ok=True)
        shutil.rmtree(out_dir, ignore_errors=True)
