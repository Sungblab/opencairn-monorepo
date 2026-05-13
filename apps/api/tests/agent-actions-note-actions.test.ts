import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { and, db, eq, folders, notes } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { labelFromId } from "../src/lib/tree-queries.js";

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

async function insertFolder(projectId: string, name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(folders).values({
    id,
    projectId,
    parentId: null,
    name,
    path: labelFromId(id),
  });
  return id;
}

describe("note agent actions", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("executes note.create once for the same requestId", async () => {
    const requestId = randomUUID();
    const body = {
      requestId,
      kind: "note.create",
      risk: "write",
      input: { title: "Agent-created note", folderId: null },
    };

    const first = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify(body),
    });
    const second = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
      method: "POST",
      userId: seed.userId,
      body: JSON.stringify(body),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as {
      action: { status: string; result: { note: { id: string } } };
      idempotent: boolean;
    };
    const secondBody = await second.json() as {
      action: { id: string; status: string; result: { note: { id: string } } };
      idempotent: boolean;
    };
    expect(firstBody.idempotent).toBe(false);
    expect(secondBody.idempotent).toBe(true);
    expect(secondBody.action.status).toBe("completed");
    expect(secondBody.action.result.note.id).toBe(firstBody.action.result.note.id);

    const rows = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.projectId, seed.projectId), eq(notes.title, "Agent-created note")));
    expect(rows).toHaveLength(1);
  });

  it("executes rename, move, soft-delete, and restore with completed ledger results", async () => {
    const folderId = await insertFolder(seed.projectId, "Agent target");

    const rename = await postAction(seed, {
      requestId: randomUUID(),
      kind: "note.rename",
      risk: "write",
      input: { noteId: seed.noteId, title: "Agent renamed" },
    });
    expect(rename.action.status).toBe("completed");

    const move = await postAction(seed, {
      requestId: randomUUID(),
      kind: "note.move",
      risk: "write",
      input: { noteId: seed.noteId, folderId },
    });
    expect(move.action.status).toBe("completed");

    const deleted = await postAction(seed, {
      requestId: randomUUID(),
      kind: "note.delete",
      risk: "destructive",
      input: { noteId: seed.noteId },
    });
    expect(deleted.action.status).toBe("approval_required");

    const appliedDelete = await applyAction(seed, deleted.action.id);
    expect(appliedDelete.action.status).toBe("completed");

    const restored = await postAction(seed, {
      requestId: randomUUID(),
      kind: "note.restore",
      risk: "write",
      input: { noteId: seed.noteId },
    });
    expect(restored.action.status).toBe("completed");

    const [note] = await db.select().from(notes).where(eq(notes.id, seed.noteId));
    expect(note.title).toBe("Agent renamed");
    expect(note.folderId).toBe(folderId);
    expect(note.deletedAt).toBeNull();
  });
});

async function postAction(
  seed: SeedResult,
  body: {
    requestId: string;
    kind: "note.rename" | "note.move" | "note.delete" | "note.restore";
    risk: "write" | "destructive";
    input: Record<string, unknown>;
  },
): Promise<{ action: { id: string; status: string } }> {
  const res = await authedFetch(`/api/projects/${seed.projectId}/agent-actions`, {
    method: "POST",
    userId: seed.userId,
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return await res.json() as { action: { id: string; status: string } };
}

async function applyAction(
  seed: SeedResult,
  actionId: string,
): Promise<{ action: { status: string } }> {
  const res = await authedFetch(`/api/agent-actions/${actionId}/apply`, {
    method: "POST",
    userId: seed.userId,
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
  return await res.json() as { action: { status: string } };
}
