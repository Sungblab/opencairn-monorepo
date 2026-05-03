import { describe, it, expect, afterEach, vi } from "vitest";
import { db, chatThreads, chatMessages } from "@opencairn/db";
import { runAgent } from "../src/lib/agent-pipeline.js";
import type { ChatMsg, LLMProvider } from "../src/lib/llm/provider.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

// Captures the messages[] passed into provider.streamGenerate so we can
// assert the agent pipeline rebuilt prior turns from chat_messages instead
// of sending an empty history (audit S2-026).
function buildCapturingProvider(): {
  provider: LLMProvider;
  captured: { messages: ChatMsg[] | null; thinkingLevel: unknown };
} {
  const captured: { messages: ChatMsg[] | null; thinkingLevel: unknown } = {
    messages: null,
    thinkingLevel: undefined,
  };
  const provider: LLMProvider = {
    embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
    streamGenerate: vi.fn().mockImplementation(async function* (args: {
      messages: ChatMsg[];
      thinkingLevel?: unknown;
    }) {
      captured.messages = args.messages;
      captured.thinkingLevel = args.thinkingLevel;
      yield { delta: "ok" };
      yield {
        usage: { tokensIn: 1, tokensOut: 1, model: "gemini-3-flash-preview" },
      };
    }) as unknown as LLMProvider["streamGenerate"],
  };
  return { provider, captured };
}

