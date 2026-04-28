"""Spec B — produce a structured artifact for an ingested document.

Per content type:
- ``document`` / ``paper``: Gemini multimodal (whole PDF) → text-only fallback.
  Paper variant additionally extracts section labels.
- ``slide``: client-side card construction from opendataloader pages — no LLM.
- ``book``: Gemini chapter tree from representative pages.
- ``code``: Python AST symbol extraction — no LLM.
- ``table``: Gemini markdown tables + pivot suggestions.
- ``image``: Gemini description; Ollama is skipped (no vision).

Translation to Korean is requested via ``requested_enrichments``; Ollama
skips it (no Korean translation provider parity yet).

Failures inside this activity are caught at the workflow boundary so a
broken enrichment never blocks note creation. (See Task 7.)
"""

from __future__ import annotations

import ast
import json
import os
import re

from temporalio import activity

from llm import get_provider
from llm.base import ProviderConfig
from worker.lib.enrichment_artifact import EnrichmentArtifact

# s3_client.download_to_tempfile is imported lazily inside enrich_document so
# this module remains importable in unit tests where the optional `minio`
# dep isn't installed.

# ── LLM prompts ───────────────────────────────────────────────────────────────

_COMMON_PROMPT = """\
You are a document structure extractor. Analyze this document and return ONLY valid JSON.

Return this exact JSON structure (omit keys that don't apply):
{
  "outline": [{"level": 1, "title": "...", "page": N}],
  "figures": [{"page": N, "caption": "..."}],
  "tables":  [{"page": N, "caption": "...", "markdown": "| ... |"}],
  "word_count": N
}
Return only JSON. No explanation.
"""

_PAPER_EXTRA = """\
Also include a "sections" key with these sub-keys if found:
"abstract", "introduction", "methods", "results", "discussion", "conclusion", "references_raw"
Each value is the full text of that section (truncated to 3000 chars).
"""

_BOOK_PROMPT = """\
Extract the chapter tree from this book's table of contents. Return ONLY valid JSON:
{"chapter_tree": [{"title": "...", "page": N, "children": [...]}]}
"""

_TABLE_PROMPT = """\
This document is table-heavy. Return ONLY valid JSON:
{
  "tables": [{"page": N, "caption": "...", "markdown": "| col1 | col2 |\\n|---|---|\\n| ... |"}],
  "pivot_suggestions": [{"rows": ["..."], "values": ["..."], "agg": "sum"}]
}
"""

_IMAGE_PROMPT = (
    "Describe this image in detail as JSON: "
    '{"outline": [{"level": 1, "title": "..."}], "word_count": 0}'
)

_TRANSLATION_HEADER = (
    "다음 영어 텍스트를 자연스러운 한국어로 번역해줘. 번역문만 출력:\n\n"
)


# ── helpers ───────────────────────────────────────────────────────────────────


def _heartbeat(detail: str) -> None:
    if activity.in_activity():
        activity.heartbeat(detail)


def _log_warning(msg: str, *args: object) -> None:
    if activity.in_activity():
        activity.logger.warning(msg, *args)


def _log_info(msg: str, *args: object) -> None:
    if activity.in_activity():
        activity.logger.info(msg, *args)


def _is_ollama() -> bool:
    return os.environ.get("LLM_PROVIDER", "gemini") == "ollama"


def _make_provider():
    return get_provider(
        ProviderConfig(
            provider=os.environ.get("LLM_PROVIDER", "gemini"),
            api_key=os.environ.get("LLM_API_KEY"),
            model=os.environ.get("LLM_MODEL", "gemini-3-flash-preview"),
        )
    )


