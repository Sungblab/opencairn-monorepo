import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getOpenAICompatibleProvider,
  normalizeOpenAICompatibleBaseUrl,
} from "../../src/lib/llm/openai-compatible.js";
import { LLMNotConfiguredError, type StreamChunk } from "../../src/lib/llm/provider.js";

const originalBaseUrl = process.env.OPENAI_COMPAT_BASE_URL;
const originalApiKey = process.env.OPENAI_COMPAT_API_KEY;
const originalChatModel = process.env.OPENAI_COMPAT_CHAT_MODEL;
const originalEmbedModel = process.env.OPENAI_COMPAT_EMBED_MODEL;

function restoreEnv() {
  restore("OPENAI_COMPAT_BASE_URL", originalBaseUrl);
  restore("OPENAI_COMPAT_API_KEY", originalApiKey);
  restore("OPENAI_COMPAT_CHAT_MODEL", originalChatModel);
  restore("OPENAI_COMPAT_EMBED_MODEL", originalEmbedModel);
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  process.env.OPENAI_COMPAT_BASE_URL = "http://localhost:8000";
  process.env.OPENAI_COMPAT_API_KEY = "test-key";
  process.env.OPENAI_COMPAT_CHAT_MODEL = "qwen";
  process.env.OPENAI_COMPAT_EMBED_MODEL = "embed";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("normalizeOpenAICompatibleBaseUrl", () => {
  it("appends /v1 when omitted", () => {
    expect(normalizeOpenAICompatibleBaseUrl("http://localhost:8000")).toBe(
      "http://localhost:8000/v1",
    );
    expect(normalizeOpenAICompatibleBaseUrl("http://localhost:8000/v1")).toBe(
      "http://localhost:8000/v1",
    );
  });
});

describe("getOpenAICompatibleProvider", () => {
  it("throws typed not-configured error without base URL or chat model", () => {
    delete process.env.OPENAI_COMPAT_BASE_URL;
    expect(() => getOpenAICompatibleProvider()).toThrowError(LLMNotConfiguredError);
  });

  it("streams SSE deltas and usage with AbortSignal", async () => {
    const controller = new AbortController();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const body = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          ),
        );
        ctrl.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":" world"}}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
          ),
        );
        ctrl.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return new Response(body, { status: 200 });
      }),
    );

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

  it("emits fallback usage when stream has no usage frame", async () => {
    const body = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
          ),
        );
        ctrl.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    const provider = getOpenAICompatibleProvider();
    const out: StreamChunk[] = [];
    for await (const chunk of provider.streamGenerate({
      messages: [{ role: "user", content: "hi" }],
    })) {
      out.push(chunk);
    }

    expect(out).toEqual([
      { delta: "ok" },
      { usage: { tokensIn: 0, tokensOut: 0, model: "qwen" } },
    ]);
  });

  it("grounds latest-answer requests through the Responses web_search tool", async () => {
    process.env.OPENAI_COMPAT_BASE_URL = "https://api.openai.com/v1";
    process.env.OPENAI_COMPAT_CHAT_MODEL = "gpt-5";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return new Response(
          JSON.stringify({
            output_text: "Latest answer with a citation.",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "Latest answer with a citation.",
                    annotations: [
                      {
                        type: "url_citation",
                        url: "https://example.com/report",
                        title: "Example report",
                      },
                    ],
                  },
                ],
              },
            ],
            usage: { input_tokens: 12, output_tokens: 8 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const provider = getOpenAICompatibleProvider();
    await expect(
      provider.groundSearch?.("latest report?", {
        maxOutputTokens: 256,
        signal: AbortSignal.timeout(1000),
      }),
    ).resolves.toEqual({
      answer: "Latest answer with a citation.",
      sources: [
        {
          title: "Example report",
          url: "https://example.com/report",
        },
      ],
      usage: { tokensIn: 12, tokensOut: 8, model: "gpt-5" },
    });

    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: "gpt-5",
      input: "latest report?",
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      max_output_tokens: 256,
    });
  });

  it("returns null when a compatible endpoint does not support Responses web search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );

    const provider = getOpenAICompatibleProvider();

    await expect(provider.groundSearch?.("latest?")).resolves.toBeNull();
  });

  it("skips malformed SSE data frames and continues streaming", async () => {
    const body = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode("data: {not-json}\n\n"));
        ctrl.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
          ),
        );
        ctrl.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    const provider = getOpenAICompatibleProvider();
    const out: StreamChunk[] = [];
    for await (const chunk of provider.streamGenerate({
      messages: [{ role: "user", content: "hi" }],
    })) {
      out.push(chunk);
    }

    expect(out).toEqual([
      { delta: "ok" },
      { usage: { tokensIn: 0, tokensOut: 0, model: "qwen" } },
    ]);
  });

  it("parses CRLF-delimited SSE frames", async () => {
    const body = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\n',
          ),
        );
        ctrl.enqueue(new TextEncoder().encode("data: [DONE]\r\n\r\n"));
        ctrl.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    const provider = getOpenAICompatibleProvider();
    const out: StreamChunk[] = [];
    for await (const chunk of provider.streamGenerate({
      messages: [{ role: "user", content: "hi" }],
    })) {
      out.push(chunk);
    }

    expect(out).toEqual([
      { delta: "ok" },
      { usage: { tokensIn: 0, tokensOut: 0, model: "qwen" } },
    ]);
  });

  it("does not expose raw HTTP status codes for chat failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));

    const provider = getOpenAICompatibleProvider();
    await expect(async () => {
      for await (const _chunk of provider.streamGenerate({
        messages: [{ role: "user", content: "hi" }],
      })) {
        // drain
      }
    }).rejects.toThrow(
      "OpenAI-compatible chat failed. Please check your configuration or try again later.",
    );
  });

  it("embeds text through compatible embeddings endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push({ url: String(url), init: init as RequestInit });
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const provider = getOpenAICompatibleProvider();
    await expect(provider.embed("hello")).resolves.toEqual([0.1, 0.2]);
    expect(calls[0].url).toBe("http://localhost:8000/v1/embeddings");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "embed",
      input: "hello",
    });
  });

  it("does not expose raw HTTP status codes for embedding failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));

    const provider = getOpenAICompatibleProvider();
    await expect(provider.embed("hello")).rejects.toThrow(
      "OpenAI-compatible embedding failed. Please check your configuration or try again later.",
    );
  });

  it("throws a clear error when embeddings are not configured", async () => {
    delete process.env.OPENAI_COMPAT_EMBED_MODEL;
    const provider = getOpenAICompatibleProvider();
    await expect(provider.embed("hello")).rejects.toThrow(/OPENAI_COMPAT_EMBED_MODEL/);
  });
});
