import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/chat-retrieval", () => ({
  retrieve: vi.fn(),
}));

const { runChat } = await import("../../src/lib/chat-llm.js");
const retrievalMod = (await import("../../src/lib/chat-retrieval.js")) as unknown as {
  retrieve: ReturnType<typeof vi.fn>;
};

const fakeProvider = {
  embed: vi.fn(),
  streamGenerate: vi.fn(),
};

beforeEach(() => {
  retrievalMod.retrieve.mockReset();
  fakeProvider.embed.mockReset();
  fakeProvider.streamGenerate.mockReset();
});

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("runChat happy path", () => {
  it("emits status → citation → text → usage → done in order", async () => {
    retrievalMod.retrieve.mockResolvedValue([
      {
        noteId: "n1",
        chunkId: "c1",
        title: "alpha",
        headingPath: "Intro",
        snippet: "first hit",
        score: 0.9,
        provenance: "extracted",
        confidence: 0.9,
        evidenceId: "chunk:c1",
        sourceSpan: { start: 0, end: 9, locator: "p.1" },
      },
    ]);
    let receivedMessages: unknown[] = [];
    fakeProvider.streamGenerate.mockImplementation(async function* (opts: {
      messages: unknown[];
    }) {
      receivedMessages = opts.messages;
      yield { delta: "Hello" };
      yield { delta: " world" };
      yield { usage: { tokensIn: 30, tokensOut: 7, model: "gemini-2.5-flash" } };
    });

    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("status");
    expect(types).toContain("citation");
    const texts = events.filter((e) => e.type === "text");
    expect(texts.map((e) => (e.payload as { delta: string }).delta).join("")).toBe(
      "Hello world",
    );
    const usage = events.find((e) => e.type === "usage");
    expect(usage?.payload).toMatchObject({ tokensIn: 30, tokensOut: 7 });
    expect(types[types.length - 1]).toBe("done");
    // Thought sits between citation and text deltas.
    expect(types.indexOf("thought")).toBeGreaterThan(types.indexOf("citation"));
    expect(types.indexOf("thought")).toBeLessThan(types.indexOf("text"));
    const systemPrompt = (receivedMessages[0] as { content: string }).content;
    expect(systemPrompt).toContain("<context>");
    expect(systemPrompt).toContain("[1] alpha · Intro");
    expect(systemPrompt).toContain("evidenceId=chunk:c1");
    expect(systemPrompt).toContain("provenance=extracted");
    expect(systemPrompt).toContain("span=p.1:0-9");
  });

  it("ragMode=off skips retrieval and emits zero citations", async () => {
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "ok" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" } };
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "off",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    expect(events.find((e) => e.type === "citation")).toBeUndefined();
    expect(retrievalMod.retrieve).not.toHaveBeenCalled();
  });

  it("injects runtime current time into the system message", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);
    let receivedMessages: unknown[] = [];
    fakeProvider.streamGenerate.mockImplementation(async function* (opts: {
      messages: unknown[];
    }) {
      receivedMessages = opts.messages;
      yield { delta: "ok" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" } };
    });

    await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "off",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
        mode: "balanced",
        now: new Date("2026-04-30T00:00:00.000Z"),
      }),
    );

    expect((receivedMessages[0] as { content: string }).content).toContain(
      "Current server time: 2026-04-30T00:00:00.000Z",
    );
  });

  it("passes selected thinkingLevel to the provider", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);
    let thinkingLevel: unknown;
    fakeProvider.streamGenerate.mockImplementation(async function* (opts: {
      thinkingLevel?: unknown;
    }) {
      thinkingLevel = opts.thinkingLevel;
      yield { delta: "ok" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" } };
    });

    await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "off",
        chips: [],
        history: [],
        userMessage: "정확하게 분석해줘",
        provider: fakeProvider,
        mode: "accurate",
      }),
    );

    expect(thinkingLevel).toBe("high");
  });

  it("blocks freshness-required answers when no grounding source is available", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "This should not be generated" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" } };
    });

    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "off",
        chips: [],
        history: [],
        userMessage: "오늘 OpenAI CEO가 누구야?",
        provider: fakeProvider,
        mode: "auto",
        now: new Date("2026-04-30T00:00:00.000Z"),
      }),
    );

    expect(fakeProvider.streamGenerate).not.toHaveBeenCalled();
    const errorEvt = events.find((e) => e.type === "error");
    expect(errorEvt?.payload).toMatchObject({
      code: "grounding_required",
      messageKey: "chat.errors.groundingRequired",
    });
    expect(events[events.length - 1].type).toBe("done");
  });

  it("localizes the grounding guard fallback message", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);

    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "off",
        chips: [],
        history: [],
        userMessage: "latest OpenAI CEO?",
        provider: fakeProvider,
        mode: "auto",
        locale: "en",
      }),
    );

    const errorEvt = events.find((e) => e.type === "error");
    expect(errorEvt?.payload).toMatchObject({
      code: "grounding_required",
      messageKey: "chat.errors.groundingRequired",
      message:
        "This question needs current verified sources, but no grounding source is connected. No answer was generated.",
    });
  });

  it("soft-warns when a grounded answer omits sentence citations", async () => {
    retrievalMod.retrieve.mockResolvedValue([
      {
        noteId: "n1",
        chunkId: "c1",
        title: "Alpha policy",
        headingPath: "Grounding",
        snippet: "Alpha policy requires runtime answer verification.",
        score: 0.9,
        provenance: "extracted",
        confidence: 0.9,
        evidenceId: "chunk:c1",
      },
    ]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "Alpha policy requires runtime answer verification." };
      yield { usage: { tokensIn: 30, tokensOut: 7, model: "gemini-2.5-flash" } };
    });

    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "what is the alpha policy?",
        provider: fakeProvider,
      }),
    );

    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    const verification = events.find((e) => e.type === "verification");
    expect(verification?.payload).toMatchObject({
      verdict: "fail",
      action: "warn",
      findings: [{ reason: "missing_citation" }],
    });
  });
});

