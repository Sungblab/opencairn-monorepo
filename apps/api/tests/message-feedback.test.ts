import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import {
  db,
  chatThreads,
  chatMessages,
  messageFeedback,
  eq,
  and,
} from "@opencairn/db";
import {
  seedWorkspace,
  seedMultiRoleWorkspace,
  type SeedResult,
  type SeedMultiRoleResult,
} from "./helpers/seed.js";
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

// Inserts a thread + agent message via direct DB writes — the public
// /api/threads/:id/messages path drives an SSE pipeline we don't want as a
// dependency of the feedback tests.
async function seedThreadWithAgentMessage(
  workspaceId: string,
  ownerUserId: string,
): Promise<{ threadId: string; messageId: string }> {
  const [thread] = await db
    .insert(chatThreads)
    .values({ workspaceId, userId: ownerUserId, title: "feedback test" })
    .returning({ id: chatThreads.id });
  const [msg] = await db
    .insert(chatMessages)
    .values({
      threadId: thread.id,
      role: "agent",
      status: "complete",
      content: { body: "stub reply" },
      mode: "auto",
    })
    .returning({ id: chatMessages.id });
  return { threadId: thread.id, messageId: msg.id };
}

describe("Message feedback — owner happy paths", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    // chat_threads cascades chat_messages and message_feedback; workspace
    // cascade in seed cleanup will remove the thread, but we strip feedback
    // explicitly so the per-test FK ordering is obvious.
    await ctx.cleanup();
  });

  it("owner rates their agent message positive → 201; GET returns row", async () => {
    const { messageId } = await seedThreadWithAgentMessage(
      ctx.workspaceId,
      ctx.userId,
    );

    const post = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ message_id: messageId, sentiment: "positive" }),
    });
    expect(post.status).toBe(201);

    const get = await authedFetch(
      `/api/message-feedback?message_id=${messageId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(get.status).toBe(200);
    const body = (await get.json()) as { sentiment: string; reason: string | null };
    expect(body).toEqual({ sentiment: "positive", reason: null });
  });

  it("owner rates negative with reason → 201; GET round-trips reason", async () => {
    const { messageId } = await seedThreadWithAgentMessage(
      ctx.workspaceId,
      ctx.userId,
    );

    const post = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        message_id: messageId,
        sentiment: "negative",
        reason: "incorrect",
      }),
    });
    expect(post.status).toBe(201);

    const get = await authedFetch(
      `/api/message-feedback?message_id=${messageId}`,
      { method: "GET", userId: ctx.userId },
    );
    const body = (await get.json()) as { sentiment: string; reason: string | null };
    expect(body).toEqual({ sentiment: "negative", reason: "incorrect" });
  });

  it("upsert: positive → negative replaces the row (no duplicates)", async () => {
    const { messageId } = await seedThreadWithAgentMessage(
      ctx.workspaceId,
      ctx.userId,
    );

    const first = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ message_id: messageId, sentiment: "positive" }),
    });
    expect(first.status).toBe(201);

    const second = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        message_id: messageId,
        sentiment: "negative",
        reason: "wrong on second look",
      }),
    });
    expect(second.status).toBe(201);

    const get = await authedFetch(
      `/api/message-feedback?message_id=${messageId}`,
      { method: "GET", userId: ctx.userId },
    );
    const body = (await get.json()) as { sentiment: string; reason: string | null };
    expect(body).toEqual({ sentiment: "negative", reason: "wrong on second look" });

    // Verify exactly one row exists at the DB level — the unique index is
    // load-bearing for this contract.
    const rows = await db
      .select()
      .from(messageFeedback)
      .where(
        and(
          eq(messageFeedback.messageId, messageId),
          eq(messageFeedback.userId, ctx.userId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("GET returns null when no feedback exists yet", async () => {
    const { messageId } = await seedThreadWithAgentMessage(
      ctx.workspaceId,
      ctx.userId,
    );

    const get = await authedFetch(
      `/api/message-feedback?message_id=${messageId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(get.status).toBe(200);
    expect(await get.json()).toBeNull();
  });
});

describe("Message feedback — validation + 4xx", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("invalid sentiment returns 400", async () => {
    const { messageId } = await seedThreadWithAgentMessage(
      ctx.workspaceId,
      ctx.userId,
    );
    const res = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ message_id: messageId, sentiment: "meh" }),
    });
    expect(res.status).toBe(400);
  });

  it("missing message_id returns 400", async () => {
    const res = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ sentiment: "positive" }),
    });
    expect(res.status).toBe(400);
  });

  it("malformed message_id (not UUID) returns 400", async () => {
    const res = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ message_id: "not-a-uuid", sentiment: "positive" }),
    });
    expect(res.status).toBe(400);
  });

  it("non-existent (well-formed) message_id returns 404", async () => {
    const res = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        message_id: "00000000-0000-4000-8000-000000000000",
        sentiment: "positive",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("GET without message_id query returns 400", async () => {
    const res = await authedFetch("/api/message-feedback", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(400);
  });
});

describe("Message feedback — multi-user permission", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("workspace member who isn't the thread owner gets 403", async () => {
    // Owner's thread + agent message; editor is a workspace member but does
    // not own the conversation.
    const { messageId } = await seedThreadWithAgentMessage(
      seed.workspaceId,
      seed.ownerUserId,
    );

    const res = await authedFetch("/api/message-feedback", {
      method: "POST",
      userId: seed.editorUserId,
      body: JSON.stringify({ message_id: messageId, sentiment: "positive" }),
    });
    expect(res.status).toBe(403);
  });
});
