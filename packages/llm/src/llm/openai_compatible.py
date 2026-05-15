from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from .base import EmbedInput, LLMProvider, ProviderConfig
from .tool_types import AssistantTurn, ToolResult, ToolUse, UsageCounts

DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=5.0)


def normalize_openai_base_url(raw: str | None) -> str:
    if not raw:
        raise ValueError("OPENAI_COMPAT_BASE_URL is required for openai_compatible")
    base = raw.rstrip("/")
    return base if base.endswith("/v1") else f"{base}/v1"


class OpenAICompatibleProvider(LLMProvider):
    def __init__(self, config: ProviderConfig) -> None:
        super().__init__(config)
        self.base_url = normalize_openai_base_url(config.base_url)
        headers = {"Content-Type": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=DEFAULT_TIMEOUT,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def generate(self, messages: list[dict], **kwargs) -> str:
        payload = self._chat_payload(messages, stream=False, **kwargs)
        response = await self._http.post("/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            return ""
        return choices[0].get("message", {}).get("content") or ""

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        if not self.config.embed_model:
            raise NotImplementedError(
                "OPENAI_COMPAT_EMBED_MODEL is required for openai_compatible embeddings"
            )
        for inp in inputs:
            if inp.image_bytes or inp.audio_bytes or inp.pdf_bytes:
                raise NotImplementedError("openai_compatible embeddings support text only")
        texts = [inp.text or "" for inp in inputs]
        if not texts:
            return []
        response = await self._http.post(
            "/embeddings",
            json={"model": self.config.embed_model, "input": texts},
        )
        response.raise_for_status()
        return [list(item["embedding"]) for item in response.json().get("data", [])]

    def build_tool_declarations(self, tools: list[Any]) -> list[dict[str, Any]]:
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
        # OpenAI-compatible servers do not expose Gemini context cache semantics.
        _ = cached_context_id

        declarations = self.build_tool_declarations(tools)
        if allowed_tool_names:
            allowed = set(allowed_tool_names)
            declarations = [
                d
                for d in declarations
                if d.get("function", {}).get("name") in allowed
            ]

        payload = self._chat_payload(
            messages,
            stream=False,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
        if mode != "none" and declarations:
            payload["tools"] = declarations
            payload["tool_choice"] = "required" if mode == "any" else "auto"
        if final_response_schema is not None:
            payload["response_format"] = {"type": "json_object"}

        response = await self._http.post("/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenAI-compatible provider returned no choices")
        choice = choices[0]
        message = choice.get("message") or {}

        tool_uses: list[ToolUse] = []
        for call in message.get("tool_calls") or []:
            fn = call.get("function") or {}
            raw_args = fn.get("arguments") or "{}"
            try:
                args = (
                    json.loads(raw_args)
                    if isinstance(raw_args, str)
                    else dict(raw_args)
                )
            except (TypeError, ValueError) as exc:
                raise RuntimeError(
                    f"OpenAI-compatible provider returned malformed tool arguments "
                    f"for {fn.get('name') or 'unknown tool'}"
                ) from exc
            tool_uses.append(
                ToolUse(
                    id=str(call.get("id") or ""),
                    name=fn.get("name") or "",
                    args=args,
                )
            )

        content = message.get("content") or None
        structured: dict | None = None
        if final_response_schema is not None and content:
            try:
                parsed = json.loads(content)
                structured = parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                structured = None

        usage = data.get("usage") or {}
        usage_counts = UsageCounts(
            input_tokens=usage.get("prompt_tokens") or 0,
            output_tokens=usage.get("completion_tokens") or 0,
            cached_input_tokens=0,
        )
        self.last_usage = usage_counts
        return AssistantTurn(
            final_text=content,
            tool_uses=tuple(tool_uses),
            assistant_message=message,
            structured_output=structured,
            usage=usage_counts,
            stop_reason=str(choice.get("finish_reason") or "STOP"),
        )

    def tool_result_to_message(self, result: ToolResult):
        payload = result.data if not result.is_error else {"error": result.data}
        content = (
            payload
            if isinstance(payload, str)
            else json.dumps(payload, ensure_ascii=False, default=str)
        )
        return {
            "role": "tool",
            "tool_call_id": result.tool_use_id,
            "name": result.name,
            "content": content,
        }

    def _chat_payload(self, messages: list, *, stream: bool, **kwargs: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "stream": stream,
        }
        if kwargs.get("temperature") is not None:
            payload["temperature"] = kwargs["temperature"]
        max_tokens = kwargs.get("max_output_tokens")
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        return payload
