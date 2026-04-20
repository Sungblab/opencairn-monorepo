from __future__ import annotations

from typing import Any

from google import genai
from google.genai import types

from .base import EmbedInput, LLMProvider, ProviderConfig, SearchResult, ThinkingResult

GEMINI_MODELS = {
    "pro": "gemini-3.1-pro-preview",
    "flash": "gemini-3-flash-preview",
    "flash_lite": "gemini-3.1-flash-lite-preview",
    "embed": "gemini-embedding-2-preview",
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
        """
        contents = [
            types.Content(
                role=m["role"],
                parts=[types.Part(text=m["content"])],
            )
            for m in messages
        ]
        response = await self._client.aio.models.generate_content(
            model=self.config.model,
            contents=contents,
            **kwargs,
        )
        return response.text

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        """Text-only batch embed.

        Per the Gemini embeddings API, `embed_content` only reads `parts.text`;
        multimodal bytes on `EmbedInput` are ignored here. Multimodal ingest
        paths (image/audio/pdf) should go through `generate` with the document
        understanding prompt, not the embedding endpoint.
        """
        texts = [inp.text for inp in inputs if inp.text]
        if not texts:
            return []
        task_type = inputs[0].task if inputs else "retrieval_document"
        response = await self._client.aio.models.embed_content(
            model=self.config.embed_model,
            contents=texts,
            config=types.EmbedContentConfig(task_type=task_type),
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
