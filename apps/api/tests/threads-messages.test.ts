import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("../src/lib/s3.js", () => ({
  uploadObject: vi.fn().mockResolvedValue(undefined),
}));

import { createApp } from "../src/app.js";
import { db, agentFiles, chatThreads, chatMessages, eq, asc } from "@opencairn/db";
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

// Fake runAgent injected for the happy-path tests below — keeps them
// hermetic now that the real pipeline calls Gemini. We inject a known
// stream of chunks so the route's SSE/persistence wiring is exercised
// without an external API dependency. The "real LLM" path has its own
// dedicated test file (threads-real-llm.test.ts).
async function* fakeAgentStream(opts: {
  userMessage: { content: string };
}): AsyncGenerator<AgentChunk> {
  yield { type: "status", payload: { phrase: "fake status" } };
  yield { type: "thought", payload: { summary: "fake thought" } };
  // Multiple text frames so "true streaming, not single-chunk" still holds.
  for (const ch of `echo:${opts.userMessage.content}`) {
    yield { type: "text", payload: { delta: ch } };
  }
  yield { type: "done", payload: {} };
}

async function* fakeAgentFileStream(): AsyncGenerator<AgentChunk> {
  yield { type: "status", payload: { phrase: "writing file" } };
  yield {
    type: "agent_file",
    payload: {
      files: [
        {
          filename: "agent-brief.md",
          title: "Agent Brief",
          kind: "markdown",
          mimeType: "text/markdown",
          content: "# Agent Brief\n\nGenerated from the agent workflow.",
          startIngest: false,
        },
      ],
    },
  };
  yield { type: "text", payload: { delta: "Created Agent Brief." } };
  yield { type: "done", payload: {} };
}

describe("Threads messages — happy path", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    __setRunAgentForTest(fakeAgentStream);
  });

  afterEach(async () => {
    await ctx.cleanup();
    __setRunAgentForTest(null);
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
    // Multiple text frames — true streaming, not single-chunk.
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
    expect(body.messages[1].content).toMatchObject({ body: "echo:hi" });
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

  it("turns an agent file chunk into project object events, tree-backed row, and persisted metadata", async () => {
    __setRunAgentForTest(fakeAgentFileStream);
    const threadId = await createThread(ctx.workspaceId, ctx.userId);

    const res = await authedFetch(`/api/threads/${threadId}/messages`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        content: "make a brief",
        mode: "auto",
        scope: { projectId: ctx.projectId },
      }),
    });
    expect(res.status).toBe(200);

    const events = parseSseEvents(await res.text());
    const created = events.find((e) => e.event === "project_object_created");
    const legacy = events.find((e) => e.event === "agent_file_created");
    expect(created?.data).toMatchObject({
      type: "project_object_created",
      object: {
        objectType: "agent_file",
        title: "Agent Brief",
        filename: "agent-brief.md",
        kind: "markdown",
        mimeType: "text/markdown",
        projectId: ctx.projectId,
      },
    });
    expect(legacy?.data).toMatchObject({
      type: "agent_file_created",
      file: {
        title: "Agent Brief",
        filename: "agent-brief.md",
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        source: "agent_chat",
      },
    });

    const fileId = (created!.data as { object: { id: string } }).object.id;
    const [file] = await db
      .select()
      .from(agentFiles)
      .where(eq(agentFiles.id, fileId));
    expect(file).toMatchObject({
      id: fileId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      title: "Agent Brief",
      filename: "agent-brief.md",
      source: "agent_chat",
      ingestStatus: "not_started",
    });
    expect(file!.chatThreadId).toBe(threadId);

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(asc(chatMessages.createdAt));
    expect(rows).toHaveLength(2);
    const content = rows[1]!.content as {
      agent_files?: Array<{ id: string }>;
      project_objects?: Array<{ id: string; objectType: string }>;
    };
    expect(content.agent_files?.[0]?.id).toBe(fileId);
    expect(content.project_objects?.[0]).toMatchObject({
      id: fileId,
      objectType: "agent_file",
    });
    expect(file!.chatMessageId).toBe(rows[1]!.id);
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

// The legacy `AGENT_STUB_EMIT_SAVE_SUGGESTION` env-gated stub describe block
// was removed when Task 7 wired runAgent to chat-llm.runChat — save_suggestion
// now arrives via the LLM fence parser (Task 5, save-suggestion-fence.ts).
// Fence parsing is covered by save-suggestion-fence.test.ts; the end-to-end
// path through the SSE route is exercised by threads-real-llm.test.ts via an
// injected fake provider.

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
