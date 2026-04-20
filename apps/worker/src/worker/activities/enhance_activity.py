"""LLM multimodal enhancement activity for complex-layout documents.

Plan 3 Task 8. Called by :class:`worker.workflows.ingest_workflow.IngestWorkflow`
by the historical name ``enhance_with_gemini`` when a PDF has a complex layout
(tables/diagrams/equations) or a web URL contains complex markers.

The activity is provider-agnostic (Gemini or Ollama via :mod:`llm`); the legacy
name is preserved so the workflow signal contract stays stable.

Flow:
    1. Receive a dict with the full ``IngestInput`` fields plus ``raw_text``
       (the text extracted by the upstream parser activity).
    2. For PDF / image sources, fetch the original bytes from MinIO/R2 and
       call :meth:`llm.base.LLMProvider.generate_multimodal` so the LLM can
       see the visual layout alongside the raw text.
    3. For web URLs (or when the provider returned ``None`` from the
       multimodal path), fall back to a text-only ``provider.generate`` call.
    4. Return ``{"text": enhanced}`` — the workflow replaces the raw text
       with this improved markdown before embedding.
"""
from __future__ import annotations

import os

from temporalio import activity

from llm import get_provider
from llm.base import ProviderConfig
from worker.lib.s3_client import download_to_tempfile


ENHANCE_PROMPT_TEMPLATE = """You are a knowledge extraction assistant.

Below is raw text extracted from a document that contains complex layouts
(tables, diagrams, equations, or figures that may have been poorly extracted).

Original extracted text:
---
{raw_text}
---

Your task:
1. Correct any garbled or incomplete text caused by layout extraction errors.
2. Reconstruct tables as Markdown tables.
3. Describe diagrams and figures in detail in plain text.
4. Render mathematical equations in LaTeX (inline: $...$, block: $$...$$).
5. Return clean, well-structured Markdown suitable for a study note.

Do not add commentary. Return only the improved content.
"""

# Cap raw_text to stay well within context window
MAX_RAW_CHARS = 50_000


def _provider_config() -> ProviderConfig:
    return ProviderConfig(
        provider=os.environ.get("LLM_PROVIDER", "gemini"),
        api_key=os.environ.get("LLM_API_KEY"),
        model=os.environ.get("LLM_MODEL", "gemini-3-flash-preview"),
        embed_model=os.environ.get("EMBED_MODEL", ""),
    )


@activity.defn(name="enhance_with_gemini")
async def enhance_with_gemini(inp: dict) -> dict:
    raw_text: str = (inp.get("raw_text") or "")[:MAX_RAW_CHARS]
    object_key: str | None = inp.get("object_key")
    mime_type: str = inp.get("mime_type") or ""

    activity.logger.info(
        "Enhancing with LLM: object_key=%s, text_len=%d", object_key, len(raw_text)
    )

    if not raw_text.strip():
        activity.logger.warning("enhance called with empty raw_text; returning as-is")
        return {"text": raw_text}

    prompt = ENHANCE_PROMPT_TEMPLATE.format(raw_text=raw_text)
    provider = get_provider(_provider_config())

    enhanced: str | None = None

    # Multimodal path for PDF + image sources — provider may return None if unsupported
    if object_key and mime_type in ("application/pdf", "image/png", "image/jpeg", "image/webp"):
        activity.heartbeat("reading original file from MinIO")
        file_path = download_to_tempfile(object_key)
        try:
            file_bytes = file_path.read_bytes()
            activity.heartbeat("calling provider.generate_multimodal")
            if mime_type == "application/pdf":
                enhanced = await provider.generate_multimodal(prompt, pdf_bytes=file_bytes)
            else:
                enhanced = await provider.generate_multimodal(
                    prompt, image_bytes=file_bytes, image_mime=mime_type
                )
        finally:
            file_path.unlink(missing_ok=True)

    # Text-only fallback (web URLs, or when multimodal returned None)
    if enhanced is None:
        activity.heartbeat("calling provider.generate (text-only)")
        enhanced = await provider.generate([{"role": "user", "content": prompt}])

    enhanced = (enhanced or "").strip() or raw_text

    activity.logger.info("Enhancement complete: %d chars", len(enhanced))
    return {"text": enhanced}
