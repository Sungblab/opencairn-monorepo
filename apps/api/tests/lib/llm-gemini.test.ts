import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getGeminiProvider,
} from "../../src/lib/llm/gemini.js";
import {
  LLMNotConfiguredError,
  type StreamChunk,
  type Usage,
} from "../../src/lib/llm/provider.js";

vi.mock("@google/genai", () => {
  // Hoisted mock — vi.mock factories must be self-contained. We use a class
  // (not vi.fn().mockImplementation) so `new GoogleGenAI(...)` works.
  const fakeEmbed = vi.fn();
  const fakeStream = vi.fn();
  const fakeGenerate = vi.fn();
  class GoogleGenAI {
    models = {
      embedContent: fakeEmbed,
      generateContent: fakeGenerate,
      generateContentStream: fakeStream,
    };
  }
  return {
    GoogleGenAI,
    ServiceTier: {
      STANDARD: "standard",
      FLEX: "flex",
      PRIORITY: "priority",
    },
    ThinkingLevel: {
      LOW: "LOW",
      MEDIUM: "MEDIUM",
      HIGH: "HIGH",
    },
    __fakeEmbed: fakeEmbed,
    __fakeGenerate: fakeGenerate,
    __fakeStream: fakeStream,
  };
});

// ── File-level env snapshots ─────────────────────────────────────────────
// Captured once at module load so cleanup is symmetric across all describe
// blocks. If a test throws before its inline restore line, the per-block
// afterEach below still runs unconditionally and resets the env.
const originalKey = process.env.GEMINI_API_KEY;
const originalGoogleKey = process.env.GOOGLE_API_KEY;
const originalChatModel = process.env.GEMINI_CHAT_MODEL;
const originalGeminiEmbedModel = process.env.GEMINI_EMBED_MODEL;
const originalEmbedModel = process.env.EMBED_MODEL;
const originalVectorDim = process.env.VECTOR_DIM;
const originalGeminiServiceTier = process.env.GEMINI_SERVICE_TIER;
const originalGeminiChatServiceTier = process.env.GEMINI_CHAT_SERVICE_TIER;

function restoreEnv() {
  if (originalKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalKey;
  }
  if (originalGoogleKey === undefined) {
    delete process.env.GOOGLE_API_KEY;
  } else {
    process.env.GOOGLE_API_KEY = originalGoogleKey;
  }
  if (originalChatModel === undefined) {
    delete process.env.GEMINI_CHAT_MODEL;
  } else {
    process.env.GEMINI_CHAT_MODEL = originalChatModel;
  }
  if (originalGeminiEmbedModel === undefined) {
    delete process.env.GEMINI_EMBED_MODEL;
  } else {
    process.env.GEMINI_EMBED_MODEL = originalGeminiEmbedModel;
  }
  if (originalEmbedModel === undefined) {
    delete process.env.EMBED_MODEL;
  } else {
    process.env.EMBED_MODEL = originalEmbedModel;
  }
  if (originalVectorDim === undefined) {
    delete process.env.VECTOR_DIM;
  } else {
    process.env.VECTOR_DIM = originalVectorDim;
  }
  if (originalGeminiServiceTier === undefined) {
    delete process.env.GEMINI_SERVICE_TIER;
  } else {
    process.env.GEMINI_SERVICE_TIER = originalGeminiServiceTier;
  }
  if (originalGeminiChatServiceTier === undefined) {
    delete process.env.GEMINI_CHAT_SERVICE_TIER;
  } else {
    process.env.GEMINI_CHAT_SERVICE_TIER = originalGeminiChatServiceTier;
  }
}

