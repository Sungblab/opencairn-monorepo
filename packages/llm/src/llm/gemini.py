from __future__ import annotations

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
    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._client = genai.Client(api_key=config.api_key)

    async def generate(self, messages: list[dict], **kwargs) -> str:
        contents = [
            types.Content(
                role=m["role"],
                parts=[types.Part(text=m["content"])],
            )
            for m in messages
        ]
        response = self._client.models.generate_content(
            model=self.config.model,
            contents=contents,
            **kwargs,
        )
        return response.text

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        parts: list[types.Part] = []
        for inp in inputs:
            if inp.text:
                parts.append(types.Part(text=inp.text))
            if inp.image_bytes:
                parts.append(
                    types.Part(
                        inline_data=types.Blob(mime_type="image/jpeg", data=inp.image_bytes)
                    )
                )
            if inp.audio_bytes:
                parts.append(
                    types.Part(
                        inline_data=types.Blob(mime_type="audio/mp3", data=inp.audio_bytes)
                    )
                )
            if inp.pdf_bytes:
                parts.append(
                    types.Part(
                        inline_data=types.Blob(
                            mime_type="application/pdf", data=inp.pdf_bytes
                        )
                    )
                )

        task_type = inputs[0].task if inputs else "retrieval_document"
        response = self._client.models.embed_content(
            model=self.config.embed_model,
            contents=parts,
            config=types.EmbedContentConfig(task_type=task_type),
        )
        return [list(e.values) for e in response.embeddings]

    async def cache_context(self, content: str) -> str | None:
        cached = self._client.caches.create(
            model=self.config.model,
            contents=[types.Content(role="user", parts=[types.Part(text=content)])],
        )
        return cached.name

    async def think(self, prompt: str) -> ThinkingResult | None:
        response = self._client.models.generate_content(
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
        response = self._client.models.generate_content(
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
        response = self._client.models.generate_content(
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
        return response.audio

    async def transcribe(self, audio: bytes) -> str | None:
        response = self._client.models.generate_content(
            model=self.config.model,
            contents=[
                types.Part(inline_data=types.Blob(mime_type="audio/mp3", data=audio)),
                types.Part(
                    text="Transcribe this audio accurately. Return only the transcript text."
                ),
            ],
        )
        return response.text
