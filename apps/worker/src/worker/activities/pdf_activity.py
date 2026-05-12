"""PDF parsing activity — opendataloader-pdf + per-page event emission.

Plan 3 Task 3 + Plan: live-ingest-visualization Task 4 + Plan 3 Scan PDF OCR.

Flow:
    1. Download the uploaded object from MinIO/R2 to a temp file.
    2. Use :mod:`pymupdf` to check whether the PDF is a scan (no extractable
       text but images present on majority of pages).
    3a. Text PDFs: run opendataloader-pdf (packaged CLI) via :mod:`subprocess`
        with image extraction enabled, producing JSON + per-figure PNGs.
        Local/dev workers without the CLI or legacy JAR fall back to PyMuPDF
        text extraction so PDF ingest still creates markdown artifacts instead
        of failing before the UI can show the pipeline.
    3b. Scan PDFs: render each page to PNG via :mod:`pymupdf`, try local
        Tesseract OCR first, then call ``provider.ocr()`` only for pages where
        local OCR is unavailable or returns empty text. Providers without OCR
        support raise ``ApplicationError(non_retryable=True)`` only after the
        local path cannot produce usable text.
    4. Walk pages emitting per-page IngestEvents (unit_started/unit_parsed/
       figure_extracted) via :func:`publish_safe` so Redis downtime never
       breaks parsing itself.
    5. Concatenate text and flag complex layout for the downstream enhance
       step, same as before.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path
from typing import Any

import pymupdf
from llm.factory import get_provider
from temporalio import activity
from temporalio.exceptions import ApplicationError

from worker.lib.ingest_events import publish_safe
from worker.lib.opendataloader_pdf import (
    LEGACY_JAR_PATH,
    normalize_opendataloader_pages,
    opendataloader_available,
    read_opendataloader_json,
    run_opendataloader_pdf,
)
from worker.lib.s3_client import download_to_tempfile, upload_object

JAR_PATH = LEGACY_JAR_PATH
COMPLEX_PAGE_THRESHOLD = int(os.environ.get("COMPLEX_PAGE_THRESHOLD", "3"))
LOCAL_OCR_ENABLED = os.environ.get("OPENCAIRN_LOCAL_OCR_ENABLED", "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
LOCAL_OCR_LANGS = os.environ.get("OPENCAIRN_LOCAL_OCR_LANGS", "eng+kor")
LOCAL_OCR_TIMEOUT_SECONDS = int(os.environ.get("OPENCAIRN_LOCAL_OCR_TIMEOUT_SECONDS", "90"))
LOCAL_OCR_TESSERACT_CMD = os.environ.get("OPENCAIRN_TESSERACT_CMD", "tesseract")
LOCAL_OCR_TESSERACT_PSM = os.environ.get("OPENCAIRN_TESSERACT_PSM", "6")


def _detect_scan(pdf_path: Path) -> bool:
    """Return ``True`` if the majority of pages look like scanned images."""
    doc = pymupdf.open(str(pdf_path))
    try:
        scan_pages = 0
        total = doc.page_count
        if total == 0:
            return False
        for page in doc:
            raw_text = page.get_text("text")
            text = raw_text.strip() if isinstance(raw_text, str) else ""
            images = page.get_images(full=False)
            if not text and images:
                scan_pages += 1
        return scan_pages >= (total // 2 + 1)
    finally:
        doc.close()


def _table_to_markdown(table: Any) -> str:
    if not isinstance(table, dict):
        return str(table)
    for key in ("markdown", "text", "content", "html"):
        value = table.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    rows = table.get("rows") or table.get("cells")
    if isinstance(rows, list) and rows:
        normalized = [
            [str(cell) for cell in row]
            for row in rows
            if isinstance(row, list) and row
        ]
        if normalized:
            width = max(len(row) for row in normalized)
            padded = [row + [""] * (width - len(row)) for row in normalized]
            header = padded[0]
            body = padded[1:]
            lines = [
                "| " + " | ".join(header) + " |",
                "| " + " | ".join(["---"] * width) + " |",
            ]
            lines.extend("| " + " | ".join(row) + " |" for row in body)
            return "\n".join(lines)
    return "```json\n" + repr(table) + "\n```"


def _render_pages_to_png(pdf_path: Path, dpi: int = 200) -> list[bytes]:
    """Render every PDF page to PNG bytes.

    Legacy test seam — the scan path renders one page at a time so large PDFs
    do not keep all page bitmaps in memory.
    200 DPI is the rule-of-thumb sweet spot for OCR quality vs. token cost
    on Gemini Vision; smaller pages would lose fine print, larger ones
    inflate request size without measurable accuracy gains.
    """
    doc = pymupdf.open(str(pdf_path))
    try:
        return [page.get_pixmap(dpi=dpi).tobytes("png") for page in doc]
    finally:
        doc.close()


class _PdfPageRenderer:
    """Keep one PyMuPDF document open while rendering scan pages."""

    def __init__(self, pdf_path: Path, dpi: int = 200) -> None:
        self._pdf_path = pdf_path
        self._dpi = dpi
        self._doc: Any | None = None

    def open(self) -> int:
        self._doc = pymupdf.open(str(self._pdf_path))
        return self.page_count

    @property
    def page_count(self) -> int:
        if self._doc is None:
            raise RuntimeError("PDF renderer has not been opened")
        return self._doc.page_count

    def render_page_to_png(self, page_idx: int) -> bytes:
        if self._doc is None:
            raise RuntimeError("PDF renderer has not been opened")
        page = self._doc.load_page(page_idx)
        return page.get_pixmap(dpi=self._dpi).tobytes("png")

    def close(self) -> None:
        if self._doc is not None:
            self._doc.close()
            self._doc = None


class _AsyncPdfPageRenderer:
    """Run a single PyMuPDF document session on one worker thread.

    PyMuPDF document objects are not a good fit for arbitrary thread-hopping.
    A dedicated one-thread executor lets the async activity avoid blocking the
    event loop while still opening/parsing the PDF only once.
    """

    def __init__(self, pdf_path: Path, dpi: int = 200) -> None:
        self._renderer = _PdfPageRenderer(pdf_path, dpi)
        self._executor = ThreadPoolExecutor(max_workers=1)
        self.page_count = 0

    async def __aenter__(self) -> _AsyncPdfPageRenderer:
        try:
            self.page_count = await self._run(self._renderer.open)
        except Exception:
            self._executor.shutdown(wait=True)
            raise
        return self

    async def __aexit__(
        self,
        exc_type: object,
        exc: object,
        traceback: object,
    ) -> None:
        try:
            await self._run(self._renderer.close)
        finally:
            self._executor.shutdown(wait=True)

    async def render_page_to_png(self, page_idx: int) -> bytes:
        return await self._run(self._renderer.render_page_to_png, page_idx)

    async def _run(self, func: Any, *args: Any) -> Any:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, partial(func, *args))


def _run_opendataloader(pdf_path: Path, out_dir: Path) -> Path:
    """Run opendataloader-pdf and return its output directory.

    Test seam — patched in unit tests to bypass the external parser entirely.
    """
    return run_opendataloader_pdf(pdf_path, out_dir, extract_images=True)


def _local_ocr_available() -> bool:
    """Return whether the local Tesseract OCR engine can be invoked."""
    if not LOCAL_OCR_ENABLED:
        return False
    cmd = Path(LOCAL_OCR_TESSERACT_CMD)
    return cmd.is_file() or shutil.which(LOCAL_OCR_TESSERACT_CMD) is not None


def _ocr_page_with_tesseract(png_bytes: bytes) -> str:
    """Run Tesseract OCR on one rendered PDF page.

    The worker already renders pages to PNG for provider OCR. Reusing those
    bytes keeps the local path dependency-light: no OCRmyPDF subprocess or
    extra PDF roundtrip is required.
    """
    fd, tmp_name = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        tmp_path.write_bytes(png_bytes)
        result = subprocess.run(
            [
                LOCAL_OCR_TESSERACT_CMD,
                str(tmp_path),
                "stdout",
                "-l",
                LOCAL_OCR_LANGS,
                "--psm",
                LOCAL_OCR_TESSERACT_PSM,
            ],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            text=True,
            timeout=LOCAL_OCR_TIMEOUT_SECONDS,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            raise RuntimeError(f"tesseract OCR failed: {stderr[:500]}")
        return (result.stdout or "").strip()
    finally:
        tmp_path.unlink(missing_ok=True)


def _opendataloader_available() -> bool:
    return opendataloader_available()


def _extract_pages_with_pymupdf(pdf_path: Path) -> list[dict[str, Any]]:
    """Fallback text extraction when opendataloader-pdf is unavailable."""
    doc = pymupdf.open(str(pdf_path))
    try:
        return [
            {
                "text": (page.get_text() or "").strip(),
                "figures": [],
                "tables": [],
            }
            for page in doc
        ]
    finally:
        doc.close()


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
    """Map OpenDataLoader figure metadata to our IngestEvent figureKind enum.

    Heuristic only — chart/equation classification is left for the B
    (content-aware enrichment) spec to refine via enrichment events.
    """
    kind = (fig.get("kind") or "").lower()
    if kind == "table":
        return "table"
    return "image"


async def _ocr_scan_pdf(pdf_path: Path, workflow_id: str) -> dict[str, Any]:
    """Render each page, use local OCR first, and fallback to provider OCR."""
    local_ocr_available = _local_ocr_available()
    provider: Any | None = None
    local_ocr_pages = 0
    provider_ocr_pages = 0

    await publish_safe(
        workflow_id, "stage_changed", {"stage": "parsing", "pct": 0.0}
    )

    text_parts: list[str] = []
    pages_meta: list[dict[str, Any]] = []

    async with _AsyncPdfPageRenderer(pdf_path) as renderer:
        total_pages = renderer.page_count

        for page_idx in range(total_pages):
            await publish_safe(workflow_id, "unit_started", {
                "index": page_idx,
                "total": total_pages,
                "label": f"Page {page_idx + 1}/{total_pages}",
            })

            t_start = time.time()
            ocr_engine = "provider"
            page_text = ""
            png_bytes = await renderer.render_page_to_png(page_idx)

            if local_ocr_available:
                try:
                    page_text = await asyncio.to_thread(_ocr_page_with_tesseract, png_bytes)
                except Exception as e:  # noqa: BLE001 - provider OCR is the fallback path.
                    activity.logger.warning(
                        "Local OCR failed for scan PDF page %d/%d: %s",
                        page_idx + 1,
                        total_pages,
                        e,
                    )
                if page_text:
                    ocr_engine = "local"
                    local_ocr_pages += 1

            if not page_text:
                if provider is None:
                    provider = get_provider()
                    if not provider.supports_ocr():
                        raise ApplicationError(
                            "Scan PDF OCR requires either local Tesseract OCR or "
                            "Gemini provider OCR. Install tesseract with language "
                            "packs or set LLM_PROVIDER=gemini and provide "
                            "GEMINI_API_KEY.",
                            non_retryable=True,
                        )

                ocr_engine = "provider"
                provider_ocr_pages += 1
                try:
                    page_text = await provider.ocr(png_bytes, mime_type="image/png")
                except NotImplementedError as e:
                    raise ApplicationError(
                        f"Scan PDF requires Gemini provider: {e}",
                        non_retryable=True,
                    ) from e

            text_parts.append(page_text)
            # Mirror the opendataloader text return shape so downstream Spec B enrichment
            # can iterate ``pages[].text`` uniformly across both branches.
            pages_meta.append({
                "text": page_text,
                "figures": [],
                "tables": [],
                "ocr_engine": ocr_engine,
            })

            duration_ms = int((time.time() - t_start) * 1000)
            await publish_safe(workflow_id, "unit_parsed", {
                "index": page_idx,
                "unitKind": "page",
                "charCount": len(page_text),
                "durationMs": duration_ms,
            })

    full_text = "\n\n".join(text_parts)
    activity.logger.info(
        "Scan PDF OCR done: %d pages, %d chars, local=%d, provider=%d",
        total_pages,
        len(full_text),
        local_ocr_pages,
        provider_ocr_pages,
    )
    return {
        "text": full_text,
        "markdown": full_text,
        "page_artifacts": [
            {
                "label": f"page-{idx + 1:03d}.md",
                "text": page.get("text", ""),
                "page_index": idx,
                "ocr_engine": page.get("ocr_engine", "provider"),
            }
            for idx, page in enumerate(pages_meta)
        ],
        "figure_artifacts": [],
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

        if _opendataloader_available():
            activity.logger.info(
                "Running opendataloader-pdf for PDF: %s (wf=%s)",
                object_key,
                workflow_id,
            )
            activity.heartbeat("running opendataloader-pdf")
            out_dir = await asyncio.to_thread(_run_opendataloader, pdf_path, out_dir)
            data = read_opendataloader_json(out_dir)
            pages = normalize_opendataloader_pages(data)
        else:
            activity.logger.warning(
                "opendataloader-pdf CLI unavailable and legacy jar missing or empty at %s; "
                "falling back to pymupdf text extraction",
                JAR_PATH,
            )
            activity.heartbeat("extracting PDF text via pymupdf fallback")
            pages = await asyncio.to_thread(_extract_pages_with_pymupdf, pdf_path)
        total_pages = len(pages)

        await publish_safe(
            workflow_id, "stage_changed", {"stage": "parsing", "pct": 0.0}
        )

        text_parts: list[str] = []
        figure_artifacts: list[dict[str, Any]] = []
        table_artifacts: list[dict[str, Any]] = []
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
                figure_artifacts.append({
                    "label": f"figure-{page_idx + 1:03d}-{fig_idx + 1:02d}.png",
                    "object_key": obj_key,
                    "page_index": page_idx,
                    "figure_index": fig_idx,
                    "mime_type": "image/png",
                })
                await publish_safe(workflow_id, "figure_extracted", {
                    "sourceUnit": page_idx,
                    "objectKey": obj_key,
                    "figureKind": _classify_figure(fig),
                    "caption": fig.get("caption"),
                    "width": fig.get("width"),
                    "height": fig.get("height"),
                })

            for table_idx, table in enumerate(page.get("tables") or []):
                table_artifacts.append(
                    {
                        "label": f"table-{page_idx + 1:03d}-{table_idx + 1:02d}.md",
                        "text": _table_to_markdown(table),
                        "page_index": page_idx,
                        "table_index": table_idx,
                    }
                )

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
            "markdown": full_text,
            "page_artifacts": [
                {
                    "label": f"page-{idx + 1:03d}.md",
                    "text": (page.get("text") or "").strip(),
                    "page_index": idx,
                    "ocr_engine": page.get("ocr_engine"),
                }
                for idx, page in enumerate(pages)
            ],
            "figure_artifacts": figure_artifacts,
            "table_artifacts": table_artifacts,
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
        # Recursive cleanup — opendataloader-pdf with external image output can
        # write nested figure directories under out_dir, which the older
        # iterdir+rmdir loop would fail on with "Directory not empty". Using
        # rmtree(ignore_errors=True) keeps the activity exit clean even if
        # the output layout changes between releases.
        pdf_path.unlink(missing_ok=True)
        shutil.rmtree(out_dir, ignore_errors=True)
