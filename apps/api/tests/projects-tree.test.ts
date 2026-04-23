import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, folders, notes } from "@opencairn/db";
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

describe("GET /api/projects/:projectId/tree", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("returns root folders + root notes as discriminated nodes", async () => {
    const root = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Root folder",
    });

    const res = await authedFetch(`/api/projects/${seed.projectId}/tree`, {
      userId: seed.userId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // The seed already provides one root-level note (seed.noteId, folder_id=null).
    const ids: string[] = body.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(root.id);
    expect(ids).toContain(seed.noteId);

    const rootNode = body.nodes.find((n: { id: string }) => n.id === root.id);
    expect(rootNode.kind).toBe("folder");
    const noteNode = body.nodes.find((n: { id: string }) => n.id === seed.noteId);
    expect(noteNode.kind).toBe("note");
  });

  it("prefetches one level of folder children (subfolders + notes)", async () => {
    const root = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Root",
    });
    const sub = await insertFolder({
      projectId: seed.projectId,
      parentId: root.id,
      name: "sub",
      parentPath: root.path,
    });
    const subNote = await insertNote({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: root.id,
      title: "note under root",
    });

    const res = await authedFetch(`/api/projects/${seed.projectId}/tree`, {
      userId: seed.userId,
    });
    const body = await res.json();
    const rootNode = body.nodes.find((n: { id: string }) => n.id === root.id);
    const childIds = rootNode.children.map((c: { id: string }) => c.id);
    expect(childIds).toContain(sub.id);
    expect(childIds).toContain(subNote);
  });

  it("parent_id filters to children of that folder", async () => {
    const root = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Root",
    });
    const sub = await insertFolder({
      projectId: seed.projectId,
      parentId: root.id,
      name: "sub",
      parentPath: root.path,
    });
    await insertNote({
      projectId: seed.projectId,
      workspaceId: seed.workspaceId,
      folderId: root.id,
      title: "n",
    });

    const res = await authedFetch(
      `/api/projects/${seed.projectId}/tree?parent_id=${root.id}`,
      { userId: seed.userId },
    );
    const body = await res.json();
    const ids: string[] = body.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(sub.id);
    // The root-level seed note is not a child of `root` folder.
    expect(ids).not.toContain(seed.noteId);
    expect(body.nodes).toHaveLength(2);
  });

  it("rejects parent_id pointing at a note (leaves can't have children)", async () => {
    const res = await authedFetch(
      `/api/projects/${seed.projectId}/tree?parent_id=${seed.noteId}`,
      { userId: seed.userId },
    );
    expect(res.status).toBe(400);
  });

  it("rejects cross-project parent_id", async () => {
    const other = await seedWorkspace({ role: "owner" });
    try {
      const outside = await insertFolder({
        projectId: other.projectId,
        parentId: null,
        name: "outside",
      });
      const res = await authedFetch(
        `/api/projects/${seed.projectId}/tree?parent_id=${outside.id}`,
        { userId: seed.userId },
      );
      expect(res.status).toBe(400);
    } finally {
      await other.cleanup();
    }
  });

  it("rejects non-uuid parent_id", async () => {
    const res = await authedFetch(
      `/api/projects/${seed.projectId}/tree?parent_id=not-a-uuid`,
      { userId: seed.userId },
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 to non-members", async () => {
    const outsider = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(
        `/api/projects/${seed.projectId}/tree`,
        { userId: outsider.userId },
      );
      expect(res.status).toBe(403);
    } finally {
      await outsider.cleanup();
    }
  });
});
