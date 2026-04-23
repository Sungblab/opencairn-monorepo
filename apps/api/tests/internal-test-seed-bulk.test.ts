import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, folders, notes, eq, and } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

const SECRET = "test-internal-secret-bulk";
process.env.INTERNAL_API_SECRET = SECRET;

const app = createApp();

async function bulkFetch(body: unknown, withSecret = true): Promise<Response> {
  return app.request("/api/internal/test-seed-bulk", {
    method: "POST",
    headers: {
      ...(withSecret ? { "X-Internal-Secret": SECRET } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/test-seed-bulk", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("rejects without internal secret", async () => {
    const res = await bulkFetch(
      { projectId: ctx.projectId, folders: 1, notes: 1, maxDepth: 1 },
      false,
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when project does not exist", async () => {
    const res = await bulkFetch({
      projectId: randomUUID(),
      folders: 1,
      notes: 1,
      maxDepth: 1,
    });
    expect(res.status).toBe(404);
  });

  it("creates the requested number of folders and notes", async () => {
    const res = await bulkFetch({
      projectId: ctx.projectId,
      folders: 20,
      notes: 30,
      maxDepth: 3,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      folderIds: string[];
      noteIds: string[];
    };
    expect(body.folderIds).toHaveLength(20);
    expect(body.noteIds).toHaveLength(30);

    const folderRows = await db
      .select({ id: folders.id, projectId: folders.projectId, path: folders.path })
      .from(folders)
      .where(eq(folders.projectId, ctx.projectId));
    expect(folderRows).toHaveLength(20);
    // Every row has a non-empty ltree path
    for (const row of folderRows) {
      expect(typeof row.path).toBe("string");
      expect((row.path as unknown as string).length).toBeGreaterThan(0);
    }
  });

  it("produces folders whose parent_id is either null or references another inserted folder", async () => {
    const res = await bulkFetch({
      projectId: ctx.projectId,
      folders: 15,
      notes: 0,
      maxDepth: 3,
    });
    expect(res.status).toBe(201);
    const folderRows = await db
      .select({ id: folders.id, parentId: folders.parentId })
      .from(folders)
      .where(eq(folders.projectId, ctx.projectId));
    const ids = new Set(folderRows.map((r) => r.id));
    for (const row of folderRows) {
      if (row.parentId !== null) {
        expect(ids.has(row.parentId)).toBe(true);
      }
    }
    // At least one root (depth 0) is present so the tree is reachable.
    expect(folderRows.some((r) => r.parentId === null)).toBe(true);
  });

  it("inserts notes with the project's workspaceId denormalised", async () => {
    const res = await bulkFetch({
      projectId: ctx.projectId,
      folders: 2,
      notes: 5,
      maxDepth: 1,
    });
    expect(res.status).toBe(201);
    const noteRows = await db
      .select({ id: notes.id, workspaceId: notes.workspaceId })
      .from(notes)
      .where(
        and(eq(notes.projectId, ctx.projectId)),
      );
    // Includes the seed's Welcome note, so we expect seed.noteId + 5 new.
    const newNotes = noteRows.filter((r) => r.id !== ctx.noteId);
    expect(newNotes).toHaveLength(5);
    for (const row of newNotes) {
      expect(row.workspaceId).toBe(ctx.workspaceId);
    }
  });
});
