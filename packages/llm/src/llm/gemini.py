from __future__ import annotations

import os
import time
from typing import Any

from google import genai
from google.genai import types

from .base import EmbedInput, LLMProvider, ProviderConfig, SearchResult, ThinkingResult
from .batch_types import (
    BATCH_STATE_CANCELLED,
    BATCH_STATE_EXPIRED,
    BATCH_STATE_FAILED,
    BATCH_STATE_PENDING,
    BATCH_STATE_RUNNING,
    BATCH_STATE_SUCCEEDED,
    BATCH_TERMINAL_STATES,
    BatchEmbedHandle,
    BatchEmbedPoll,
    BatchEmbedResult,
    BatchNotSupported,
)

# Gemini ``JobState`` enum → our normalised strings. Keys are the enum
# ``.value`` (e.g. ``"JOB_STATE_SUCCEEDED"``) so we can tolerate both the
# enum object and a raw string without importing the SDK enum at runtime.
_GEMINI_STATE_MAP: dict[str, str] = {
    "JOB_STATE_UNSPECIFIED": BATCH_STATE_PENDING,
    "JOB_STATE_QUEUED": BATCH_STATE_PENDING,
    "JOB_STATE_PENDING": BATCH_STATE_PENDING,
    "JOB_STATE_RUNNING": BATCH_STATE_RUNNING,
    "JOB_STATE_UPDATING": BATCH_STATE_RUNNING,
    "JOB_STATE_PAUSED": BATCH_STATE_RUNNING,
    "JOB_STATE_SUCCEEDED": BATCH_STATE_SUCCEEDED,
    "JOB_STATE_PARTIALLY_SUCCEEDED": BATCH_STATE_SUCCEEDED,
    "JOB_STATE_FAILED": BATCH_STATE_FAILED,
    "JOB_STATE_CANCELLING": BATCH_STATE_CANCELLED,
    "JOB_STATE_CANCELLED": BATCH_STATE_CANCELLED,
    "JOB_STATE_EXPIRED": BATCH_STATE_EXPIRED,
}


def _normalise_state(raw: Any) -> str:
    key = getattr(raw, "value", None) or getattr(raw, "name", None) or str(raw or "")
    return _GEMINI_STATE_MAP.get(key, BATCH_STATE_PENDING)

GEMINI_MODELS = {
    "pro": "gemini-3.1-pro-preview",
    "flash": "gemini-3-flash-preview",
    "flash_lite": "gemini-3.1-flash-lite-preview",
    "embed": "gemini-embedding-001",
    "tts_flash": "gemini-2.5-flash-preview-tts",
    "tts_pro": "gemini-2.5-pro-preview-tts",
    "live": "gemini-3.1-flash-live-preview",
}


