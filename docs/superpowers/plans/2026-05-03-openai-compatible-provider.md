# OpenAI-Compatible Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `openai_compatible` provider support across Python `packages/llm` and the TypeScript API chat provider boundary without replacing Gemini native features or Ollama native worker support.

**Architecture:** Python workers keep using `packages/llm.get_provider()` and gain a direct-`httpx` `OpenAICompatibleProvider` for chat, streaming, embeddings, and OpenAI-style tool calls. API chat gets a minimal provider boundary in `apps/api/src/lib/llm/provider.ts`, keeps Gemini in `gemini.ts`, and adds `openai-compatible.ts` selected by env at runtime. Compatible endpoints are env-only in Phase A and normalize the `/v1` suffix so vLLM, LiteLLM, Ollama `/v1`, LM Studio, OpenRouter, and internal gateways work consistently.

**Tech Stack:** Python 3.12, `httpx`, pytest/respx, TypeScript, Hono API, Vitest, `fetch` streaming, OpenAI Chat Completions and Embeddings wire format.

---

## Scope And Non-Goals

- Do not add a provider named `openai`; keep that name unsupported.
- Do not remove or genericize Gemini native features such as Deep Research, grounding, context cache, TTS, OCR, PDF/image multimodal paths, or Gemini-specific thinking.
- Do not remove native Python Ollama support.
- Do not allow request-body base URLs. Phase A reads compatible endpoint config only from deployment env or explicit test config.
- Do not add DB migrations.
- Do not update `docs/contributing/plans-status.md` before this PR is merged.

## File Map

- Create `packages/llm/src/llm/openai_compatible.py`: direct `httpx.AsyncClient` provider for `/chat/completions` and `/embeddings`, URL normalization, optional tool calling, and clear unsupported capability behavior.
- Modify `packages/llm/src/llm/factory.py`: accept `LLM_PROVIDER=openai_compatible`, read `OPENAI_COMPAT_*` env, and keep `openai` rejected.
- Modify `packages/llm/src/llm/__init__.py`: export `OpenAICompatibleProvider` only if useful to tests/callers.
- Create `packages/llm/tests/test_openai_compatible.py`: respx-backed tests for chat, streaming, embeddings, tool calls, unsupported OCR/deep-research behavior, and `/v1` normalization.
- Modify `packages/llm/tests/test_factory.py`: env/config factory coverage.
- Create `apps/api/src/lib/llm/provider.ts`: shared API provider types and `LLMNotConfiguredError`.
- Modify `apps/api/src/lib/llm/gemini.ts`: import shared types, keep Gemini implementation behavior unchanged.
- Create `apps/api/src/lib/llm/openai-compatible.ts`: env-selected compatible API provider with `fetch`, SSE parsing, embeddings, usage mapping, `/v1` normalization, and AbortSignal support.
- Create `apps/api/src/lib/llm/index.ts`: `getChatProvider()` factory selecting Gemini by default or `openai_compatible`.
- Modify `apps/api/src/lib/chat-llm.ts`: import `getChatProvider` and shared provider types from the new boundary.
- Create `apps/api/tests/lib/llm-openai-compatible.test.ts`: mocked `fetch` tests for streaming, embeddings, env errors, URL normalization, and abort propagation.
- Modify `apps/api/tests/lib/llm-gemini.test.ts`: update import path if error/types move.
- Modify `.env.example`: document `openai_compatible` and `OPENAI_COMPAT_*`, explicitly saying `OPENAI_COMPAT_BASE_URL` may include or omit `/v1`.

## Task 1: Python Provider Tests

**Files:**
- Create: `packages/llm/tests/test_openai_compatible.py`

- [x] **Step 1: Write failing tests for Python compatible provider**

Add tests that define the expected API before production code exists:

