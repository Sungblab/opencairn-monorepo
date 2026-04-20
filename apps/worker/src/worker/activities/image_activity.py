"""Image analysis activity — multimodal description via provider.generate_multimodal.

Plan 3 Task 5. Called by :class:`worker.workflows.ingest_workflow.IngestWorkflow`
by name (``analyze_image``) for any ``image/*`` mime type.

Flow:
    1. Download the uploaded object from MinIO/R2 to a temp file.
    2. Read the bytes and hand them to the configured LLM provider via
       :meth:`llm.base.LLMProvider.generate_multimodal` along with a fixed
       description prompt.
    3. If the provider doesn't support image analysis (e.g. a text-only
       Ollama model with no ``OLLAMA_VISION_MODEL`` configured), log a
       warning and return an empty description — the workflow continues
       so the uploaded image is still recorded as a source note.

Unlike the STT activity there's no local fallback: OCR/captioning without a
vision model is out of scope for v1. Self-host users who want offline image
analysis should set ``OLLAMA_VISION_MODEL`` (e.g. ``llava``) in their env.
"""
from __future__ import annotations

import os

from temporalio import activity

from llm import get_provider
from llm.base import ProviderConfig
from worker.lib.s3_client import download_to_tempfile

IMAGE_PROMPT = (
    "Describe this image in detail. If it contains a diagram, chart, table, or "
    "mathematical notation, extract and explain the content precisely. "
    "Return plain text suitable for inclusion in a study note."
)


def _provider_config() -> ProviderConfig:
    """Build a :class:`ProviderConfig` from worker env vars (same shape as
    the rest of Plan 13's provider wiring)."""
    return ProviderConfig(
        provider=os.environ.get("LLM_PROVIDER", "gemini"),
        api_key=os.environ.get("LLM_API_KEY"),
        model=os.environ.get("LLM_MODEL", "gemini-3-flash-preview"),
        embed_model=os.environ.get("EMBED_MODEL", ""),
    )


@activity.defn(name="analyze_image")
async def analyze_image(inp: dict) -> dict:
    """Describe an uploaded image via the configured multimodal provider.

    Returns a dict with key ``description`` (possibly empty string). The
    workflow writes this into a source note downstream.
    """
    object_key: str = inp["object_key"]
    mime_type: str = inp["mime_type"]
    activity.logger.info("Analyzing image: %s", object_key)

    image_path = download_to_tempfile(object_key)
    try:
        image_bytes = image_path.read_bytes()

        provider = get_provider(_provider_config())
        description = await provider.generate_multimodal(
            IMAGE_PROMPT,
            image_bytes=image_bytes,
            image_mime=mime_type,
        )

        if description is None:
            # Provider opted out (base class default or Ollama without a
            # vision model). Proceed with an empty description so the
            # ingest workflow still records the upload as a source.
            activity.logger.warning(
                "Provider %s doesn't support image analysis; returning empty description",
                _provider_config().provider,
            )
            description = ""

        activity.logger.info("Image analysis complete: %d chars", len(description))
        return {"description": description}
    finally:
        image_path.unlink(missing_ok=True)
