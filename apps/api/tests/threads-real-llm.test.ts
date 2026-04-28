import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { createApp } from "../src/app.js";
import { db, chatMessages, eq, asc } from "@opencairn/db";
import { __setRunAgentForTest } from "../src/routes/threads.js";
import type { AgentChunk } from "../src/lib/agent-pipeline.js";
import { runChat } from "../src/lib/chat-llm.js";
import type { LLMProvider } from "../src/lib/llm/gemini.js";
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

async function createThread(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const res = await authedFetch("/api/threads", {
    method: "POST",
    userId,
    body: JSON.stringify({ workspace_id: workspaceId, title: "real-llm test" }),
  });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return id;
}

// Build a fake LLMProvider with stubbable streamGenerate. embed() returns a
// 768d zero vector so the strict-RAG path's query embedding lookup doesn't
// hit the real Gemini API; with no notes seeded the retrieval falls through
// to an empty hit list anyway.
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

describe("POST /api/threads/:id/messages — real LLM path (Task 7)", () => {
  let ctx: SeedResult;
  let fakeProvider: ReturnType<typeof buildFakeProvider>;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    fakeProvider = buildFakeProvider();

    // Inject a runAgent that uses the real runChat with the fake provider.
    // chat-retrieval.retrieve() also calls getGeminiProvider() for the
    // query embedding — we sidestep that by setting ragMode "off" so no
    // retrieval call happens (Phase 4 has no chips/scope UI, so this is
    // the production-effective default for an empty thread anyway).
    __setRunAgentForTest(async function* (opts) {
      // Resolve workspace inline — no helper, matches plan note.
      const { db: dbInst, chatThreads, eq: eqOp } = await import("@opencairn/db");
      const [thread] = await dbInst
        .select({ workspaceId: chatThreads.workspaceId })
        .from(chatThreads)
        .where(eqOp(chatThreads.id, opts.threadId));
      if (!thread) throw new Error("thread not found");

      for await (const c of runChat({
        workspaceId: thread.workspaceId,
        scope: { type: "workspace", workspaceId: thread.workspaceId },
        ragMode: "off",
        chips: [],
        history: [],
        userMessage: opts.userMessage.content,
        // Forward the route's request abort signal so the abort-mid-stream
        // test can observe propagation into the provider fetch.
        signal: opts.signal,
        provider: fakeProvider,
      })) {
        yield { type: c.type, payload: c.payload } as AgentChunk;
      }
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
    __setRunAgentForTest(null);
  });

  afterAll(() => {
    __setRunAgentForTest(null);
  });

  it("emits text deltas and persists token_usage + provider", async () => {
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "real" };
      yield { delta: " answer" };
      yield {
        usage: { tokensIn: 22, tokensOut: 6, model: "gemini-2.5-flash" },
      };
    });

    const threadId = await createThread(ctx.workspaceId, ctx.userId);

    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "hi", mode: "auto" }),
    });
    expect(res.status).toBe(200);

    const text = await res.text();
    const events = parseSseEvents(text);

    // Text deltas — exact strings from the fake provider.
    const textDeltas = events
      .filter((e) => e.event === "text")
      .map((e) => (e.data as { delta: string }).delta);
    expect(textDeltas).toEqual(["real", " answer"]);

    // Status / thought / usage / done frames are present.
    expect(events.find((e) => e.event === "status")).toBeDefined();
    expect(events.find((e) => e.event === "thought")).toBeDefined();
    expect(events.find((e) => e.event === "usage")).toBeDefined();
    expect(events.find((e) => e.event === "done")).toBeDefined();

    // chat_messages: agent row has token_usage with provider tokens + cost.
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.role).toBe("user");
    expect(rows[1]!.role).toBe("agent");
    expect(rows[1]!.status).toBe("complete");
    expect(rows[1]!.provider).toBe("gemini");

    const tokenUsage = rows[1]!.tokenUsage as {
      tokensIn: number;
      tokensOut: number;
      model: string;
      costKrw: number;
    } | null;
    expect(tokenUsage).toMatchObject({
      tokensIn: 22,
      tokensOut: 6,
      model: "gemini-2.5-flash",
    });
    expect(typeof tokenUsage!.costKrw).toBe("number");
    expect(tokenUsage!.costKrw).toBeGreaterThanOrEqual(0);

    // Persisted body matches the joined deltas. usage is stripped from
    // content (lives in token_usage column).
    expect(rows[1]!.content).toMatchObject({ body: "real answer" });
    expect((rows[1]!.content as Record<string, unknown>).usage).toBeUndefined();
  });

  it("emits exactly one `event: done` frame per stream", async () => {
    // Regression: chat-llm.runChat yields a sentinel `done` in its finally
    // block, and the route emits its own canonical `done` post-persistence.
    // The route now suppresses the chat-llm one — confirm by counting frames.
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "hi" };
      yield {
        usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" },
      };
    });

    const threadId = await createThread(ctx.workspaceId, ctx.userId);
    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "hi", mode: "auto" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();

    // Match `event: done\n` lines exactly — `\n` rules out `event: done_xyz`
    // accidental subname matches (none today, but defensive).
    const doneFrames = text.match(/^event: done$/gm) ?? [];
    expect(doneFrames).toHaveLength(1);

    // The single done frame the client sees is the route's canonical one,
    // carrying the persisted message id + status.
    const events = parseSseEvents(text);
    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    expect((done!.data as { id: string; status: string }).id).toMatch(/.+/);
    expect((done!.data as { id: string; status: string }).status).toBe(
      "complete",
    );
  });

  it("forwards AbortSignal from request → runAgent → provider.streamGenerate", async () => {
    // The route now passes c.req.raw.signal into runAgent, which forwards it
    // to runChat, which forwards it to provider.streamGenerate. We assert
    // the provider's streamGenerate was invoked with a signal — that's the
    // observable contract for "client aborts cancel the in-flight fetch".
    let receivedSignal: AbortSignal | undefined;
    fakeProvider.streamGenerate.mockImplementation(
      async function* (args: { signal?: AbortSignal }) {
        receivedSignal = args.signal;
        yield { delta: "first" };
        yield {
          usage: { tokensIn: 1, tokensOut: 1, model: "gemini-2.5-flash" },
        };
      },
    );

    const threadId = await createThread(ctx.workspaceId, ctx.userId);
    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "signal me", mode: "auto" }),
    });
    expect(res.status).toBe(200);
    await res.text();

    // Provider received an AbortSignal — proves the wiring runs end to end.
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it("persists status='failed' when the provider throws an AbortError mid-stream", async () => {
    // Simulates the production case: the provider fetch is aborted mid-stream
    // (DOMException AbortError) — runChat catches, yields an `error` chunk,
    // and the route flips streamStatus to 'failed' before the finally writes
    // the row. The route also breaks on its own canonical `done`, so only
    // one done frame goes out.
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "first" };
      throw new DOMException("aborted", "AbortError");
    });

    const threadId = await createThread(ctx.workspaceId, ctx.userId);
    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "abort me", mode: "auto" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();

    // First delta made it out; chat-llm wraps the AbortError into an `error`
    // chunk and the route does NOT emit a duplicate `done` from chat-llm.
    expect(text).toContain('event: text\ndata: {"delta":"first"}');
    expect(text).toContain("event: error");
    expect((text.match(/^event: done$/gm) ?? [])).toHaveLength(1);

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt));
    expect(rows[1]!.status).toBe("failed");
    // Only the first delta persisted in the body — the second never yielded.
    expect((rows[1]!.content as { body: string }).body).toBe("first");
  });

  it("persists status='failed' when provider yields an error chunk", async () => {
    // Provider throws mid-stream — runChat's try/catch yields an `error`
    // chunk and a final `done`. The route currently does not flip status
    // to 'failed' on error chunks; if it doesn't, this test will document
    // the remaining gap.
    fakeProvider.streamGenerate.mockImplementation(async function* () {
      yield { delta: "partial" };
      throw new Error("provider blew up");
    });

    const threadId = await createThread(ctx.workspaceId, ctx.userId);

    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "fail me", mode: "auto" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("provider blew up");

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt));
    expect(rows[1]!.status).toBe("failed");
  });
});