```python
from __future__ import annotations

import json

import httpx
import pytest
import respx

from llm.base import EmbedInput, ProviderConfig
from llm.openai_compatible import OpenAICompatibleProvider
from llm.tool_types import ToolResult


def make_provider(**overrides) -> OpenAICompatibleProvider:
    config = ProviderConfig(
        provider="openai_compatible",
        api_key=overrides.get("api_key", "test-key"),
        model=overrides.get("model", "qwen2.5"),
        embed_model=overrides.get("embed_model", "text-embedding"),
        base_url=overrides.get("base_url", "http://localhost:8000"),
    )
    return OpenAICompatibleProvider(config)


def test_normalizes_base_url_to_v1():
    assert make_provider(base_url="http://localhost:8000").base_url == "http://localhost:8000/v1"
    assert make_provider(base_url="http://localhost:8000/v1").base_url == "http://localhost:8000/v1"


@pytest.mark.asyncio
async def test_generate_posts_chat_completion():
    provider = make_provider()
    captured = {}

    def capture(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "hello"}}]},
        )

    with respx.mock:
        respx.post("http://localhost:8000/v1/chat/completions").mock(side_effect=capture)
        out = await provider.generate([{"role": "user", "content": "hi"}], temperature=0.2)

    assert out == "hello"
    assert captured["payload"]["model"] == "qwen2.5"
    assert captured["payload"]["messages"] == [{"role": "user", "content": "hi"}]
    assert captured["payload"]["temperature"] == 0.2


@pytest.mark.asyncio
async def test_embed_posts_embeddings_endpoint():
    provider = make_provider()
    with respx.mock:
        respx.post("http://localhost:8000/v1/embeddings").mock(
            return_value=httpx.Response(
                200,
                json={"data": [{"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}]},
            )
        )
        out = await provider.embed([EmbedInput(text="a"), EmbedInput(text="b")])

    assert out == [[0.1, 0.2], [0.3, 0.4]]


def test_embed_without_model_fails_clearly():
    provider = make_provider(embed_model="")
    with pytest.raises(NotImplementedError, match="embeddings"):
        import asyncio
        asyncio.run(provider.embed([EmbedInput(text="a")]))


@pytest.mark.asyncio
async def test_generate_with_tools_parses_openai_tool_calls(monkeypatch):
    provider = make_provider()
    monkeypatch.setattr(
        provider,
        "build_tool_declarations",
        lambda tools: [
            {
                "type": "function",
                "function": {
                    "name": "search_notes",
                    "description": "Search notes",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ],
    )

    with respx.mock:
        respx.post("http://localhost:8000/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "call_1",
                                        "type": "function",
                                        "function": {
                                            "name": "search_notes",
                                            "arguments": "{\"query\":\"rope\"}",
                                        },
                                    }
                                ],
                            },
                            "finish_reason": "tool_calls",
                        }
                    ],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 2},
                },
            )
        )
        turn = await provider.generate_with_tools(
            messages=[{"role": "user", "content": "search"}],
            tools=[object()],
        )

    assert turn.tool_uses[0].id == "call_1"
    assert turn.tool_uses[0].name == "search_notes"
    assert turn.tool_uses[0].args == {"query": "rope"}
    assert turn.usage.input_tokens == 10
    assert turn.usage.output_tokens == 2


def test_tool_result_to_message_uses_openai_tool_role():
    provider = make_provider()
    assert provider.tool_result_to_message(
        ToolResult(tool_use_id="call_1", name="search_notes", data={"rows": 1})
    ) == {
        "role": "tool",
        "tool_call_id": "call_1",
        "name": "search_notes",
        "content": "{\"rows\": 1}",
    }


def test_gemini_native_capabilities_remain_unsupported():
    provider = make_provider()
    assert provider.supports_ocr() is False
    with pytest.raises(NotImplementedError, match="Interactions API"):
        import asyncio
        asyncio.run(provider.get_interaction("x"))
```

- [x] **Step 2: Verify tests fail for missing module**

Run: `pnpm --dir packages/llm exec pytest tests/test_openai_compatible.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'llm.openai_compatible'`.

## Task 2: Python Provider Implementation

**Files:**
- Create: `packages/llm/src/llm/openai_compatible.py`
- Modify: `packages/llm/src/llm/factory.py`
- Modify: `packages/llm/src/llm/__init__.py`
- Modify: `packages/llm/tests/test_factory.py`

