from __future__ import annotations

import base64
import json
import os
from collections.abc import Sequence
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from .base import EmbedInput, LLMProvider, ProviderConfig
from .tool_types import AssistantTurn, ToolResult, ToolUse, UsageCounts

OLLAMA_DEFAULT_URL = "http://localhost:11434"


class OllamaProvider(LLMProvider):
    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self._base = (config.base_url or OLLAMA_DEFAULT_URL).rstrip("/")
        # Single shared client — ingest embeds thousands of chunks per doc,
        # so a new AsyncClient per call would burn TLS handshakes + FDs.
        # `connect` is short; `read` is long to cover CPU-bound local generates.
        self._http = httpx.AsyncClient(
            base_url=self._base,
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0),
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    @staticmethod
    def _schema_to_format(schema: Any) -> Any:
        if schema is None:
            return None
        if isinstance(schema, dict):
            return schema
        if isinstance(schema, type) and issubclass(schema, BaseModel):
            return schema.model_json_schema()
        if hasattr(schema, "model_json_schema"):
            return schema.model_json_schema()
        return schema

    @staticmethod
    def _normalise_options(kwargs: dict[str, Any]) -> dict[str, Any] | None:
        options = dict(kwargs.pop("options", {}) or {})
        option_key_map = {
            "temperature": "temperature",
            "top_p": "top_p",
            "top_k": "top_k",
            "max_output_tokens": "num_predict",
        }
        for source, target in option_key_map.items():
            if source in kwargs and kwargs[source] is not None:
                options[target] = kwargs.pop(source)
        return options or None

    def _apply_common_chat_kwargs(
        self,
        payload: dict[str, Any],
        kwargs: dict[str, Any],
        *,
        final_response_schema: type[BaseModel] | None = None,
    ) -> None:
        options = self._normalise_options(kwargs)
        if options:
            payload["options"] = options

        response_schema = (
            final_response_schema
            or kwargs.pop("response_schema", None)
            or kwargs.pop("response_json_schema", None)
        )
        response_format = kwargs.pop("format", None)
        if response_format is None:
            response_format = self._schema_to_format(response_schema)
        if (
            response_format is None
            and kwargs.pop("response_mime_type", None) == "application/json"
        ):
            response_format = "json"
        if response_format is not None:
            payload["format"] = response_format

        think = kwargs.pop("think", self.config.extra.get("think"))
        if think is not None:
            payload["think"] = think

    async def generate(self, messages: list[dict], **kwargs) -> str:
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "stream": False,
        }
        self._apply_common_chat_kwargs(payload, kwargs)
        response = await self._http.post(
            "/api/chat",
            json=payload,
        )
        response.raise_for_status()
        return response.json()["message"]["content"]

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        # Ollama's embed endpoint is text-only. Fail loudly rather than
        # silently padding image/audio/pdf inputs with empty strings.
        for inp in inputs:
            if inp.image_bytes or inp.audio_bytes or inp.pdf_bytes:
                raise NotImplementedError(
                    "OllamaProvider.embed supports text only; "
                    "route multimodal inputs through GeminiProvider or ingest."
                )
        texts = [inp.text or "" for inp in inputs]
        response = await self._http.post(
            "/api/embed",
            json={"model": self.config.embed_model, "input": texts},
        )
        response.raise_for_status()
        return response.json()["embeddings"]

    async def generate_multimodal(
        self,
        prompt: str,
        *,
        image_bytes: bytes | None = None,
        image_mime: str | None = None,
        pdf_bytes: bytes | None = None,
    ) -> str | None:
        """Image-grounded generation via an Ollama vision model.

        Ollama's ``/api/generate`` accepts an ``images`` array of base64
        strings and has no native PDF handler — so PDFs short-circuit to
        ``None`` for the ingest pipeline to fall back to another path.

        The vision model is chosen from ``OLLAMA_VISION_MODEL`` if set,
        otherwise we reuse ``config.model``; when the configured model has
        no vision head, Ollama returns an empty/garbled string, which is
        still preferable to a hard failure inside a Temporal activity.
        """
        if pdf_bytes or not image_bytes:
            return None
        vision_model = os.environ.get("OLLAMA_VISION_MODEL", self.config.model)
        response = await self._http.post(
            "/api/generate",
            json={
                "model": vision_model,
                "prompt": prompt,
                "images": [base64.b64encode(image_bytes).decode()],
                "stream": False,
            },
        )
        response.raise_for_status()
        return response.json().get("response")

    def build_tool_declarations(self, tools: list[Any]) -> list[dict[str, Any]]:
        # Lazy import keeps packages/llm free of a module-load dependency
        # on the agent runtime; the concrete type is runtime.tools.Tool.
        from runtime.tool_declarations import build_ollama_declarations

        return build_ollama_declarations(tools)

    def supports_tool_calling(self) -> bool:
        return True

    async def generate_with_tools(
        self,
        messages: list,
        tools: list,
        *,
        mode: Literal["auto", "any", "none"] = "auto",
        allowed_tool_names: Sequence[str] | None = None,
        final_response_schema: type[BaseModel] | None = None,
        cached_context_id: str | None = None,
        temperature: float | None = None,
        max_output_tokens: int | None = None,
    ) -> AssistantTurn:
        # Ollama has no context-cache equivalent; degrade gracefully.
        _ = cached_context_id

        declarations = self.build_tool_declarations(tools)
        if allowed_tool_names:
            allowed = set(allowed_tool_names)
            declarations = [
                d for d in declarations
                if d.get("function", {}).get("name") in allowed
            ]

        kwargs: dict[str, Any] = {
            "temperature": temperature,
            "max_output_tokens": max_output_tokens,
        }
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "stream": False,
        }
        if mode != "none" and declarations:
            payload["tools"] = declarations
        self._apply_common_chat_kwargs(
            payload,
            kwargs,
            final_response_schema=final_response_schema,
        )
        response = await self._http.post("/api/chat", json=payload)
        response.raise_for_status()
        data = response.json()
        message = data.get("message") or {}

        tool_uses: list[ToolUse] = []
        for index, call in enumerate(message.get("tool_calls") or []):
            fn = call.get("function") or {}
            name = fn.get("name")
            if not name:
                continue
            raw_args = fn.get("arguments") or {}
            args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
            raw_id = fn.get("index", call.get("id"))
            call_id = str(raw_id) if raw_id not in (None, "") else str(index)
            tool_uses.append(ToolUse(id=call_id, name=name, args=args))

        final_text = message.get("content") or None
        structured: dict | None = None
        if final_response_schema is not None and final_text:
            try:
                parsed = json.loads(final_text)
                structured = parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                structured = None

        return AssistantTurn(
            final_text=final_text,
            tool_uses=tuple(tool_uses),
            assistant_message=message,
            structured_output=structured,
            usage=UsageCounts(
                input_tokens=data.get("prompt_eval_count") or 0,
                output_tokens=data.get("eval_count") or 0,
                cached_input_tokens=0,
            ),
            stop_reason=str(data.get("done_reason") or "STOP"),
        )

    def tool_result_to_message(self, result: ToolResult):
        payload = result.data if not result.is_error else {"error": result.data}
        content = (
            payload
            if isinstance(payload, str)
            else json.dumps(payload, ensure_ascii=False, default=str)
        )
        return {"role": "tool", "tool_name": result.name, "content": content}

    def supports_ocr(self) -> bool:
        return False

    async def ocr(self, image_bytes: bytes, mime_type: str = "image/png") -> str:
        # Vision models on Ollama vary widely in OCR quality and aren't
        # reliable enough to silently substitute for Gemini Vision; fail
        # fast with an actionable message so scan-PDF ingest surfaces the
        # need to switch providers instead of producing empty notes.
        raise NotImplementedError(
            "Ollama OCR not supported. Use Gemini provider for scan PDF."
        )