describe("agent-pipeline runAgent — multi-turn history (S2-026)", () => {
  let ctx: SeedResult | null = null;

  afterEach(async () => {
    if (ctx) {
      await ctx.cleanup();
      ctx = null;
    }
  });

  it("loads prior chat_messages and forwards them as history (excluding current turn)", async () => {
    ctx = await seedWorkspace({ role: "owner" });

    const [thread] = await db
      .insert(chatThreads)
      .values({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: "history test",
      })
      .returning({ id: chatThreads.id });

    // Two prior completed turns. Timestamps are spaced so ORDER BY created_at
    // is deterministic — defaultNow() can otherwise collide on fast inserts.
    const t0 = new Date(Date.now() - 4000);
    const t1 = new Date(Date.now() - 3000);
    const t2 = new Date(Date.now() - 2000);
    const t3 = new Date(Date.now() - 1000);
    await db.insert(chatMessages).values([
      {
        threadId: thread.id,
        role: "user",
        status: "complete",
        content: { body: "내 이름은 Alice야" },
        createdAt: t0,
      },
      {
        threadId: thread.id,
        role: "agent",
        status: "complete",
        content: { body: "안녕하세요 Alice님" },
        provider: "gemini",
        createdAt: t1,
      },
      {
        threadId: thread.id,
        role: "user",
        status: "complete",
        content: { body: "오늘 기분이 어때" },
        createdAt: t2,
      },
      {
        threadId: thread.id,
        role: "agent",
        status: "complete",
        content: { body: "좋아요" },
        provider: "gemini",
        createdAt: t3,
      },
    ]);

    // Mimic threads.ts ordering: persist the new user row + streaming agent
    // placeholder BEFORE invoking runAgent. runAgent must exclude both from
    // the history it forwards to runChat.
    const [userRow] = await db
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        role: "user",
        status: "complete",
        content: { body: "내 이름이 뭐였지?" },
      })
      .returning({ id: chatMessages.id });
    const [agentRow] = await db
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        role: "agent",
        status: "streaming",
        content: { body: "" },
        provider: "gemini",
      })
      .returning({ id: chatMessages.id });

    const { provider, captured } = buildCapturingProvider();

    // Drain the generator. ragMode 'off' keeps the test independent of
    // pgvector + the real embed path — we're testing history wiring, not
    // retrieval.
    for await (const _chunk of runAgent({
      threadId: thread.id,
      userMessage: { content: "내 이름이 뭐였지?" },
      mode: "auto",
      excludeMessageIds: [userRow.id, agentRow.id],
      provider,
      ragMode: "off",
    })) {
      // consume
    }

    expect(captured.messages).not.toBeNull();
    const msgs = captured.messages!;
    // Layout: system + 4 history turns + 1 new user = 6 messages.
    expect(msgs[0]!.role).toBe("system");
    expect(msgs.slice(1, 5)).toEqual([
      { role: "user", content: "내 이름은 Alice야" },
      { role: "assistant", content: "안녕하세요 Alice님" },
      { role: "user", content: "오늘 기분이 어때" },
      { role: "assistant", content: "좋아요" },
    ]);
    expect(msgs[msgs.length - 1]).toEqual({
      role: "user",
      content: "내 이름이 뭐였지?",
    });
    expect(captured.thinkingLevel).toBe("medium");
  });

  it("passes accurate mode through as high thinking", async () => {
    ctx = await seedWorkspace({ role: "owner" });

    const [thread] = await db
      .insert(chatThreads)
      .values({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: "mode test",
      })
      .returning({ id: chatThreads.id });

    const { provider, captured } = buildCapturingProvider();

    for await (const _chunk of runAgent({
      threadId: thread.id,
      userMessage: { content: "정확하게 분석해줘" },
      mode: "accurate",
      provider,
      ragMode: "off",
    })) {
      // consume
    }

    expect(captured.thinkingLevel).toBe("high");
  });

  it("respects CHAT_MAX_HISTORY_TURNS by keeping only the most recent N messages", async () => {
    // vi.stubEnv auto-restores in afterEach via vitest's env tracking, which
    // beats manually saving/restoring process.env when tests run concurrently.
    vi.stubEnv("CHAT_MAX_HISTORY_TURNS", "2");
    try {
      ctx = await seedWorkspace({ role: "owner" });

      const [thread] = await db
        .insert(chatThreads)
        .values({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          title: "turn limit test",
        })
        .returning({ id: chatThreads.id });

      // 3 prior turns (6 messages). With CHAT_MAX_HISTORY_TURNS=2, only
      // the last 2 messages should reach the provider.
      const base = Date.now() - 10_000;
      const rows = [
        { role: "user" as const, body: "msg-1" },
        { role: "agent" as const, body: "msg-2" },
        { role: "user" as const, body: "msg-3" },
        { role: "agent" as const, body: "msg-4" },
        { role: "user" as const, body: "msg-5" },
        { role: "agent" as const, body: "msg-6" },
      ];
      await db.insert(chatMessages).values(
        rows.map((r, i) => ({
          threadId: thread.id,
          role: r.role,
          status: "complete" as const,
          content: { body: r.body },
          ...(r.role === "agent" ? { provider: "gemini" } : {}),
          createdAt: new Date(base + i * 100),
        })),
      );

      const [userRow] = await db
        .insert(chatMessages)
        .values({
          threadId: thread.id,
          role: "user",
          status: "complete",
          content: { body: "current" },
        })
        .returning({ id: chatMessages.id });
      const [agentRow] = await db
        .insert(chatMessages)
        .values({
          threadId: thread.id,
          role: "agent",
          status: "streaming",
          content: { body: "" },
          provider: "gemini",
        })
        .returning({ id: chatMessages.id });

      const { provider, captured } = buildCapturingProvider();
      for await (const _ of runAgent({
        threadId: thread.id,
        userMessage: { content: "current" },
        mode: "auto",
        excludeMessageIds: [userRow.id, agentRow.id],
        provider,
        ragMode: "off",
      })) {
        // drain
      }

      const msgs = captured.messages!;
      // Slice off system + final user; the middle is what loadHistory chose.
      const history = msgs.slice(1, -1);
      expect(history).toEqual([
        { role: "user", content: "msg-5" },
        { role: "assistant", content: "msg-6" },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("drops history rows whose content has no string body", async () => {
    ctx = await seedWorkspace({ role: "owner" });
    const [thread] = await db
      .insert(chatThreads)
      .values({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        title: "malformed-body test",
      })
      .returning({ id: chatThreads.id });

    // Mix of well-formed + malformed prior rows. The malformed rows must
    // not reach the provider — they would either crash the prompt build
    // or surface garbage tokens.
    await db.insert(chatMessages).values([
      {
        threadId: thread.id,
        role: "user",
        status: "complete",
        content: { body: "real prompt" },
        createdAt: new Date(Date.now() - 3000),
      },
      {
        threadId: thread.id,
        role: "agent",
        status: "complete",
        content: { not_body: "weird" },
        provider: "gemini",
        createdAt: new Date(Date.now() - 2500),
      },
      {
        threadId: thread.id,
        role: "user",
        status: "complete",
        content: [],
        createdAt: new Date(Date.now() - 2000),
      },
      {
        threadId: thread.id,
        role: "agent",
        status: "complete",
        content: { body: "real reply" },
        provider: "gemini",
        createdAt: new Date(Date.now() - 1500),
      },
    ]);

    const [userRow] = await db
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        role: "user",
        status: "complete",
        content: { body: "now" },
      })
      .returning({ id: chatMessages.id });
    const [agentRow] = await db
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        role: "agent",
        status: "streaming",
        content: { body: "" },
        provider: "gemini",
      })
      .returning({ id: chatMessages.id });

    const { provider, captured } = buildCapturingProvider();
    for await (const _ of runAgent({
      threadId: thread.id,
      userMessage: { content: "now" },
      mode: "auto",
      excludeMessageIds: [userRow.id, agentRow.id],
      provider,
      ragMode: "off",
    })) {
      // drain
    }

    const history = captured.messages!.slice(1, -1);
    expect(history).toEqual([
      { role: "user", content: "real prompt" },
      { role: "assistant", content: "real reply" },
    ]);
  });

  it("does not let malformed rows displace older valid rows when the limit is tight", async () => {
    // Regression for the LIMIT-vs-filter ordering bug: if the malformed
    // filter runs in JS *after* the SQL LIMIT, the newest N rows are
    // pulled first — and if those happen to be malformed, the JS filter
    // returns an empty history even though older valid rows exist. The
    // SQL filter must run first so LIMIT applies to viable rows.
    vi.stubEnv("CHAT_MAX_HISTORY_TURNS", "2");
    try {
      ctx = await seedWorkspace({ role: "owner" });
      const [thread] = await db
        .insert(chatThreads)
        .values({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          title: "limit + filter ordering",
        })
        .returning({ id: chatThreads.id });

      // 2 oldest = valid; 3 newest = malformed. Old (JS-filter) loader
      // would pick the 2 newest, both malformed, return 0 history.
      const base = Date.now() - 10_000;
      await db.insert(chatMessages).values([
        {
          threadId: thread.id,
          role: "user",
          status: "complete",
          content: { body: "old user" },
          createdAt: new Date(base + 0),
        },
        {
          threadId: thread.id,
          role: "agent",
          status: "complete",
          content: { body: "old reply" },
          provider: "gemini",
          createdAt: new Date(base + 100),
        },
        {
          threadId: thread.id,
          role: "user",
          status: "complete",
          content: { not_body: "x" },
          createdAt: new Date(base + 200),
        },
        {
          threadId: thread.id,
          role: "agent",
          status: "complete",
          content: [],
          provider: "gemini",
          createdAt: new Date(base + 300),
        },
        {
          threadId: thread.id,
          role: "user",
          status: "complete",
          content: { body: "" },
          createdAt: new Date(base + 400),
        },
      ]);

      const [userRow] = await db
        .insert(chatMessages)
        .values({
          threadId: thread.id,
          role: "user",
          status: "complete",
          content: { body: "now" },
        })
        .returning({ id: chatMessages.id });
      const [agentRow] = await db
        .insert(chatMessages)
        .values({
          threadId: thread.id,
          role: "agent",
          status: "streaming",
          content: { body: "" },
          provider: "gemini",
        })
        .returning({ id: chatMessages.id });

      const { provider, captured } = buildCapturingProvider();
      for await (const _ of runAgent({
        threadId: thread.id,
        userMessage: { content: "now" },
        mode: "auto",
        excludeMessageIds: [userRow.id, agentRow.id],
        provider,
        ragMode: "off",
      })) {
        // drain
      }

      // The 2 valid rows survive even though 3 newer malformed rows exist.
      const history = captured.messages!.slice(1, -1);
      expect(history).toEqual([
        { role: "user", content: "old user" },
        { role: "assistant", content: "old reply" },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
