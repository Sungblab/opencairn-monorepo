# LLM Provider Surface Parity

This page tracks which LLM provider capabilities are actually shipped across
worker, API, and web surfaces.

| Provider | Worker surface | API surface | Web/product surface |
| --- | --- | --- | --- |
| Gemini | Native `google.genai` provider for chat, embeddings, tool calls, OCR, batch embedding plumbing, context-cache plumbing, and Deep Research Interactions. | Native API chat provider with Gemini streaming and embeddings. | Chat and Deep Research product flows consume API/worker outputs. Deep Research is Gemini-only. |
| `openai_compatible` | Direct `httpx` adapter for `/v1/chat/completions` and `/v1/embeddings`, including OpenAI-style tool calls when the compatible server supports them. | `fetch` adapter for `/v1/chat/completions` streaming and `/v1/embeddings`. | Available only through deployment environment selection. It is not a native OpenAI Responses API provider. |
| Native Ollama | Direct Ollama API provider for `/api/chat`, `/api/embed`, `/api/generate`, and Ollama tool calling with `message.tool_calls` plus `role: tool` / `tool_name` results. | No native Ollama API chat provider. API chat can target Ollama through `openai_compatible` by pointing `OPENAI_COMPAT_BASE_URL` at Ollama's `/v1` endpoint. | No separate web provider surface. |

## Intentionally Not Shipped

- A native OpenAI Responses API provider. `openai_compatible` is only a Chat
  Completions and Embeddings compatibility adapter.
- Native Ollama API chat in `apps/api`; use the OpenAI-compatible adapter for
  API chat against Ollama.
- Deep Research for `openai_compatible` or Ollama providers.
- Product-level Gemini CAG/context-cache lifecycle.
- Default multimodal Gemini Embedding 2.
- Always-on Gemini Batch API embedding. Batch requires explicit flags and input
  thresholds.

## Compatibility Rules

- Provider selection uses `LLM_PROVIDER=gemini | ollama | openai_compatible` in
  worker code. API chat supports `gemini | openai_compatible`.
- Do not introduce a provider named `openai` unless the project ships a native
  OpenAI provider with its own product contract.
- Do not describe `openai_compatible` as the OpenAI Responses API. It is a
  `/v1/chat/completions` and `/v1/embeddings` adapter.