describe("getGeminiProvider", () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });
  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("throws LLMNotConfiguredError when no key is set", () => {
    expect(() => getGeminiProvider()).toThrowError(LLMNotConfiguredError);
  });

  it("falls back to GOOGLE_API_KEY when GEMINI_API_KEY missing", () => {
    process.env.GOOGLE_API_KEY = "AI" + "za-test-fallback";
    expect(() => getGeminiProvider()).not.toThrow();
  });

  it("LLMNotConfiguredError has code llm_not_configured", () => {
    try {
      getGeminiProvider();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMNotConfiguredError);
      expect((e as LLMNotConfiguredError).code).toBe("llm_not_configured");
    }
  });

  it("rejects invalid Gemini service tier env", () => {
    process.env.GEMINI_API_KEY = "AI" + "za-test-tier";
    process.env.GEMINI_SERVICE_TIER = "fastest";
    expect(() => getGeminiProvider()).toThrowError(/Invalid Gemini service tier/);
  });
});

describe("GeminiProvider.embed", () => {
  let fakeEmbed: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    process.env.GEMINI_API_KEY = "AI" + "za-test-embed";
    const mod = (await import("@google/genai")) as unknown as {
      __fakeEmbed: ReturnType<typeof vi.fn>;
    };
    fakeEmbed = mod.__fakeEmbed;
    fakeEmbed.mockReset();
  });
  afterEach(() => {
    restoreEnv();
  });

  it("calls embedContent with gemini-embedding-001 + RETRIEVAL_QUERY + 768d", async () => {
    delete process.env.VECTOR_DIM;
    delete process.env.GEMINI_EMBED_MODEL;
    delete process.env.EMBED_MODEL;
    fakeEmbed.mockResolvedValue({
      embeddings: [{ values: new Array(768).fill(0.1) }],
    });
    const provider = getGeminiProvider();
    const out = await provider.embed("hello world");
    expect(out).toHaveLength(768);
    expect(fakeEmbed).toHaveBeenCalledWith({
      model: "gemini-embedding-001",
      contents: [{ parts: [{ text: "hello world" }] }],
      config: {
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
      },
    });
  });

  it("honors VECTOR_DIM for Gemini embedding truncation", async () => {
    process.env.VECTOR_DIM = "1024";
    delete process.env.GEMINI_EMBED_MODEL;
    delete process.env.EMBED_MODEL;
    fakeEmbed.mockResolvedValue({
      embeddings: [{ values: new Array(1024).fill(0.1) }],
    });
    const provider = getGeminiProvider();
    const out = await provider.embed("hello world");
    expect(out).toHaveLength(1024);
    expect(fakeEmbed).toHaveBeenCalledWith({
      model: "gemini-embedding-001",
      contents: [{ parts: [{ text: "hello world" }] }],
      config: {
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 1024,
      },
    });
  });

  it("throws when SDK returns no embedding", async () => {
    fakeEmbed.mockResolvedValue({ embeddings: [] });
    const provider = getGeminiProvider();
    await expect(provider.embed("x")).rejects.toThrow(/embedding/i);
  });

  it("throws when SDK returns wrong-dimension embedding", async () => {
    fakeEmbed.mockResolvedValue({
      embeddings: [{ values: new Array(3072).fill(0.1) }],
    });
    delete process.env.VECTOR_DIM;
    const provider = getGeminiProvider();
    await expect(provider.embed("x")).rejects.toThrow(/3072.*expected 768|expected.*768/i);
  });

  it("honors GEMINI_EMBED_MODEL then EMBED_MODEL env overrides", async () => {
    process.env.GEMINI_EMBED_MODEL = "gemini-embedding-001";
    process.env.EMBED_MODEL = "ignored-by-gemini-specific-override";
    fakeEmbed.mockResolvedValue({
      embeddings: [{ values: new Array(768).fill(0.1) }],
    });
    const provider = getGeminiProvider();
    await provider.embed("hello world");
    expect(fakeEmbed).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-embedding-001",
    }));
  });

  it("uses Gemini Embedding 2 task prefix instead of taskType when configured", async () => {
    process.env.GEMINI_EMBED_MODEL = "gemini-embedding-2";
    process.env.VECTOR_DIM = "1536";
    fakeEmbed.mockResolvedValue({
      embeddings: [{ values: new Array(1536).fill(0.1) }],
    });
    const provider = getGeminiProvider();
    const out = await provider.embed("search this");
    expect(out).toHaveLength(1536);
    expect(fakeEmbed).toHaveBeenCalledWith({
      model: "gemini-embedding-2",
      contents: [{ parts: [{ text: "task: search result | query: search this" }] }],
      config: {
        outputDimensionality: 1536,
      },
    });
  });
});

