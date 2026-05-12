import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, eq, wikiLogs } from "@opencairn/db";
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

describe("agent action wiki logs", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("records a wiki log when an agent creates a note", async () => {
    const res = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.create",
        risk: "write",
        input: { title: "Agent-created note", folderId: null },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      action: { status: string; result: { note: { id: string } } };
    };
    expect(body.action.status).toBe("completed");

    const logs = await db
      .select({
        agent: wikiLogs.agent,
        action: wikiLogs.action,
        reason: wikiLogs.reason,
      })
      .from(wikiLogs)
      .where(eq(wikiLogs.noteId, body.action.result.note.id));
    expect(logs).toEqual([
      {
        agent: "agent-actions",
        action: "create",
        reason: "agent note.create applied",
      },
    ]);
  });

  it("records a wiki log when an agent creates a note from markdown", async () => {
    const res = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.create_from_markdown",
        risk: "write",
        input: {
          title: "Agent markdown note",
          folderId: null,
          bodyMarkdown: "# Agent markdown note\n\nMaintained by the agent.",
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      action: { status: string; result: { note: { id: string; contentText: string } } };
    };
    expect(body.action.status).toBe("completed");
    expect(body.action.result.note.contentText).toContain("Maintained by the agent.");

    const logs = await db
      .select({
        agent: wikiLogs.agent,
        action: wikiLogs.action,
        reason: wikiLogs.reason,
      })
      .from(wikiLogs)
      .where(eq(wikiLogs.noteId, body.action.result.note.id));
    expect(logs).toEqual([
      {
        agent: "agent-actions",
        action: "create",
        reason: "agent note.create_from_markdown applied",
      },
    ]);
  });
});
