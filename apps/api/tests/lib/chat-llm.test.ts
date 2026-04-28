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
      { noteId: "n1", title: "alpha", snippet: "first hit", score: 0.9 },
    ]);
    fakeProvider.streamGenerate.mockImplementation(async function* () {
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
        userMessage: "now",
        provider: fakeProvider,
      }),
    );
    const userTexts = (receivedMessages as { role: string; content: string }[])
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(userTexts).toContain("now");
    expect(userTexts.some((t) => t === big)).toBe(false);

    delete process.env.CHAT_MAX_INPUT_TOKENS;
    delete process.env.CHAT_MAX_HISTORY_TURNS;
  });
});