describe("runChat save_suggestion", () => {
  it("emits save_suggestion when LLM appends a fence", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "Here is the answer.\n\n```save-suggestion\n" };
      yield { delta: '{"title": "Test", "body_markdown": "Body"}\n```\n' };
      yield { usage: { tokensIn: 5, tokensOut: 3, model: "gemini-2.5-flash" } };
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    const sugg = events.find((e) => e.type === "save_suggestion");
    expect(sugg?.payload).toEqual({ title: "Test", body_markdown: "Body" });
    const types = events.map((e) => e.type);
    expect(types.indexOf("save_suggestion")).toBeLessThan(types.indexOf("usage"));
  });

  it("does NOT emit save_suggestion on malformed fence", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "```save-suggestion\n{not json}\n```" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" } };
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    expect(events.find((e) => e.type === "save_suggestion")).toBeUndefined();
  });
});

describe("runChat history truncation", () => {
  it("drops oldest turns when over CHAT_MAX_INPUT_TOKENS", async () => {
    process.env.CHAT_MAX_INPUT_TOKENS = "100";
    process.env.CHAT_MAX_HISTORY_TURNS = "100";
    retrievalMod.retrieve.mockResolvedValue([]);
    let receivedMessages: unknown[] = [];
    fakeProvider.streamGenerate.mockImplementation(async function* (opts: {
      messages: unknown[];
    }) {
      receivedMessages = opts.messages;
      yield { delta: "ok" };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" } };
    });

    const big = "x".repeat(500);
    const history = [
      { role: "user" as const, content: big },
      { role: "assistant" as const, content: big },
      { role: "user" as const, content: "recent" },
    ];

    await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history,
        userMessage: "followup",
        provider: fakeProvider,
      }),
    );
    const userTexts = (receivedMessages as { role: string; content: string }[])
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(userTexts).toContain("followup");
    expect(userTexts.some((t) => t === big)).toBe(false);

    delete process.env.CHAT_MAX_INPUT_TOKENS;
    delete process.env.CHAT_MAX_HISTORY_TURNS;
  });
});

describe("runChat error contract", () => {
  it("yields error+done when retrieve() rejects", async () => {
    retrievalMod.retrieve.mockRejectedValue(new Error("retrieve boom"));
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "should not reach" };
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    const types = events.map((e) => e.type);
    expect(fakeProvider.streamGenerate).not.toHaveBeenCalled();
    expect(types[types.length - 1]).toBe("done");
    const errorEvt = events.find((e) => e.type === "error");
    expect(errorEvt).toBeDefined();
    expect((errorEvt!.payload as { message: string }).message).toBe("retrieve boom");
    expect(events.find((e) => e.type === "text")).toBeUndefined();
  });

  it("yields error+done when streamGenerate throws mid-stream", async () => {
    retrievalMod.retrieve.mockResolvedValue([]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "partial" };
      throw new Error("stream boom");
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "strict",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
      }),
    );
    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe("done");
    expect(types).toContain("error");
    expect(types).toContain("text"); // partial delta was yielded before throw
    const errorEvt = events.find((e) => e.type === "error");
    expect((errorEvt!.payload as { message: string }).message).toBe("stream boom");
    // error must come after the partial text and before done.
    expect(types.indexOf("error")).toBeGreaterThan(types.indexOf("text"));
    expect(types.indexOf("error")).toBeLessThan(types.indexOf("done"));
  });

  it("aborting before LLM stream skips streamGenerate and ends in error+done", async () => {
    retrievalMod.retrieve.mockImplementation(async () => {
      return [];
    });
    const controller = new AbortController();
    controller.abort(); // pre-aborted
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "should not see this" };
    });
    const events = await collect(
      runChat({
        workspaceId: "ws-1",
        scope: { type: "workspace", workspaceId: "ws-1" },
        ragMode: "off",
        chips: [],
        history: [],
        userMessage: "hi",
        provider: fakeProvider,
        signal: controller.signal,
      }),
    );
    expect(fakeProvider.streamGenerate).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "text")).toBeUndefined();
    expect(events[events.length - 1].type).toBe("done");
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});
