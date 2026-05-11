import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentFiles, db, notes, projectTreeNodes, eq } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { labelFromId } from "../src/lib/tree-queries.js";
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
    },
  });
}

async function insertNoteNode(opts: {
  seed: SeedResult;
  noteId?: string;
  parentId: string | null;
  title: string;
}): Promise<{ noteId: string; nodeId: string }> {
  const noteId = opts.noteId ?? randomUUID();
  if (!opts.noteId) {
    await db.insert(notes).values({
      id: noteId,
      workspaceId: opts.seed.workspaceId,
      projectId: opts.seed.projectId,
      folderId: null,
      title: opts.title,
    });
  }
  const nodeId = randomUUID();
  const parent = opts.parentId
    ? await db.query.projectTreeNodes.findFirst({
        where: eq(projectTreeNodes.id, opts.parentId),
        columns: { path: true },
      })
    : null;
  await db.insert(projectTreeNodes).values({
    id: nodeId,
    workspaceId: opts.seed.workspaceId,
    projectId: opts.seed.projectId,
    parentId: opts.parentId,
    kind: "note",
    targetTable: "notes",
    targetId: noteId,
    label: opts.title,
    icon: "file-text",
    path: parent ? `${parent.path}.${labelFromId(nodeId)}` : labelFromId(nodeId),
  });
  return { noteId, nodeId };
}

describe("unified project tree routes", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("lists child notes under a note-backed tree node", async () => {
    const parent = await insertNoteNode({
      seed,
      noteId: seed.noteId,
      parentId: null,
      title: "AI 정리 노트",
    });
    const child = await insertNoteNode({
      seed,
      parentId: parent.nodeId,
      title: "핵심 개념",
    });

    const res = await authedFetch(
      `/api/projects/${seed.projectId}/tree?parent_id=${parent.nodeId}`,
      { userId: seed.userId },
    );

    if (res.status !== 200) {
      throw new Error(await res.text());
    }
    const body = await res.json();
    expect(body.nodes).toMatchObject([
      {
        id: child.nodeId,
        kind: "note",
        parent_id: parent.nodeId,
        target_table: "notes",
        target_id: child.noteId,
        label: "핵심 개념",
      },
    ]);
  });

  it("moves a note node and mirrors root moves into notes.folder_id", async () => {
    const parent = await insertNoteNode({
      seed,
      noteId: seed.noteId,
      parentId: null,
      title: "AI 정리 노트",
    });
    const child = await insertNoteNode({
      seed,
      parentId: parent.nodeId,
      title: "핵심 개념",
    });

    const res = await authedFetch(`/api/tree/nodes/${child.nodeId}/move`, {
      userId: seed.userId,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: null, position: 0 }),
    });

    if (res.status !== 200) {
      throw new Error(await res.text());
    }
    const [note] = await db
      .select({ folderId: notes.folderId })
      .from(notes)
      .where(eq(notes.id, child.noteId));
    expect(note.folderId).toBeNull();
  });

  it("deletes tree-only bundles even when a child target file is already deleted", async () => {
    const bundleNodeId = randomUUID();
    const fileId = randomUUID();
    await db.insert(projectTreeNodes).values({
      id: bundleNodeId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      parentId: null,
      kind: "source_bundle",
      label: "week-1.pdf",
      icon: "file-pdf",
      path: labelFromId(bundleNodeId),
      metadata: {},
    });
    await db.insert(agentFiles).values({
      id: fileId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      createdBy: seed.userId,
      title: "week-1.pdf",
      filename: "week-1.pdf",
      extension: "pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      objectKey: "test/week-1.pdf",
      bytes: 12,
      contentHash: "hash",
      source: "manual",
      versionGroupId: randomUUID(),
      version: 1,
      deletedAt: new Date(),
    });
    await db.insert(projectTreeNodes).values({
      id: fileId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      parentId: bundleNodeId,
      kind: "agent_file",
      targetTable: "agent_files",
      targetId: fileId,
      label: "week-1.pdf",
      icon: "file-pdf",
      path: `${labelFromId(bundleNodeId)}.${labelFromId(fileId)}`,
      metadata: {},
    });

    const res = await authedFetch(`/api/tree/nodes/${fileId}`, {
      userId: seed.userId,
      method: "DELETE",
    });

    if (res.status !== 200) {
      throw new Error(await res.text());
    }
    const [node] = await db
      .select({ deletedAt: projectTreeNodes.deletedAt })
      .from(projectTreeNodes)
      .where(eq(projectTreeNodes.id, fileId));
    expect(node.deletedAt).toEqual(expect.any(Date));

    const [target] = await db
      .select({ id: agentFiles.id })
      .from(agentFiles)
      .where(eq(agentFiles.id, fileId));
    expect(target.id).toBe(fileId);
  });
});