- [x] **Step 1: Implement `OpenAICompatibleProvider` minimally**

Create `openai_compatible.py` with:

```python
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
        self._http = httpx.AsyncClient(base_url=self.base_url, headers=headers, timeout=DEFAULT_TIMEOUT)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def generate(self, messages: list[dict], **kwargs) -> str:
        payload = self._chat_payload(messages, stream=False, **kwargs)
        response = await self._http.post("/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"].get("content") or ""

    async def embed(self, inputs: list[EmbedInput]) -> list[list[float]]:
        if not self.config.embed_model:
            raise NotImplementedError("openai_compatible embeddings require OPENAI_COMPAT_EMBED_MODEL")
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
        _ = cached_context_id
        declarations = self.build_tool_declarations(tools)
        if allowed_tool_names:
            allowed = set(allowed_tool_names)
            declarations = [d for d in declarations if d.get("function", {}).get("name") in allowed]
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
        choice = data["choices"][0]
        message = choice.get("message") or {}
        tool_uses = []
        for call in message.get("tool_calls") or []:
            fn = call.get("function") or {}
            raw_args = fn.get("arguments") or "{}"
            args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
            tool_uses.append(ToolUse(id=str(call.get("id") or ""), name=fn.get("name") or "", args=args))
        content = message.get("content") or None
        structured = None
        if final_response_schema is not None and content:
            try:
                parsed = json.loads(content)
                structured = parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                structured = None
        usage = data.get("usage") or {}
        return AssistantTurn(
            final_text=content,
            tool_uses=tuple(tool_uses),
            assistant_message=message,
            structured_output=structured,
            usage=UsageCounts(
                input_tokens=usage.get("prompt_tokens") or 0,
                output_tokens=usage.get("completion_tokens") or 0,
                cached_input_tokens=0,
            ),
            stop_reason=str(choice.get("finish_reason") or "STOP"),
        )

    def tool_result_to_message(self, result: ToolResult):
        payload = result.data if not result.is_error else {"error": result.data}
        content = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False, default=str)
        return {
            "role": "tool",
            "tool_call_id": result.tool_use_id,
            "name": result.name,
            "content": content,
        }

    def _chat_payload(self, messages: list, *, stream: bool, **kwargs: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {"model": self.config.model, "messages": messages, "stream": stream}
        if kwargs.get("temperature") is not None:
            payload["temperature"] = kwargs["temperature"]
        max_tokens = kwargs.get("max_output_tokens")
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        return payload
```

- [x] **Step 2: Update Python factory**

Change `packages/llm/src/llm/factory.py` to:

```python
from .openai_compatible import OpenAICompatibleProvider

REQUIRED_ENV = ("LLM_PROVIDER", "LLM_MODEL")

...
provider = os.environ["LLM_PROVIDER"]
config = ProviderConfig(
    provider=provider,
    api_key=os.getenv("OPENAI_COMPAT_API_KEY") if provider == "openai_compatible" else os.getenv("LLM_API_KEY"),
    model=os.getenv("OPENAI_COMPAT_CHAT_MODEL") if provider == "openai_compatible" else os.environ["LLM_MODEL"],
    embed_model=os.getenv("OPENAI_COMPAT_EMBED_MODEL", "") if provider == "openai_compatible" else os.environ["EMBED_MODEL"],
    tts_model=os.getenv("TTS_MODEL"),
    base_url=os.getenv("OPENAI_COMPAT_BASE_URL") if provider == "openai_compatible" else os.getenv("OLLAMA_BASE_URL"),
)
```

Then add `case "openai_compatible": return OpenAICompatibleProvider(config)`.

- [x] **Step 3: Add factory tests**

Append to `packages/llm/tests/test_factory.py`:

