import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

// vi.mock must run before the modules under test (chat.ts, chat-llm.ts,
// chat-retrieval.ts) load. Since chat.ts and chat-retrieval both call
// getGeminiProvider() directly, mocking the module catches both code paths
// — runChat's optional `provider` parameter is the route's primary
// injection point, but the retrieval embed() call also resolves through
// this mock.
vi.mock("../src/lib/llm/gemini.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/llm/gemini.js")
  >("../src/lib/llm/gemini.js");
  return {
    ...actual,
    getGeminiProvider: vi.fn(),
  };
});

import { createApp } from "../src/app.js";
import {
  db,
  conversations,
  conversationMessages,
  user,
  eq,
  asc,
} from "@opencairn/db";
import {
  getGeminiProvider,
  LLMNotConfiguredError,
  type ChatMsg,
  type LLMProvider,
} from "../src/lib/llm/gemini.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

interface ParsedEvent {
  event: string;
  data: unknown;
}

function parseSseEvents(text: string): ParsedEvent[] {
  return text
    .split("\n\n")
    .filter((b) => b.trim().length > 0)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? "";
      const dataStr = block.match(/^data: (.+)$/m)?.[1] ?? "null";
      return { event, data: JSON.parse(dataStr) };
    });
}

const FULL_FLAGS = {
  l3_global: true,
  l3_workspace: true,
  l4: true,
  l2: false,
};

function buildFakeProvider(): LLMProvider & {
  streamGenerate: ReturnType<typeof vi.fn>;
} {
  return {
    embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
    streamGenerate: vi.fn(),
  } as unknown as LLMProvider & {
    streamGenerate: ReturnType<typeof vi.fn>;
  };
}

async function createConversation(
  userId: string,
  workspaceId: string,
  scopeId: string,
): Promise<string> {
  const res = await authedFetch("/api/chat/conversations", {
    method: "POST",
    userId,
    body: JSON.stringify({
      workspaceId,
      scopeType: "page",
      scopeId,
      attachedChips: [],
      ragMode: "strict",
      memoryFlags: FULL_FLAGS,
    }),
  });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return id;
}

const mockedGetGeminiProvider = getGeminiProvider as unknown as ReturnType<
  typeof vi.fn
>;

describe("POST /api/chat/message — real LLM path (Task 8)", () => {
  let ctx: SeedResult;
  let fakeProvider: ReturnType<typeof buildFakeProvider>;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    fakeProvider = buildFakeProvider();
    mockedGetGeminiProvider.mockReturnValue(fakeProvider);
  });

  afterEach(async () => {
    await ctx.cleanup();
    mockedGetGeminiProvider.mockReset();
  });

  it("emits real text deltas + cost event and persists provider tokens", async () => {
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "hello " };
      yield { delta: "world" };
      yield {
        usage: { tokensIn: 40, tokensOut: 9, model: "gemini-2.5-flash" },
      };
    });

    const conversationId = await createConversation(
      ctx.userId,
      ctx.workspaceId,
      ctx.noteId,
    );

    const res = await app.request("/api/chat/message", {
      method: "POST",
      headers: {
        cookie: await signSessionCookie(ctx.userId),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ conversationId, content: "hi there" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events = parseSseEvents(text);

    // Text deltas — exact strings from the fake provider.
    const deltas = events
      .filter((e) => e.event === "delta")
      .map((e) => (e.data as { delta: string }).delta);
    expect(deltas).toEqual(["hello ", "world"]);

    // cost frame — assistant row only carries output tokens (spec §4.2).
    const cost = events.find((e) => e.event === "cost");
    expect(cost).toBeDefined();
    const costPayload = cost!.data as {
      messageId: string;
      tokensIn: number;
      tokensOut: number;
      costKrw: number;
    };
    expect(costPayload.tokensIn).toBe(0);
    expect(costPayload.tokensOut).toBe(9);
    expect(typeof costPayload.costKrw).toBe("number");

    // Exactly one done frame — the route's canonical one. runChat yields its
    // own `done` sentinel in finally; the route MUST suppress it.
    expect((text.match(/^event: done$/gm) ?? [])).toHaveLength(1);

    // Persisted rows.
    const rows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.createdAt));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.role).toBe("user");
    expect(rows[0]!.tokensIn).toBe(40);
    expect(rows[0]!.tokensOut).toBe(0);
    expect(rows[1]!.role).toBe("assistant");
    expect(rows[1]!.tokensOut).toBe(9);
    expect(rows[1]!.tokensIn).toBe(0);
    expect(rows[1]!.content).toBe("hello world");
    expect(rows[1]!.citations).toEqual([]);

    // Conversation rollups.
    const [convo] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(convo!.totalTokensIn).toBe(40);
    expect(convo!.totalTokensOut).toBe(9);
    expect(Number(convo!.totalCostKrw)).toBeGreaterThan(0);
  });

  it("forwards AbortSignal from request → runChat → provider.streamGenerate", async () => {
    let receivedSignal: AbortSignal | undefined;
    fakeProvider.streamGenerate.mockImplementation(
      async function* (args: { signal?: AbortSignal }) {
        receivedSignal = args.signal;
        yield { delta: "x" };
        yield {
          usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" },
        };
      },
    );

    const conversationId = await createConversation(
      ctx.userId,
      ctx.workspaceId,
      ctx.noteId,
    );

    const res = await app.request("/api/chat/message", {
      method: "POST",
      headers: {
        cookie: await signSessionCookie(ctx.userId),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ conversationId, content: "signal me" }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it("passes user locale and timezone into runtime context", async () => {
    await db
      .update(user)
      .set({ locale: "en", timezone: "America/Los_Angeles" })
      .where(eq(user.id, ctx.userId));

    let receivedMessages: ChatMsg[] | undefined;
    fakeProvider.streamGenerate.mockImplementation(
      async function* (args: { messages: ChatMsg[] }) {
        receivedMessages = args.messages;
        yield { delta: "ok" };
        yield {
          usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" },
        };
      },
    );

    const conversationId = await createConversation(
      ctx.userId,
      ctx.workspaceId,
      ctx.noteId,
    );

    const res = await app.request("/api/chat/message", {
      method: "POST",
      headers: {
        cookie: await signSessionCookie(ctx.userId),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ conversationId, content: "hello" }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(receivedMessages?.[0]?.content).toContain("User locale: en");
    expect(receivedMessages?.[0]?.content).toContain(
      "User timezone: America/Los_Angeles",
    );
    expect(receivedMessages?.[0]?.content).toContain(
      "User local time:",
    );
  });

  it("emits SSE error event when provider raises LLMNotConfiguredError", async () => {
    mockedGetGeminiProvider.mockImplementation(() => {
      throw new LLMNotConfiguredError();
    });

    const conversationId = await createConversation(
      ctx.userId,
      ctx.workspaceId,
      ctx.noteId,
    );

    const res = await app.request("/api/chat/message", {
      method: "POST",
      headers: {
        cookie: await signSessionCookie(ctx.userId),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ conversationId, content: "hello" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = parseSseEvents(text);

    const err = events.find((e) => e.event === "error");
    expect(err).toBeDefined();
    expect((err!.data as { code: string }).code).toBe("llm_not_configured");

    // The error path emits a single canonical done frame and bails before
    // creating the assistant row.
    expect((text.match(/^event: done$/gm) ?? [])).toHaveLength(1);
    expect(events.find((e) => e.event === "cost")).toBeUndefined();

    // No assistant row was created — only the user row that the handler
    // persists synchronously before opening the stream.
    const rows = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe("user");
  });
});
