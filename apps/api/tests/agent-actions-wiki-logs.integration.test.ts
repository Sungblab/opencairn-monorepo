import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, eq, folders, wikiLogs, yjsDocuments } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { labelFromId } from "../src/lib/tree-queries.js";
import { yjsStateToPlateValue } from "../src/lib/yjs-plate-transform.js";

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

    const [doc] = await db
      .select({ state: yjsDocuments.state })
      .from(yjsDocuments)
      .where(eq(yjsDocuments.name, `page:${body.action.result.note.id}`));
    expect(doc).toBeDefined();
    expect(yjsStateToPlateValue(doc!.state)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "h1" }),
        expect.objectContaining({ type: "p" }),
      ]),
    );
  });

  it("records wiki logs for agent note rename, move, delete, and restore", async () => {
    const folderId = randomUUID();
    await db.insert(folders).values({
      id: folderId,
      projectId: seed.projectId,
      parentId: null,
      name: "Agent target",
      path: labelFromId(folderId),
    });

    const rename = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.rename",
        risk: "write",
        input: { noteId: seed.noteId, title: "Agent renamed" },
      }),
    });
    expect(rename.status).toBe(201);

    const move = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.move",
        risk: "write",
        input: { noteId: seed.noteId, folderId },
      }),
    });
    expect(move.status).toBe(201);

    const deleteCreate = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.delete",
        risk: "destructive",
        input: { noteId: seed.noteId },
      }),
    });
    expect(deleteCreate.status).toBe(201);
    const deleteBody = await deleteCreate.json() as {
      action: { id: string; status: string };
    };
    expect(deleteBody.action.status).toBe("approval_required");

    const deleteApply = await authedFetch(`/api/agent-actions/${deleteBody.action.id}/apply`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({}),
    });
    expect(deleteApply.status).toBe(200);

    const restore = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.restore",
        risk: "write",
        input: { noteId: seed.noteId },
      }),
    });
    expect(restore.status).toBe(201);

    const logs = await db
      .select({
        agent: wikiLogs.agent,
        action: wikiLogs.action,
        reason: wikiLogs.reason,
      })
      .from(wikiLogs)
      .where(eq(wikiLogs.noteId, seed.noteId));

    expect(logs).toHaveLength(4);
    expect(logs).toEqual(expect.arrayContaining([
      {
        agent: "agent-actions",
        action: "update",
        reason: "agent note.rename applied",
      },
      {
        agent: "agent-actions",
        action: "update",
        reason: "agent note.move applied",
      },
      {
        agent: "agent-actions",
        action: "update",
        reason: "agent note.delete applied",
      },
      {
        agent: "agent-actions",
        action: "update",
        reason: "agent note.restore applied",
      },
    ]));
  });
});