class GeminiProvider(LLMProvider):
    """Gemini-backed provider.

    All network calls use the async SDK surface (`client.aio.models`) so the
    Temporal worker's event loop is never blocked. Retry / rate-limit handling
    is the caller's responsibility — typically the Temporal activity wrapper.
    """

    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._client = genai.Client(api_key=config.api_key)

    async def generate(self, messages: list[dict], **kwargs) -> str:
        """Plain-text chat completion.

        Returns `response.text`; callers needing tool use, grounded search,
        or audio output should use `think()` / `ground_search()` / `tts()`
        where the response is iterated part-by-part instead of flattened.

        ``response_mime_type`` (and any other GenerateContentConfig fields) are
        forwarded into ``config=GenerateContentConfig(...)`` — the SDK no
        longer accepts them as top-level kwargs on ``generate_content``.
        """
        contents = [
            types.Content(
                role=m["role"],
                parts=[types.Part(text=m["content"])],
            )
            for m in messages
        ]
        config_kwargs = {}
        for key in ("response_mime_type", "response_schema", "temperature", "max_output_tokens", "top_p", "top_k"):
            if key in kwargs:
                config_kwargs[key] = kwargs.pop(key)
        call_kwargs: dict = dict(kwargs)
        if config_kwargs:
            call_kwargs["config"] = types.GenerateContentConfig(**config_kwargs)
        response = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=contents,
            **call_kwargs,
        )
        return response.text

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        """Text-only batch embed.

        Per the Gemini embeddings API, `embed_content` only reads `parts.text`;
        multimodal bytes on `EmbedInput` are ignored here. Multimodal ingest
        paths (image/audio/pdf) should go through `generate` with the document
        understanding prompt, not the embedding endpoint.

        Matryoshka (MRL) truncation: ``gemini-embedding-001`` emits a 3072-dim
        vector natively but the first ``output_dimensionality`` dims form a
        self-contained embedding. We forward ``VECTOR_DIM`` so the vector we
        persist matches the pgvector column width (see
        ``packages/db/src/schema/custom-types.ts``). Unset env → no truncation.
        """
        texts = [inp.text for inp in inputs if inp.text]
        if not texts:
            return []
        task_type = inputs[0].task if inputs else "retrieval_document"
        config_kwargs: dict[str, Any] = {"task_type": task_type}
        dim = os.getenv("VECTOR_DIM")
        if dim:
            config_kwargs["output_dimensionality"] = int(dim)
        response = await self._client.aio.models.embed_content(
            model=self.config.embed_model,
            contents=texts,
            config=types.EmbedContentConfig(**config_kwargs),
        )
        return [list(e.values) for e in response.embeddings]

    async def cache_context(self, content: str, ttl: str | None = None) -> str | None:
        # The SDK wants cache options nested under CreateCachedContentConfig,
        # not as top-level kwargs. TTL is optional; callers who want long-
        # lived caches (Research / Librarian agents) pass e.g. "3600s".
        cfg_kwargs: dict = {
            "contents": [types.Content(role="user", parts=[types.Part(text=content)])]
        }
        if ttl:
            cfg_kwargs["ttl"] = ttl
        cached = await self._client.aio.caches.create(
            model=self.config.model,
            config=types.CreateCachedContentConfig(**cfg_kwargs),
        )
        return cached.name

    async def think(self, prompt: str) -> ThinkingResult | None:
        response = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(include_thoughts=True)
            ),
        )
        thinking_parts: list[str] = []
        answer_parts: list[str] = []
        for part in response.candidates[0].content.parts:
            if getattr(part, "thought", False):
                thinking_parts.append(part.text)
            else:
                answer_parts.append(part.text)
        return ThinkingResult(
            thinking="\n".join(thinking_parts),
            final_answer="\n".join(answer_parts),
        )

    async def ground_search(self, query: str) -> SearchResult | None:
        response = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=query,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())]
            ),
        )
        sources: list[dict[str, str]] = []
        grounding = getattr(response.candidates[0], "grounding_metadata", None)
        if grounding and getattr(grounding, "grounding_chunks", None):
            for chunk in grounding.grounding_chunks:
                web = getattr(chunk, "web", None)
                sources.append(
                    {
                        "title": web.title if web else "",
                        "url": web.uri if web else "",
                    }
                )
        return SearchResult(answer=response.text, sources=sources)

    async def tts(self, text: str, model: str | None = None) -> bytes | None:
        tts_model = model or self.config.tts_model or GEMINI_MODELS["tts_flash"]
        response = await self._client.aio.models.generate_content(
            model=tts_model,
            contents=text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
                    )
                ),
            ),
        )
        # Real TTS responses may lead with a text part (safety / meta) before
        # the audio blob, so iterate rather than blindly indexing parts[0].
        for part in response.candidates[0].content.parts:
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "data", None):
                return inline.data
        return None

    async def transcribe(self, audio: bytes) -> str | None:
        response = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=[
                types.Part(inline_data=types.Blob(mime_type="audio/mp3", data=audio)),
                types.Part(
                    text="Transcribe this audio accurately. Return only the transcript text."
                ),
            ],
        )
        return response.text

    async def generate_multimodal(
        self,
        prompt: str,
        *,
        image_bytes: bytes | None = None,
        image_mime: str | None = None,
        pdf_bytes: bytes | None = None,
    ) -> str | None:
        """Image- or PDF-grounded text generation via the async Gemini SDK.

        Gemini handles both images and PDFs as ``inline_data`` parts; the text
        prompt is appended last so the model sees the content *before* the
        instruction. Returns ``None`` when the caller passes ``image_bytes``
        without an accompanying ``image_mime`` (can't guess safely from bytes).
        """
        parts: list = []
        if image_bytes:
            if not image_mime:
                return None  # caller error — mime required
            parts.append(
                types.Part(
                    inline_data=types.Blob(mime_type=image_mime, data=image_bytes)
                )
            )
        if pdf_bytes:
            parts.append(
                types.Part(
                    inline_data=types.Blob(
                        mime_type="application/pdf", data=pdf_bytes
                    )
                )
            )
        parts.append(types.Part(text=prompt))
        response = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=parts,
        )
        return response.text

    def build_tool_declarations(self, tools: list[Any]) -> list[dict[str, Any]]:
        # Lazy import keeps packages/llm free of a module-load dependency
        # on the agent runtime; the concrete type is runtime.tools.Tool.
        from runtime.tool_declarations import build_gemini_declarations

        return build_gemini_declarations(tools)

    # ── Batch embedding (Plan 3b) ────────────────────────────────────────

    @property
    def supports_batch_embed(self) -> bool:
        return True

    async def embed_batch_submit(
        self,
        inputs: list[EmbedInput],
        *,
        display_name: str | None = None,
    ) -> BatchEmbedHandle:
        """Submit an async batch embed job.

        Uses ``client.aio.batches.create_embeddings`` with inlined requests.
        All items share one :class:`EmbedContentConfig` — ``task_type`` is
        taken from the first input (matching the single-call ``embed()``
        convention) and ``output_dimensionality`` is sourced from
        ``VECTOR_DIM`` so the produced vectors match the pgvector column.

        Raises :class:`ValueError` if the list is empty or contains no text.
        """
        texts = [inp.text for inp in inputs if inp.text]
        if not texts:
            raise ValueError("embed_batch_submit requires at least one text input")
        task_type = inputs[0].task if inputs else "retrieval_document"
        config_kwargs: dict[str, Any] = {"task_type": task_type}
        dim = os.getenv("VECTOR_DIM")
        if dim:
            config_kwargs["output_dimensionality"] = int(dim)
        src = types.EmbeddingsBatchJobSource(
            inlined_requests=types.EmbedContentBatch(
                contents=texts,
                config=types.EmbedContentConfig(**config_kwargs),
            )
        )
        create_config = types.CreateEmbeddingsBatchJobConfig(
            display_name=display_name or f"opencairn-embed-{int(time.time())}",
        )
        job = await self._client.aio.batches.create_embeddings(
            model=self.config.embed_model,
            src=src,
            config=create_config,
        )
        if not job.name:
            raise RuntimeError(
                "Gemini batch submit returned a BatchJob with no .name"
            )
        return BatchEmbedHandle(
            provider_batch_name=job.name,
            submitted_at=time.time(),
            input_count=len(texts),
        )

    async def embed_batch_poll(self, handle: BatchEmbedHandle) -> BatchEmbedPoll:
        """Fetch current batch state + counts.

        Gemini's ``BatchJob`` doesn't expose per-item success/failure counts
        while running — only the terminal ``dest.inlined_embed_content_responses``
        reveals them. We return ``request_count = handle.input_count`` for
        caller observability and leave success/failure at 0 until terminal.
        """
        job = await self._client.aio.batches.get(name=handle.provider_batch_name)
        state = _normalise_state(job.state)
        successful = 0
        failed = 0
        pending = handle.input_count
        if state == BATCH_STATE_SUCCEEDED and job.dest is not None:
            responses = job.dest.inlined_embed_content_responses or []
            for r in responses:
                if r.error is not None:
                    failed += 1
                elif r.response is not None and r.response.embedding is not None:
                    successful += 1
            pending = max(0, handle.input_count - successful - failed)
        return BatchEmbedPoll(
            state=state,
            request_count=handle.input_count,
            successful_request_count=successful,
            failed_request_count=failed,
            pending_request_count=pending,
            done=state in BATCH_TERMINAL_STATES,
        )

    async def embed_batch_fetch(self, handle: BatchEmbedHandle) -> BatchEmbedResult:
        """Fetch aligned per-item vectors.

        ``inlined_embed_content_responses`` preserves input order per the
        SDK docs. A response's ``.error`` being set → we emit ``None`` at
        that index so the caller can decide per call-site how to handle
        the loss (Compiler drops, Librarian retries next sweep).
        """
        job = await self._client.aio.batches.get(name=handle.provider_batch_name)
        state = _normalise_state(job.state)
        if state != BATCH_STATE_SUCCEEDED:
            raise RuntimeError(
                f"embed_batch_fetch called on non-succeeded batch "
                f"{handle.provider_batch_name!r}: state={state}"
            )
        dest = job.dest
        if dest is None or dest.inlined_embed_content_responses is None:
            raise RuntimeError(
                f"Gemini batch {handle.provider_batch_name!r} succeeded but has no "
                "inlined responses — dest=None or missing responses"
            )
        vectors: list[list[float] | None] = []
        errors: list[str | None] = []
        for r in dest.inlined_embed_content_responses:
            if r.error is not None:
                vectors.append(None)
                msg = r.error.message or "unknown error"
                errors.append(f"[{r.error.code or 0}] {msg}")
            elif r.response is not None and r.response.embedding is not None:
                vectors.append(list(r.response.embedding.values or []))
                errors.append(None)
            else:
                vectors.append(None)
                errors.append("empty response")
        return BatchEmbedResult(vectors=vectors, errors=errors)

    async def embed_batch_cancel(self, handle: BatchEmbedHandle) -> None:
        await self._client.aio.batches.cancel(name=handle.provider_batch_name)

    # ── Tool-calling surface (Plan Agent Runtime v2 · A) ────────────────

    def supports_tool_calling(self) -> bool:
        return True

    def supports_parallel_tool_calling(self) -> bool:
        # C will enable this once the executor can partition read-only
        # tool batches and dispatch them concurrently.
        return False

    @staticmethod
    def _build_function_declarations(tools: list) -> list[dict[str, Any]]:
        """Translate runtime.tools.Tool instances to Gemini
        `function_declarations` shape. `input_schema()` already strips
        `ToolContext` params (handled by the @tool decorator)."""
        decls: list[dict[str, Any]] = []
        for t in tools:
            decls.append({
                "name": t.name,
                "description": t.description,
                "parameters": t.input_schema(),
            })
        return decls