def _representative_text(pages: list[dict], max_chars: int = 15_000) -> str:
    """Sample first/middle/last pages — used for Ollama text-only fallback."""
    total = len(pages)
    if total == 0:
        return ""
    chunk = max_chars // 3
    indices = list(dict.fromkeys([0, total // 2, total - 1]))  # dedupe, preserve order
    return "\n\n".join((pages[i].get("text") or "")[:chunk] for i in indices)


def _parse_json_response(raw: str) -> dict:
    """Pull a JSON object out of an LLM response. Empty dict on failure."""
    raw = (raw or "").strip()
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
    if match:
        raw = match.group(1)
    try:
        loaded = json.loads(raw)
        return loaded if isinstance(loaded, dict) else {}
    except json.JSONDecodeError:
        return {}


# ── Figure metadata ───────────────────────────────────────────────────────────
#
# parse_pdf (live-ingest-visualization) already uploads every extracted figure
# under  uploads/{user_id}/figures/{workflow_id}/p{page_idx}-f{fig_idx}.png
# during the parse step, so the enrichment activity only records caption /
# page metadata + the deterministic object_key. We do NOT re-upload here —
# duplicating bytes would be wasteful and racy on retries.


def _build_figure_items(
    pages: list[dict],
    *,
    user_id: str,
    workflow_id: str,
) -> list[dict]:
    """Mirror live-ingest-visualization's per-page figure key formula."""
    figures: list[dict] = []
    for page_idx, page in enumerate(pages):
        for fig_idx, fig in enumerate(page.get("figures") or []):
            obj_key: str | None = None
            if user_id and workflow_id and fig.get("file"):
                obj_key = (
                    f"uploads/{user_id}/figures/{workflow_id}"
                    f"/p{page_idx}-f{fig_idx}.png"
                )
            figures.append(
                {
                    "page": page_idx,
                    "caption": fig.get("caption"),
                    "object_key": obj_key,
                }
            )
    return figures


# ── per-type LLM caller ───────────────────────────────────────────────────────


async def _enrich_with_llm(
    prompt: str,
    *,
    pdf_path: str | None,
    text: str,
    provider,
) -> dict:
    """Gemini: multimodal first; falls back to text-only on None or error."""
    if pdf_path and not _is_ollama():
        _heartbeat("calling generate_multimodal")
        try:
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            raw = await provider.generate_multimodal(prompt, pdf_bytes=pdf_bytes)
            if raw:
                return _parse_json_response(raw)
        except Exception as exc:  # noqa: BLE001
            _log_warning("multimodal failed, falling back to text: %s", exc)

    _heartbeat("calling generate (text-only)")
    raw = await provider.generate(
        [{"role": "user", "content": f"{prompt}\n\n{text[:45_000]}"}]
    )
    return _parse_json_response(raw or "")


def _extract_python_symbols(text: str) -> dict:
    """Best-effort Python AST symbol extraction. SyntaxError → empty list."""
    symbols: list[dict] = []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {"symbol_tree": symbols}

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            doc = ast.get_docstring(node) or ""
            symbols.append(
                {
                    "kind": "function",
                    "name": node.name,
                    "line": node.lineno,
                    "docstring": doc[:200],
                }
            )
        elif isinstance(node, ast.ClassDef):
            doc = ast.get_docstring(node) or ""
            symbols.append(
                {
                    "kind": "class",
                    "name": node.name,
                    "line": node.lineno,
                    "docstring": doc[:200],
                }
            )
    return {"symbol_tree": symbols}


# ── main activity ─────────────────────────────────────────────────────────────


@activity.defn(name="enrich_document")
async def enrich_document(inp: dict) -> dict:
    content_type: str = inp.get("content_type", "document")
    pages: list[dict] = inp.get("parsed_pages", [])
    object_key: str | None = inp.get("object_key")
    workspace_id: str = inp.get("workspace_id", "")
    requested: list[str] = inp.get("requested_enrichments", [])
    mime_type: str = inp.get("mime_type", "")
    user_id: str = inp.get("user_id", "")
    workflow_id: str = inp.get("workflow_id", "")

    provider = _make_provider()
    provider_name = os.environ.get("LLM_PROVIDER", "gemini")
    skip_reasons: list[str] = []

    # Multimodal path needs the original PDF on disk; download once, pass to caller.
    pdf_path: str | None = None
    if object_key and mime_type == "application/pdf" and not _is_ollama():
        from worker.lib.s3_client import download_to_tempfile

        try:
            pdf_path = str(download_to_tempfile(object_key))
        except Exception as exc:  # noqa: BLE001
            _log_warning("PDF download failed: %s", exc)

    full_text = "\n\n".join((p.get("text") or "") for p in pages)
    rep_text = _representative_text(pages)

    raw_data: dict = {}

    try:
        if content_type in ("document", "paper"):
            prompt = _COMMON_PROMPT + (
                _PAPER_EXTRA if content_type == "paper" else ""
            )
            raw_data = await _enrich_with_llm(
                prompt,
                pdf_path=pdf_path,
                text=rep_text if _is_ollama() else full_text,
                provider=provider,
            )

        elif content_type == "slide":
            slides = []
            for i, page in enumerate(pages):
                lines = (page.get("text") or "").strip().splitlines()
                title = lines[0] if lines else f"Slide {i + 1}"
                body = "\n".join(lines[1:]) if len(lines) > 1 else ""
                slides.append({"index": i + 1, "title": title, "body": body})
            raw_data = {"slides": slides}

        elif content_type == "book":
            raw_data = await _enrich_with_llm(
                _BOOK_PROMPT, pdf_path=pdf_path, text=rep_text, provider=provider
            )

        elif content_type == "code":
            raw_data = _extract_python_symbols(full_text)

        elif content_type == "table":
            raw_data = await _enrich_with_llm(
                _TABLE_PROMPT,
                pdf_path=pdf_path,
                text=full_text[:45_000],
                provider=provider,
            )

        elif content_type == "image":
            if _is_ollama():
                skip_reasons.append("image_provider_unsupported")
                raw_data = {}
            else:
                raw_data = await _enrich_with_llm(
                    _IMAGE_PROMPT,
                    pdf_path=None,
                    text="",
                    provider=provider,
                )

        # ── figure metadata ───────────────────────────────────────────────
        # parse_pdf already uploaded each figure to its own MinIO key during
        # the parse step; we only record caption / page / object_key here.
        if "figures" in requested:
            raw_data["figures"] = _build_figure_items(
                pages, user_id=user_id, workflow_id=workflow_id
            )
        elif "figures" not in raw_data:
            raw_data["figures"] = []

        # ── translation ────────────────────────────────────────────────────
        if "translation" in requested:
            if provider_name == "ollama":
                skip_reasons.append("translation_provider_unsupported")
                raw_data["translation"] = None
            else:
                src = ""
                sections = raw_data.get("sections") if isinstance(raw_data, dict) else None
                if (
                    content_type == "paper"
                    and isinstance(sections, dict)
                    and sections.get("abstract")
                ):
                    src = sections["abstract"]
                else:
                    src = full_text[:30_000]
                if src.strip():
                    _heartbeat("translating to Korean")
                    # Concatenate (not .format) — abstracts and JSON-rich
                    # papers commonly contain stray `{` / `}` that would
                    # crash str.format on a positional substitution.
                    ko = await provider.generate(
                        [
                            {
                                "role": "user",
                                "content": _TRANSLATION_HEADER + src,
                            }
                        ]
                    )
                    raw_data["translation"] = {
                        "lang": "ko",
                        "text": (ko or "").strip(),
                    }

        if "word_count" not in raw_data or raw_data.get("word_count") == 0:
            raw_data["word_count"] = len(full_text.split())

        # Validate against pydantic; fall back to raw on validation errors so
        # a partial artifact still reaches the DB rather than vanishing.
        try:
            artifact = EnrichmentArtifact.model_validate(raw_data)
            artifact_dict = artifact.model_dump(exclude_none=True)
        except Exception as exc:  # noqa: BLE001
            _log_warning("artifact validation failed: %s", exc)
            artifact_dict = raw_data

    finally:
        if pdf_path:
            try:
                os.unlink(pdf_path)
            except OSError:
                pass

    _log_info(
        "enrichment done: type=%s provider=%s skips=%s",
        content_type,
        provider_name,
        skip_reasons,
    )
    return {
        "artifact": artifact_dict,
        "content_type": content_type,
        "provider": provider_name,
        "skip_reasons": skip_reasons,
    }
