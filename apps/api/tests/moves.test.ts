import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, folders, notes, eq } from "@opencairn/db";
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
    },
  });
}

async function insertFolder(opts: {
  projectId: string;
  parentId: string | null;
  name: string;
  parentPath?: string;
}): Promise<{ id: string; path: string }> {
  const id = randomUUID();
  const path = opts.parentPath
    ? `${opts.parentPath}.${labelFromId(id)}`
    : labelFromId(id);
  await db.insert(folders).values({
    id,
    projectId: opts.projectId,
    parentId: opts.parentId,
    name: opts.name,
    path,
  });
  return { id, path };
}

async function insertNote(opts: {
  projectId: string;
  workspaceId: string;
  folderId: string | null;
  title: string;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(notes).values({
    id,
    projectId: opts.projectId,
    workspaceId: opts.workspaceId,
    folderId: opts.folderId,
    title: opts.title,
  });
  return id;
}

describe("PATCH /api/folders/:id with parentId change", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("rewrites the ltree subtree when moving under a new parent", async () => {
    const oldParent = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Old parent",
    });
    const newParent = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "New parent",
    });
    const child = await insertFolder({
      projectId: seed.projectId,
      parentId: oldParent.id,
      name: "Child",
      parentPath: oldParent.path,
    });
    const grandchild = await insertFolder({
      projectId: seed.projectId,
      parentId: child.id,
      name: "Grandchild",
      parentPath: child.path,
    });

    const res = await authedFetch(`/api/folders/${child.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: newParent.id }),
      userId: seed.userId,
    });
    expect(res.status).toBe(200);

    // scalar parent_id updated
    const [childAfter] = await db
      .select({ parentId: folders.parentId, path: folders.path })
      .from(folders)
      .where(eq(folders.id, child.id));
    expect(childAfter.parentId).toBe(newParent.id);
    expect(childAfter.path.startsWith(`${newParent.path}.`)).toBe(true);

    // descendant path rewritten too (prefix matches the new parent's path)
    const [grandchildAfter] = await db
      .select({ path: folders.path })
      .from(folders)
      .where(eq(folders.id, grandchild.id));
    expect(grandchildAfter.path.startsWith(`${newParent.path}.`)).toBe(true);
  });

  it("refuses to move into a folder from a different project", async () => {
    const otherSeed = await seedWorkspace({ role: "owner" });
    try {
      const here = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "Here",
      });
      const elsewhere = await insertFolder({
        projectId: otherSeed.projectId,
        parentId: null,
        name: "Elsewhere",
      });

      const res = await authedFetch(`/api/folders/${here.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: elsewhere.id }),
        userId: seed.userId,
      });
      expect(res.status).toBe(400);
    } finally {
      await otherSeed.cleanup();
    }
  });

  it("returns 403 when the caller cannot write the project", async () => {
    const outsider = await seedWorkspace({ role: "owner" });
    try {
      const target = await insertFolder({
        projectId: seed.projectId,
        parentId: null,
        name: "Target",
      });
      const res = await authedFetch(`/api/folders/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: null, name: "renamed" }),
        userId: outsider.userId,
      });
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });
});

describe("PATCH /api/notes/:id/move", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("updates folder_id and returns 200", async () => {
    const folder = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Bin",
    });
    const noteId = await insertNote({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: null,
      title: "Note",
    });

    const res = await authedFetch(`/api/notes/${noteId}/move`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId: folder.id }),
      userId: seed.userId,
    });
    expect(res.status).toBe(200);

    const [after] = await db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(after.folderId).toBe(folder.id);
  });

  it("moves the note back to the project root when folderId is null", async () => {
    const folder = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Bin",
    });
    const noteId = await insertNote({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: folder.id,
      title: "Note",
    });

    const res = await authedFetch(`/api/notes/${noteId}/move`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId: null }),
      userId: seed.userId,
    });
    expect(res.status).toBe(200);
    const [after] = await db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, noteId));
    expect(after.folderId).toBeNull();
  });

  it("refuses a cross-project target folder", async () => {
    const otherSeed = await seedWorkspace({ role: "owner" });
    try {
      const elsewhere = await insertFolder({
        projectId: otherSeed.projectId,
        parentId: null,
        name: "Elsewhere",
      });
      const noteId = await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: null,
        title: "Note",
      });
      const res = await authedFetch(`/api/notes/${noteId}/move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: elsewhere.id }),
        userId: seed.userId,
      });
      expect(res.status).toBe(400);
    } finally {
      await otherSeed.cleanup();
    }
  });

  it("returns 403 when the caller cannot write the note", async () => {
    const outsider = await seedWorkspace({ role: "owner" });
    try {
      const noteId = await insertNote({
        projectId: seed.projectId,
        workspaceId: seed.workspaceId,
        folderId: null,
        title: "Note",
      });
      const res = await authedFetch(`/api/notes/${noteId}/move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: null }),
        userId: outsider.userId,
      });
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });
});
