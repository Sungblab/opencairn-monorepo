"""Office (DOCX/PPTX/XLSX/DOC/PPT/XLS) parsing activity.

Plan 3 follow-up — Office/HWP. The IngestWorkflow dispatches here for any of
the six office MIME types listed in ``apps/api/src/routes/ingest.ts``'s
allowlist. We extract text for downstream RAG / wiki indexing AND produce a
viewer-ready PDF that the editor can later stream for "open original" UX.

Two parsing paths, picked by MIME:

* **OOXML (docx/pptx/xlsx) and ``application/vnd.ms-excel``**: text via
  :mod:`markitdown` (Microsoft's native-Python converter; no LibreOffice
  startup cost). Viewer PDF via ``unoconvert``.
* **Legacy binary (.doc / .ppt)**: convert to PDF via ``unoconvert``
  (LibreOffice has the only reliable legacy importer), then extract text
  via :mod:`pymupdf` from the PDF. markitdown has no native legacy-binary
  support and a docx/pptx round-trip adds an extra conversion for no win.

Failure modes & retry contract:

* ``unoserver`` daemon down: ``unoconvert`` exits non-zero. We surface the
  stderr in the raised :class:`RuntimeError` and let Temporal retry per the
  workflow's RetryPolicy.
* markitdown raises on a corrupt OOXML zip: we re-raise so Temporal sees the
  failure (no silent empty-text success — that's the silent-fail antipattern
  the audit report flagged for the original missing-activity bug).
* Viewer PDF upload failure: warning-logged, ``viewer_pdf_object_key`` is
  ``None`` in the result. Text extraction is the contract; the PDF is a UX
  bonus and shouldn't block ingest.
"""
from __future__ import annotations

import asyncio
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from temporalio import activity

from worker.lib.ingest_events import publish_safe
from worker.lib.office_pdf import (
    convert_to_pdf_unoconvert,
    ensure_extension,
    viewer_pdf_object_key,
)
from worker.lib.s3_client import download_to_tempfile, upload_object

# MIME → file-extension hint, used both as the temp-file suffix (so
# unoconvert's content-type sniffer is happy) and as the dispatch key for
# the markitdown-vs-LibreOffice branching below.
_MIME_TO_EXT: dict[str, str] = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/msword": "doc",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.ms-excel": "xls",
}

# markitdown handles these natively (extras: [docx,pptx,xlsx,xls]). The
# legacy binary formats (doc, ppt) are NOT in this set — they take the
# LibreOffice → PDF → pymupdf path instead.
_MARKITDOWN_NATIVE_EXTS: frozenset[str] = frozenset({"docx", "pptx", "xlsx", "xls"})


def _extract_text_markitdown(src_path: Path) -> str:
    """Extract markdown-flavoured plain text via :mod:`markitdown`.

    Test seam — patched in unit tests so we don't have to ship valid
    OOXML zips just to exercise activity wiring.
    """
    # Imported lazily so test environments without markitdown installed can
    # still import the module (the unit test patches this function entirely).
    from markitdown import MarkItDown

    md = MarkItDown()
    result = md.convert(str(src_path))
    # markitdown's API returned ``text_content`` historically and now exposes
    # ``markdown`` as well — both alias the same field. Prefer the new name
    # but tolerate the old to keep us insulated from minor-version drift.
    return getattr(result, "markdown", None) or result.text_content or ""


def _extract_text_pymupdf(pdf_path: Path) -> str:
    """Extract concatenated text from a PDF via :mod:`pymupdf`.

    Used only for legacy binary inputs (.doc / .ppt) where markitdown has
    no native parser. We don't reuse opendataloader-pdf here because we
    don't need figure extraction for the office text — pymupdf is one
    Python call versus a JVM start.
    """
    import pymupdf

    doc = pymupdf.open(str(pdf_path))
    try:
        parts = [(page.get_text() or "").strip() for page in doc]
        return "\n\n".join(p for p in parts if p)
    finally:
        doc.close()