describe("GeminiProvider.groundSearch", () => {
  let fakeGenerate: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    process.env.GEMINI_API_KEY = "AI" + "za-test-ground";
    const mod = (await import("@google/genai")) as unknown as {
      __fakeGenerate: ReturnType<typeof vi.fn>;
    };
    fakeGenerate = mod.__fakeGenerate;
    fakeGenerate.mockReset();
  });
  afterEach(() => {
    restoreEnv();
  });

  it("uses Google Search grounding and returns citation metadata", async () => {
    process.env.GEMINI_SERVICE_TIER = "priority";
    fakeGenerate.mockResolvedValue({
      text: "grounded answer",
      candidates: [{
        groundingMetadata: {
          groundingChunks: [{
            web: {
              uri: "https://example.com/source",
              title: "Source",
              domain: "example.com",
            },
          }],
        },
      }],
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 7,
      },
    });

    const provider = getGeminiProvider();
    const result = await provider.groundSearch("latest?", {
      maxOutputTokens: 512,
      thinkingLevel: "low",
      cachedContent: "cachedContents/context-1",
    });

    expect(result).toEqual({
      answer: "grounded answer",
      sources: [{
        title: "Source",
        url: "https://example.com/source",
        snippet: "example.com",
      }],
      usage: {
        tokensIn: 11,
        tokensOut: 7,
        model: "gemini-3-flash-preview",
      },
    });
    expect(fakeGenerate).toHaveBeenCalledWith({
      model: "gemini-3-flash-preview",
      contents: "latest?",
      config: {
        tools: [{ googleSearch: {} }],
        serviceTier: "priority",
        maxOutputTokens: 512,
        thinkingConfig: { thinkingLevel: "LOW" },
        cachedContent: "cachedContents/context-1",
      },
    });
  });
});

