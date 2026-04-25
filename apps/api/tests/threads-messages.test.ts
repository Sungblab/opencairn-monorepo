import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import { db, chatThreads, chatMessages, eq, asc } from "@opencairn/db";
import { __setRunAgentForTest } from "../src/routes/threads.js";
import type { AgentChunk } from "../src/lib/agent-pipeline.js";
import { seedWorkspace, seedMultiRoleWorkspace, type SeedResult, type SeedMultiRoleResult } from "./helpers/seed.js";
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

// SSE frames are `event: <name>\ndata: <json>\n\n` blocks; split on the
// double newline and pull each name/data line out.
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

async function createThread(workspaceId: string, userId: string): Promise<string> {
  const res = await authedFetch("/api/threads", {
    method: "POST",
    userId,
    body: JSON.stringify({ workspace_id: workspaceId, title: "msg test" }),
  });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return id;
}

describe("Threads messages — happy path", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("POST streams expected events and persists user + agent rows", async () => {
    const threadId = await createThread(ctx.workspaceId, ctx.userId);

    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "hi", mode: "auto" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: user_persisted");
    expect(text).toContain("event: agent_placeholder");
    expect(text).toContain("event: status");
    expect(text).toContain("event: thought");
    expect(text).toContain("event: text");
    expect(text).toContain("event: done");

    const events = parseSseEvents(text);
    const textEvents = events.filter((e) => e.event === "text");
    // The stub yields one text event per character of "(stub agent
    // response to: hi)" — i.e. > 1 chunk, which is the property worth
    // asserting (true streaming, not single-chunk).
    expect(textEvents.length).toBeGreaterThan(1);

    // GET returns user + agent rows in order, both complete.
    const list = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      messages: {
        id: string;
        role: string;
        status: string;
        content: { body?: string };
      }[];
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].status).toBe("complete");
    expect(body.messages[0].content).toMatchObject({ body: "hi" });
    expect(body.messages[1].role).toBe("agent");
    expect(body.messages[1].status).toBe("complete");
    expect(body.messages[1].content).toMatchObject({
      body: "(stub agent response to: hi)",
    });
  });

  it("POST bumps thread updated_at", async () => {
    const threadId = await createThread(ctx.workspaceId, ctx.userId);

    const [before] = await db
      .select({ updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(eq(chatThreads.id, threadId));

    // Ensure a clock tick — Postgres TIMESTAMPTZ has microsecond
    // resolution but the JS Date side rounds to ms; a tiny wait avoids
    // false equality on fast machines.
    await new Promise((r) => setTimeout(r, 10));

    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "tick", mode: "auto" }),
    });
    expect(res.status).toBe(200);
    await res.text(); // drain the stream

    const [after] = await db
      .select({ updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(eq(chatThreads.id, threadId));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
  });
});

describe("Threads messages — validation + auth", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("GET with malformed UUID returns 400", async () => {
    const res = await authedFetch("/api/threads/not-a-uuid/messages", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(400);
  });

  it("POST with malformed UUID returns 400", async () => {
    const res = await authedFetch("/api/threads/not-a-uuid/messages", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "hi", mode: "auto" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST with empty content returns 400", async () => {
    const threadId = await createThread(ctx.workspaceId, ctx.userId);
    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "", mode: "auto" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST with whitespace-only content returns 400 (trim)", async () => {
    const threadId = await createThread(ctx.workspaceId, ctx.userId);
    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "   ", mode: "auto" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET on a non-existent thread returns 404", async () => {
    const res = await authedFetch(
      "/api/threads/00000000-0000-4000-8000-000000000000/messages",
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(404);
  });
});

describe("Threads messages — multi-user scoping", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("GET on another user's thread returns 403", async () => {
    const threadId = await createThread(seed.workspaceId, seed.ownerUserId);
    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "GET",
      userId: seed.editorUserId,
    });
    expect(res.status).toBe(403);
  });

  it("POST on another user's thread returns 403", async () => {
    const threadId = await createThread(seed.workspaceId, seed.ownerUserId);
    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: seed.editorUserId,
      body: JSON.stringify({ content: "intrusion", mode: "auto" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("Threads messages — pipeline failure", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
    __setRunAgentForTest(null);
  });

  // Flip back to default after the whole suite in case afterEach is skipped.
  afterAll(() => {
    __setRunAgentForTest(null);
  });

  it("leaves agent row as 'failed' when pipeline throws", async () => {
    const threadId = await createThread(ctx.workspaceId, ctx.userId);

    // eslint-disable-next-line require-yield
    async function* throwingPipeline(): AsyncGenerator<AgentChunk> {
      throw new Error("boom");
    }
    __setRunAgentForTest(throwingPipeline);

    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ content: "trigger boom", mode: "auto" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: error");
    expect(text).toContain("boom");

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.role).toBe("user");
    expect(rows[0]!.status).toBe("complete");
    expect(rows[1]!.role).toBe("agent");
    expect(rows[1]!.status).toBe("failed");
  });
});