@activity.defn(name="parse_office")
async def parse_office(inp: dict[str, Any]) -> dict[str, Any]:
    """Parse an Office document and emit IngestEvents.

    Returns a dict shaped like the existing ingest activities so the
    workflow can splat it into the source-note creation:

    .. code-block:: python

        {
            "text": str,                       # extracted plain text
            "viewer_pdf_object_key": str | None,  # for the viewer panel
            "has_complex_layout": bool,        # always False — Office docs
                                               # rarely benefit from the
                                               # Gemini multimodal enhance
                                               # step at the workflow level.
        }
    """
    object_key: str = inp["object_key"]
    user_id: str = inp["user_id"]
    workflow_id: str = inp["workflow_id"]
    mime: str = inp["mime_type"]

    ext = _MIME_TO_EXT.get(mime)
    if ext is None:
        # Workflow dispatch shouldn't send us here for a non-office MIME, but
        # a clear error beats a silent empty-text success.
        raise ValueError(f"parse_office invoked with unsupported mime_type: {mime}")

    activity.logger.info(
        "Parsing Office (%s): %s (wf=%s)", ext, object_key, workflow_id
    )

    raw_path = download_to_tempfile(object_key)
    # Force a MIME-derived suffix on the temp file so unoconvert's filter
    # sniffer engages — the original upload may have had no extension or a
    # mismatched one. The MIME on the wire is the API-allowlist truth.
    src_path = ensure_extension(raw_path, ext)
    pdf_tmp = Path(tempfile.mkdtemp()) / f"{workflow_id}.pdf"

    try:
        await publish_safe(
            workflow_id, "stage_changed", {"stage": "parsing", "pct": 0.0}
        )

        # Step 1: text extraction — branch on whether markitdown can handle
        # the format natively.
        t_text_start = time.time()
        if ext in _MARKITDOWN_NATIVE_EXTS:
            text = await asyncio.to_thread(_extract_text_markitdown, src_path)
            text_path_used = "markitdown"
        else:
            # Legacy binary: convert to PDF first, then read text from PDF.
            await asyncio.to_thread(convert_to_pdf_unoconvert, src_path, pdf_tmp)
            text = await asyncio.to_thread(_extract_text_pymupdf, pdf_tmp)
            text_path_used = "unoconvert+pymupdf"

        text_duration_ms = int((time.time() - t_text_start) * 1000)
        await publish_safe(workflow_id, "unit_parsed", {
            "index": 0,
            "unitKind": "document",
            "charCount": len(text),
            "durationMs": text_duration_ms,
        })

        # Step 2: viewer PDF — already produced for the legacy path; convert
        # for the markitdown path. Best-effort: a missing viewer PDF doesn't
        # break ingest, only the future "open original" UX.
        viewer_pdf_key: str | None = None
        try:
            if ext in _MARKITDOWN_NATIVE_EXTS:
                await asyncio.to_thread(convert_to_pdf_unoconvert, src_path, pdf_tmp)
            viewer_pdf_key = viewer_pdf_object_key(
                user_id=user_id, workflow_id=workflow_id
            )
            pdf_bytes = pdf_tmp.read_bytes()
            await asyncio.to_thread(
                upload_object, viewer_pdf_key, pdf_bytes, "application/pdf"
            )
        except Exception as exc:  # noqa: BLE001 — best-effort viewer step
            activity.logger.warning(
                "Office viewer PDF generation failed for %s: %s", object_key, exc
            )
            viewer_pdf_key = None

        activity.logger.info(
            "Office parsed (%s via %s): %d chars, viewer_pdf=%s",
            ext, text_path_used, len(text), viewer_pdf_key is not None,
        )
        return {
            "text": text,
            "viewer_pdf_object_key": viewer_pdf_key,
            "has_complex_layout": False,
        }
    finally:
        src_path.unlink(missing_ok=True)
        # pdf_tmp lives inside its own mkdtemp dir; rmtree is the only
        # cleanup that won't trip on partial-write states.
        shutil.rmtree(pdf_tmp.parent, ignore_errors=True)