```python
from llm.openai_compatible import OpenAICompatibleProvider


def test_get_provider_openai_compatible():
    config = ProviderConfig(
        provider="openai_compatible",
        api_key="key",
        model="qwen",
        embed_model="embed",
        base_url="http://localhost:8000",
    )
    assert isinstance(get_provider(config), OpenAICompatibleProvider)


def test_get_provider_openai_compatible_from_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("OPENAI_COMPAT_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("OPENAI_COMPAT_CHAT_MODEL", "qwen")
    monkeypatch.setenv("OPENAI_COMPAT_EMBED_MODEL", "embed")
    provider = get_provider()
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.config.model == "qwen"
    assert provider.config.embed_model == "embed"
```

- [x] **Step 4: Verify Python tests pass**

Run:

```bash
pnpm --dir packages/llm exec pytest tests/test_openai_compatible.py tests/test_factory.py -q
```

Expected: PASS.

## Task 3: API Provider Boundary Tests

**Files:**
- Create: `apps/api/tests/lib/llm-openai-compatible.test.ts`
- Modify: `apps/api/tests/lib/llm-gemini.test.ts`

- [x] **Step 1: Write failing API tests**

Create `apps/api/tests/lib/llm-openai-compatible.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getOpenAICompatibleProvider,
  normalizeOpenAICompatibleBaseUrl,
} from "../../src/lib/llm/openai-compatible.js";
import { LLMNotConfiguredError, type StreamChunk } from "../../src/lib/llm/provider.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_COMPAT_BASE_URL = "http://localhost:8000";
  process.env.OPENAI_COMPAT_API_KEY = "test-key";
  process.env.OPENAI_COMPAT_CHAT_MODEL = "qwen";
  process.env.OPENAI_COMPAT_EMBED_MODEL = "embed";
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("normalizeOpenAICompatibleBaseUrl", () => {
  it("appends /v1 when omitted", () => {
    expect(normalizeOpenAICompatibleBaseUrl("http://localhost:8000")).toBe("http://localhost:8000/v1");
    expect(normalizeOpenAICompatibleBaseUrl("http://localhost:8000/v1")).toBe("http://localhost:8000/v1");
  });
});

describe("getOpenAICompatibleProvider", () => {
  it("throws typed not-configured error without base URL or chat model", () => {
    delete process.env.OPENAI_COMPAT_BASE_URL;
    expect(() => getOpenAICompatibleProvider()).toThrowError(LLMNotConfiguredError);
  });

  it("streams OpenAI-compatible SSE deltas and usage with AbortSignal", async () => {
    const controller = new AbortController();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const body = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        ctrl.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":" world"}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n'));
        ctrl.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(body, { status: 200 });
    }));

    const provider = getOpenAICompatibleProvider();
    const out: StreamChunk[] = [];
    for await (const chunk of provider.streamGenerate({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
      maxOutputTokens: 64,
      temperature: 0.1,
    })) {
      out.push(chunk);
    }

    expect(calls[0].url).toBe("http://localhost:8000/v1/chat/completions");
    expect(calls[0].init.signal).toBe(controller.signal);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: "qwen",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 64,
      temperature: 0.1,
    });
    expect(out).toEqual([
      { delta: "Hello" },
      { delta: " world" },
      { usage: { tokensIn: 4, tokensOut: 2, model: "qwen" } },
    ]);
  });

  it("embeds text through compatible embeddings endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const provider = getOpenAICompatibleProvider();
    await expect(provider.embed("hello")).resolves.toEqual([0.1, 0.2]);
  });

  it("throws a clear error when embeddings are not configured", async () => {
    delete process.env.OPENAI_COMPAT_EMBED_MODEL;
    const provider = getOpenAICompatibleProvider();
    await expect(provider.embed("hello")).rejects.toThrow(/OPENAI_COMPAT_EMBED_MODEL/);
  });
});
```

- [x] **Step 2: Verify tests fail for missing module**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-openai-compatible.test.ts
```

Expected: FAIL because `openai-compatible.ts` and `provider.ts` do not exist.

## Task 4: API Provider Boundary Implementation

**Files:**
- Create: `apps/api/src/lib/llm/provider.ts`
- Modify: `apps/api/src/lib/llm/gemini.ts`
- Create: `apps/api/src/lib/llm/openai-compatible.ts`
- Create: `apps/api/src/lib/llm/index.ts`
- Modify: `apps/api/src/lib/chat-llm.ts`

- [x] **Step 1: Extract shared provider types**

Create `apps/api/src/lib/llm/provider.ts`:

```ts
export type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type Usage = {
  tokensIn: number;
  tokensOut: number;
  model: string;
};

