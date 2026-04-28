import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getGeminiProvider,
  LLMNotConfiguredError,
  type Usage,
  type StreamChunk,
} from "../../src/lib/llm/gemini.js";

vi.mock("@google/genai", () => {
  // Hoisted mock — vi.mock factories must be self-contained. We use a class
  // (not vi.fn().mockImplementation) so `new GoogleGenAI(...)` works.
  const fakeEmbed = vi.fn();
  const fakeStream = vi.fn();
  class GoogleGenAI {
    models = {
      embedContent: fakeEmbed,
      generateContentStream: fakeStream,
    };
  }
  return {
    GoogleGenAI,
    __fakeEmbed: fakeEmbed,
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

  it("throws when SDK returns no embedding", async () => {
    fakeEmbed.mockResolvedValue({ embeddings: [] });
    const provider = getGeminiProvider();
    await expect(provider.embed("x")).rejects.toThrow(/embedding/i);
  });

  it("throws when SDK returns wrong-dimension embedding", async () => {
    fakeEmbed.mockResolvedValue({
      embeddings: [{ values: new Array(3072).fill(0.1) }],
    });
    const provider = getGeminiProvider();
    await expect(provider.embed("x")).rejects.toThrow(/3072.*expected 768|expected.*768/i);
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
    expect(usages[0].usage.model).toMatch(/gemini-2\.5-flash/);
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
      model: "gemini-2.5-flash",
    });
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
