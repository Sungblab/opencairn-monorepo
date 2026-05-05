"""Source hydration for worker-backed document generation."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from temporalio import activity

from worker.activities.document_generation.generate import (
    heartbeat_safe,
    normalize_generation,
    normalize_params,
)
from worker.activities.document_generation.types import (
    DocumentGenerationSourceBundle,
    DocumentGenerationSourceItem,
    DocumentGenerationWorkflowParams,
)
from worker.lib.api_client import post_internal
from worker.lib.s3_client import download_to_tempfile

SOURCE_TOKEN_BUDGET = 40_000
SOURCE_HYDRATION_CONCURRENCY = 8
SOURCE_EXTRACTION_MAX_BYTES = 25 * 1024 * 1024

_PDF_MIME_TYPES = frozenset({"application/pdf"})
_OFFICE_MIME_TYPES = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    }
)
_PDF_EXTS = frozenset({".pdf"})
_OFFICE_EXTS = frozenset({".docx", ".pptx", ".xlsx", ".xls"})


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


async def _hydrate_note(source: dict[str, Any]) -> DocumentGenerationSourceItem:
    source_id = str(source["noteId"])
    raw = await post_internal(
        "/api/internal/synthesis-export/fetch-source",
        {"source_id": source_id, "kind": "note"},
    )
    body = str(raw.get("body") or "")
    return DocumentGenerationSourceItem(
        id=str(raw.get("id") or source_id),
        title=str(raw.get("title") or source_id),
        body=body,
        kind="note",
        token_count=_approx_tokens(body),
    )


async def _hydrate_internal_source(
    params: DocumentGenerationWorkflowParams,
    source: dict[str, Any],
) -> DocumentGenerationSourceItem:
    raw = await post_internal(
        "/api/internal/document-generation/hydrate-source",
        {
            "workspaceId": params.workspace_id,
            "projectId": params.project_id,
            "userId": params.user_id,
            "source": source,
        },
    )
    body = str(raw.get("body") or "")
    body, quality_signals = await _extract_source_body(raw, body)
    return DocumentGenerationSourceItem(
        id=str(raw.get("id") or _source_id(source)),
        title=str(raw.get("title") or _source_id(source)),
        body=body,
        kind=str(raw.get("kind") or source.get("type") or "source"),
        token_count=int(raw.get("token_count", raw.get("tokenCount", _approx_tokens(body)))),
        included=bool(raw.get("included", True)),
        quality_signals=quality_signals,
    )


async def _extract_source_body(raw: dict[str, Any], fallback: str) -> tuple[str, list[str]]:
    object_key = raw.get("objectKey") or raw.get("object_key")
    if not isinstance(object_key, str) or not object_key:
        return fallback, []

    mime_type = str(raw.get("mimeType") or raw.get("mime_type") or "").split(";")[0].strip()
    bytes_value = raw.get("bytes")
    if isinstance(bytes_value, int) and bytes_value > SOURCE_EXTRACTION_MAX_BYTES:
        return fallback, ["source_oversized", "metadata_fallback"]
    if not _can_extract_source(object_key, mime_type):
        return fallback, ["unsupported_source", "metadata_fallback"]

    try:
        extracted = await asyncio.to_thread(
            _download_and_extract_source_text,
            object_key,
            mime_type,
        )
    except Exception:
        return fallback, ["source_corrupt", "metadata_fallback"]
    text = extracted.strip()
    if text:
        return text, []
    if mime_type in _PDF_MIME_TYPES or Path(object_key).suffix.lower() in _PDF_EXTS:
        return fallback, ["scanned_no_text", "metadata_fallback"]
    return fallback, ["no_extracted_text", "metadata_fallback"]


def _can_extract_source(object_key: str, mime_type: str) -> bool:
    suffix = Path(object_key).suffix.lower()
    return (
        mime_type in _PDF_MIME_TYPES
        or mime_type in _OFFICE_MIME_TYPES
        or suffix in _PDF_EXTS
        or suffix in _OFFICE_EXTS
    )


def _download_and_extract_source_text(object_key: str, mime_type: str) -> str:
    path = download_to_tempfile(object_key)
    try:
        suffix = path.suffix.lower()
        if mime_type in _PDF_MIME_TYPES or suffix in _PDF_EXTS:
            return _extract_pdf_text(path)
        if mime_type in _OFFICE_MIME_TYPES or suffix in _OFFICE_EXTS:
            return _extract_office_text(path)
        return ""
    finally:
        path.unlink(missing_ok=True)


def _extract_pdf_text(path: Path) -> str:
    import pymupdf

    document = pymupdf.open(str(path))
    try:
        parts = [(page.get_text() or "").strip() for page in document]
        return "\n\n".join(part for part in parts if part)
    finally:
        document.close()


def _extract_office_text(path: Path) -> str:
    from markitdown import MarkItDown

    result = MarkItDown().convert(str(path))
    return getattr(result, "markdown", None) or result.text_content or ""


async def _hydrate_source(
    params: DocumentGenerationWorkflowParams,
    source: dict[str, Any],
    semaphore: asyncio.Semaphore,
) -> DocumentGenerationSourceItem:
    async with semaphore:
        source_type = source.get("type")
        heartbeat_safe(f"hydrating document source {source_type}")
        if source_type == "note":
            return await _hydrate_note(source)
        if source_type in {"agent_file", "chat_thread", "research_run", "synthesis_run"}:
            try:
                return await _hydrate_internal_source(params, source)
            except Exception:
                return _reference_only_source(
                    source,
                    ["source_hydration_failed", "metadata_fallback"],
                )
        return _reference_only_source(source)


def _source_id(source: dict[str, Any]) -> str:
    return str(
        source.get("objectId")
        or source.get("threadId")
        or source.get("runId")
        or source.get("noteId")
        or "unknown"
    )


def _reference_only_source(
    source: dict[str, Any],
    quality_signals: list[str] | None = None,
) -> DocumentGenerationSourceItem:
    kind = str(source.get("type") or "source")
    source_id = _source_id(source)
    title = {
        "agent_file": "Project object",
        "chat_thread": "Chat thread",
        "research_run": "Research run",
        "synthesis_run": "Synthesis run",
    }.get(kind, kind)
    return DocumentGenerationSourceItem(
        id=source_id,
        title=title,
        body=f"{kind}: {source_id}",
        kind=kind,
        token_count=_approx_tokens(source_id),
        quality_signals=quality_signals or [],
    )


def _fit_budget(items: list[DocumentGenerationSourceItem]) -> list[DocumentGenerationSourceItem]:
    included: list[DocumentGenerationSourceItem] = []
    used = 0
    for item in sorted(items, key=lambda source: source.token_count):
        if used + item.token_count <= SOURCE_TOKEN_BUDGET:
            included.append(item)
            used += item.token_count
        else:
            included.append(
                DocumentGenerationSourceItem(
                    id=item.id,
                    title=item.title,
                    body="",
                    kind=item.kind,
                    token_count=item.token_count,
                    included=False,
                    quality_signals=[
                        *item.quality_signals,
                        "source_token_budget_exceeded",
                        "metadata_fallback",
                    ],
                )
            )
    return included


@activity.defn(name="hydrate_document_generation_sources")
async def hydrate_document_generation_sources(
    params: DocumentGenerationWorkflowParams | dict[str, Any],
) -> DocumentGenerationSourceBundle:
    normalized = normalize_params(params)
    generation = normalize_generation(normalized.generation)
    semaphore = asyncio.Semaphore(SOURCE_HYDRATION_CONCURRENCY)
    hydrated = await asyncio.gather(
        *(_hydrate_source(normalized, source, semaphore) for source in generation.sources)
    )

    return DocumentGenerationSourceBundle(items=_fit_budget(hydrated))