export type ThinkingLevel = "low" | "medium" | "high";

export type StreamChunk = { delta: string } | { usage: Usage };

export interface LLMProvider {
  embed(text: string): Promise<number[]>;
  streamGenerate(opts: {
    messages: ChatMsg[];
    signal?: AbortSignal;
    maxOutputTokens?: number;
    temperature?: number;
    thinkingLevel?: ThinkingLevel;
  }): AsyncGenerator<StreamChunk>;
}

export class LLMNotConfiguredError extends Error {
  readonly code = "llm_not_configured";
  constructor(detail?: string) {
    super(`LLM not configured: ${detail ?? "provider env vars missing"}`);
    this.name = "LLMNotConfiguredError";
  }
}
```

Then remove duplicated type/error definitions from `gemini.ts` and import them from `./provider`.

- [x] **Step 2: Implement compatible API provider**

Create `apps/api/src/lib/llm/openai-compatible.ts` with:

```ts
import { LLMNotConfiguredError, type ChatMsg, type LLMProvider, type StreamChunk, type Usage } from "./provider";

export function normalizeOpenAICompatibleBaseUrl(raw: string): string {
  const base = raw.replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function headers(apiKey?: string): HeadersInit {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

export function getOpenAICompatibleProvider(): LLMProvider {
  const baseRaw = process.env.OPENAI_COMPAT_BASE_URL;
  const chatModel = process.env.OPENAI_COMPAT_CHAT_MODEL;
  if (!baseRaw || !chatModel) {
    throw new LLMNotConfiguredError("OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_CHAT_MODEL are required");
  }
  const baseUrl = normalizeOpenAICompatibleBaseUrl(baseRaw);
  const apiKey = process.env.OPENAI_COMPAT_API_KEY;
  const embedModel = process.env.OPENAI_COMPAT_EMBED_MODEL;

  return {
    async embed(text: string): Promise<number[]> {
      if (!embedModel) {
        throw new Error("OPENAI_COMPAT_EMBED_MODEL is required for compatible embeddings");
      }
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({ model: embedModel, input: text }),
      });
      if (!res.ok) throw new Error(`OpenAI-compatible embedding failed: HTTP ${res.status}`);
      const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
      const values = data.data?.[0]?.embedding;
      if (!values) throw new Error("OpenAI-compatible endpoint returned no embedding");
      return values;
    },
    async *streamGenerate(opts): AsyncGenerator<StreamChunk> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(apiKey),
        signal: opts.signal,
        body: JSON.stringify({
          model: chatModel,
          messages: opts.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(opts.maxOutputTokens ? { max_tokens: opts.maxOutputTokens } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        }),
      });
      if (!res.ok) throw new Error(`OpenAI-compatible chat failed: HTTP ${res.status}`);
      if (!res.body) throw new Error("OpenAI-compatible stream returned no body");

      let usage: Usage | null = null;
      for await (const chunk of parseOpenAICompatibleSse(res.body, chatModel, opts.signal)) {
        if ("usage" in chunk) usage = chunk.usage;
        yield chunk;
      }
      if (!opts.signal?.aborted && !usage) {
        yield { usage: { tokensIn: 0, tokensOut: 0, model: chatModel } };
      }
    },
  };
}