describe("GeminiProvider.streamGenerate", () => {
  let fakeStream: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    process.env.GEMINI_API_KEY = "AI" + "za-test-stream";
    const mod = (await import("@google/genai")) as unknown as {
      __fakeStream: ReturnType<typeof vi.fn>;
    };
    fakeStream = mod.__fakeStream;
    fakeStream.mockReset();
  });
  afterEach(() => {
    // Runs unconditionally even if a test throws before its inline restore.
    // This is the symmetric cleanup that prevents GEMINI_CHAT_MODEL (or any
    // key override) from leaking into subsequent tests in the same worker.
    restoreEnv();
  });

  it("yields delta chunks then a single usage chunk", async () => {
    async function* fakeChunks() {
      yield { text: "Hello" };
      yield { text: " world" };
      yield {
        text: "!",
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 5,
          totalTokenCount: 17,
        },
      };
    }
    fakeStream.mockReturnValue(fakeChunks());

    const provider = getGeminiProvider();
    const out: Array<{ delta: string } | { usage: Usage }> = [];
    for await (const chunk of provider.streamGenerate({
      messages: [{ role: "user", content: "hi" }],
    })) {
      out.push(chunk);
    }

    const deltas = out
      .filter((c): c is { delta: string } => "delta" in c)
      .map((c) => c.delta)
      .join("");
    expect(deltas).toBe("Hello world!");

    const usages = out.filter((c): c is { usage: Usage } => "usage" in c);
    expect(usages).toHaveLength(1);
    expect(usages[0].usage).toMatchObject({
      tokensIn: 12,
      tokensOut: 5,
    });
    expect(usages[0].usage.model).toMatch(/gemini-3-flash-preview/);
  });

  it("respects GEMINI_CHAT_MODEL env override", async () => {
    process.env.GEMINI_CHAT_MODEL = "gemini-2.5-pro";
    async function* one() {
      yield { text: "ok", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    }
    fakeStream.mockReturnValue(one());

    const provider = getGeminiProvider();
    const out: StreamChunk[] = [];
    for await (const c of provider.streamGenerate({ messages: [{ role: "user", content: "x" }] })) {
      out.push(c);
    }
    expect(fakeStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.5-pro" }),
    );
    // No inline delete needed — afterEach restoreEnv() handles cleanup
    // unconditionally, so even if assertions above throw, the env is reset.
  });

  it("yields fallback usage chunk when SDK never emits usageMetadata", async () => {
    async function* noUsage() {
      yield { text: "alpha" };
      yield { text: "beta" };
    }
    fakeStream.mockReturnValue(noUsage());

    const provider = getGeminiProvider();
    const out: StreamChunk[] = [];
    for await (const c of provider.streamGenerate({
      messages: [{ role: "user", content: "x" }],
    })) {
      out.push(c);
    }

    const usages = out.filter((c): c is { usage: Usage } => "usage" in c);
    expect(usages).toHaveLength(1);
    expect(usages[0].usage).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      model: "gemini-3-flash-preview",
    });
  });

  it("forwards Gemini 3 thinkingLevel to generateContentStream", async () => {
    async function* one() {
      yield { text: "ok", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    }
    fakeStream.mockReturnValue(one());

    const provider = getGeminiProvider();
    for await (const _ of provider.streamGenerate({
      messages: [{ role: "user", content: "x" }],
      thinkingLevel: "high",
    })) {
      // drain
    }

    expect(fakeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3-flash-preview",
        config: expect.objectContaining({
          thinkingConfig: { thinkingLevel: "HIGH" },
        }),
      }),
    );
  });

  it("forwards Gemini 3 minimal thinkingLevel to generateContentStream", async () => {
    async function* one() {
      yield { text: "ok", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    }
    fakeStream.mockReturnValue(one());

    const provider = getGeminiProvider();
    for await (const _ of provider.streamGenerate({
      messages: [{ role: "user", content: "x" }],
      thinkingLevel: "minimal",
    })) {
      // drain
    }

    expect(fakeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          thinkingConfig: { thinkingLevel: "MINIMAL" },
        }),
      }),
    );
  });

  it("forwards cachedContent when provided by the caller", async () => {
    async function* one() {
      yield { text: "ok", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    }
    fakeStream.mockReturnValue(one());

    const provider = getGeminiProvider();
    for await (const _ of provider.streamGenerate({
      messages: [{ role: "user", content: "x" }],
      cachedContent: "cachedContents/context-123",
    })) {
      // drain
    }

    expect(fakeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          cachedContent: "cachedContents/context-123",
        }),
      }),
    );
  });

  it("forwards Gemini service tier to generateContentStream", async () => {
    process.env.GEMINI_CHAT_SERVICE_TIER = "flex";
    async function* one() {
      yield { text: "ok", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
    }
    fakeStream.mockReturnValue(one());

    const provider = getGeminiProvider();
    for await (const _ of provider.streamGenerate({
      messages: [{ role: "user", content: "x" }],
    })) {
      // drain
    }

    expect(fakeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          serviceTier: "flex",
        }),
      }),
    );
  });

  it("short-circuits on abort mid-stream and emits no further chunks", async () => {
    const controller = new AbortController();
    async function* threeChunks() {
      yield { text: "first" };
      yield { text: "second" };
      yield {
        text: "third",
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 9 },
      };
    }
    fakeStream.mockReturnValue(threeChunks());

    const provider = getGeminiProvider();
    const iter = provider.streamGenerate({
      messages: [{ role: "user", content: "go" }],
      signal: controller.signal,
    });

    const collected: StreamChunk[] = [];
    let firstSeen = false;
    for await (const chunk of iter) {
      collected.push(chunk);
      if (!firstSeen) {
        firstSeen = true;
        controller.abort();
      }
    }

    // Exactly one delta consumed (the first); no further deltas, no usage.
    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual({ delta: "first" });
    expect(
      collected.filter((c): c is { usage: Usage } => "usage" in c),
    ).toHaveLength(0);
  });
});