async function* parseOpenAICompatibleSse(
  body: ReadableStream<Uint8Array>,
  model: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLines = frame.split("\n").filter((line) => line.startsWith("data:"));
        for (const line of dataLines) {
          const raw = line.slice("data:".length).trim();
          if (!raw || raw === "[DONE]") continue;
          const parsed = JSON.parse(raw) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { delta };
          if (parsed.usage) {
            yield {
              usage: {
                tokensIn: parsed.usage.prompt_tokens ?? 0,
                tokensOut: parsed.usage.completion_tokens ?? 0,
                model,
              },
            };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [x] **Step 3: Add API provider factory**

Create `apps/api/src/lib/llm/index.ts`:

```ts
import { getGeminiProvider } from "./gemini";
import { getOpenAICompatibleProvider } from "./openai-compatible";
import type { LLMProvider } from "./provider";

export function getChatProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  if (provider === "gemini") return getGeminiProvider();
  if (provider === "openai_compatible") return getOpenAICompatibleProvider();
  if (provider === "ollama") {
    throw new Error("API chat does not use native Ollama; set LLM_PROVIDER=openai_compatible and point OPENAI_COMPAT_BASE_URL at Ollama /v1");
  }
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}
```

Modify `apps/api/src/lib/chat-llm.ts` imports:

```ts
import { getChatProvider } from "./llm";
import type { ChatMsg, LLMProvider, Usage } from "./llm/provider";
```

Then use `opts.provider ?? getChatProvider()`.

- [x] **Step 4: Verify API tests pass**

Run:

```bash
pnpm --filter @opencairn/api test -- tests/lib/llm-openai-compatible.test.ts tests/lib/llm-gemini.test.ts tests/lib/chat-llm.test.ts
```

Expected: PASS.

## Task 5: Env Docs And Final Verification

**Files:**
- Modify: `.env.example`
- Modify: `docs/superpowers/plans/2026-05-03-openai-compatible-provider.md`

- [x] **Step 1: Update `.env.example`**

Change the LLM block to mention:

```text
# packages/llm factory and API chat provider read LLM_PROVIDER.
# Supported: "gemini" | "ollama" | "openai_compatible".
# API chat supports "gemini" and "openai_compatible"; for Ollama API chat,
# point openai_compatible at Ollama's /v1 endpoint.
LLM_PROVIDER=gemini

# OpenAI-compatible endpoint layer (vLLM, LiteLLM, Ollama /v1, LM Studio,
# OpenRouter, internal gateways). OPENAI_COMPAT_BASE_URL may include or omit
# the /v1 suffix; OpenCairn normalizes it.
# OPENAI_COMPAT_BASE_URL=http://localhost:8000/v1
# OPENAI_COMPAT_API_KEY=
# OPENAI_COMPAT_CHAT_MODEL=
# OPENAI_COMPAT_EMBED_MODEL=
# OPENAI_COMPAT_RERANK_MODEL=
# OPENAI_COMPAT_VISION_MODEL=
```

- [x] **Step 2: Run focused verification**

Run:

```bash
pnpm --dir packages/llm exec pytest tests/test_openai_compatible.py tests/test_factory.py -q
pnpm --filter @opencairn/api test -- tests/lib/llm-openai-compatible.test.ts tests/lib/llm-gemini.test.ts tests/lib/chat-llm.test.ts
pnpm --filter @opencairn/api exec tsc --noEmit
git diff --check
```

Expected: all pass. If API `tsc` hits unrelated pre-existing errors, capture exact files and keep focused tests green.

- [x] **Step 3: Self-review**

Check:

- No `OPENAI_API_KEY` primary variable was introduced.
- No API route accepts a user-submitted base URL.
- No API key appears in logs or errors.
- Gemini imports and native capabilities remain in `gemini.ts`/`GeminiProvider`.
- Native Python Ollama remains selected by `LLM_PROVIDER=ollama`.
- API chat `AbortSignal` is passed into compatible `fetch`.
- `/v1` suffix is normalized in both Python and TypeScript.

- [x] **Step 4: Commit and publish**

Use one logical commit:

```bash
git add packages/llm/src/llm packages/llm/tests apps/api/src/lib/llm apps/api/src/lib/chat-llm.ts apps/api/tests/lib .env.example docs/superpowers/plans/2026-05-03-openai-compatible-provider.md
git commit -m "feat(llm): add openai-compatible provider"
git push -u origin codex/openai-compatible-provider
```

Open a draft PR against `main` with a body that includes summary, verification, and notes that merge should be user-owned.
