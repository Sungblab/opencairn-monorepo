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

  it("hides empty source bundle artifact groups until they have children", async () => {
    const bundleNodeId = randomUUID();
    const parsedGroupId = randomUUID();
    const figuresGroupId = randomUUID();
    const analysisGroupId = randomUUID();
    const parsedFileId = randomUUID();
    await db.insert(projectTreeNodes).values([
      {
        id: bundleNodeId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        parentId: null,
        kind: "source_bundle",
        label: "week-1.pdf",
        icon: "file-pdf",
        path: labelFromId(bundleNodeId),
        metadata: {},
      },
      {
        id: parsedGroupId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        parentId: bundleNodeId,
        kind: "artifact_group",
        label: "추출 결과",
        icon: "folder",
        path: `${labelFromId(bundleNodeId)}.${labelFromId(parsedGroupId)}`,
        metadata: { role: "parsed" },
      },
      {
        id: figuresGroupId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        parentId: bundleNodeId,
        kind: "artifact_group",
        label: "이미지/도표",
        icon: "image",
        path: `${labelFromId(bundleNodeId)}.${labelFromId(figuresGroupId)}`,
        metadata: { role: "figures" },
      },
      {
        id: analysisGroupId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        parentId: bundleNodeId,
        kind: "artifact_group",
        label: "분석 결과",
        icon: "sparkles",
        path: `${labelFromId(bundleNodeId)}.${labelFromId(analysisGroupId)}`,
        metadata: { role: "analysis" },
      },
    ]);
    await db.insert(agentFiles).values({
      id: parsedFileId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      createdBy: seed.userId,
      title: "parsed.md",
      filename: "parsed.md",
      extension: "md",
      kind: "markdown",
      mimeType: "text/markdown",
      objectKey: "test/parsed.md",
      bytes: 12,
      contentHash: "hash",
      source: "manual",
      versionGroupId: randomUUID(),
      version: 1,
    });
    await db.insert(projectTreeNodes).values({
      id: parsedFileId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      parentId: parsedGroupId,
      kind: "agent_file",
      targetTable: "agent_files",
      targetId: parsedFileId,
      label: "parsed.md",
      icon: "file",
      path: `${labelFromId(bundleNodeId)}.${labelFromId(parsedGroupId)}.${labelFromId(parsedFileId)}`,
      metadata: { role: "parsed" },
    });

    const res = await authedFetch(`/api/projects/${seed.projectId}/tree`, {
      userId: seed.userId,
    });

    if (res.status !== 200) {
      throw new Error(await res.text());
    }
    const body = await res.json();
    const bundle = body.nodes.find((node: { id: string }) => node.id === bundleNodeId);
    expect(bundle.child_count).toBe(1);
    expect(bundle.children.map((node: { label: string }) => node.label)).toEqual([
      "추출 결과",
    ]);
  });

  it("surfaces completed bundle ingest status for artifact files", async () => {
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
      metadata: { status: "completed" },
    });
    await db.insert(agentFiles).values({
      id: fileId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      createdBy: seed.userId,
      title: "summary.md",
      filename: "summary.md",
      extension: "md",
      kind: "markdown",
      mimeType: "text/markdown",
      objectKey: "test/summary.md",
      bytes: 12,
      contentHash: "hash",
      source: "manual",
      versionGroupId: randomUUID(),
      version: 1,
      ingestStatus: "queued",
    });
    await db.insert(projectTreeNodes).values({
      id: fileId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      parentId: bundleNodeId,
      kind: "agent_file",
      targetTable: "agent_files",
      targetId: fileId,
      label: "summary.md",
      icon: "file",
      path: `${labelFromId(bundleNodeId)}.${labelFromId(fileId)}`,
      metadata: { role: "analysis", bundleNodeId },
    });

    const res = await authedFetch(`/api/agent-files/${fileId}`, {
      userId: seed.userId,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { file: { ingestStatus: string } };
    expect(body.file.ingestStatus).toBe("completed");
  });

  it("moves legacy generated source notes from extracted results to analysis results", async () => {
    const bundleNodeId = randomUUID();
    const parsedGroupId = randomUUID();
    const analysisGroupId = randomUUID();
    const sourceNoteId = randomUUID();
    await db.insert(notes).values({
      id: sourceNoteId,
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      folderId: null,
      title: "week-1.pdf",
      type: "source",
      sourceType: "pdf",
      isAuto: true,
    });
    await db.insert(projectTreeNodes).values([
      {
        id: bundleNodeId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        parentId: null,
        kind: "source_bundle",
        label: "week-1.pdf",
        icon: "file-pdf",
        path: labelFromId(bundleNodeId),
        metadata: {},
      },
      {
        id: parsedGroupId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        parentId: bundleNodeId,
        kind: "artifact_group",
        label: "추출 결과",
        icon: "folder",
        path: `${labelFromId(bundleNodeId)}.${labelFromId(parsedGroupId)}`,
        metadata: { role: "parsed" },
      },
      {
        id: analysisGroupId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        parentId: bundleNodeId,
        kind: "artifact_group",
        label: "분석 결과",
        icon: "sparkles",
        path: `${labelFromId(bundleNodeId)}.${labelFromId(analysisGroupId)}`,
        metadata: { role: "analysis" },
      },
      {
        id: sourceNoteId,
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        parentId: parsedGroupId,
        kind: "note",
        targetTable: "notes",
        targetId: sourceNoteId,
        label: "전체 추출 노트",
        icon: "file-text",
        path: `${labelFromId(bundleNodeId)}.${labelFromId(parsedGroupId)}.${labelFromId(sourceNoteId)}`,
        metadata: { role: "source_note", sourceType: "pdf" },
      },
    ]);

    const res = await authedFetch(`/api/projects/${seed.projectId}/tree`, {
      userId: seed.userId,
    });

    if (res.status !== 200) {
      throw new Error(await res.text());
    }
    const body = await res.json();
    const bundle = body.nodes.find((node: { id: string }) => node.id === bundleNodeId);
    expect(bundle.children.map((node: { label: string }) => node.label)).toEqual([
      "분석 결과",
    ]);
    const [sourceNode] = await db
      .select({
        parentId: projectTreeNodes.parentId,
        label: projectTreeNodes.label,
      })
      .from(projectTreeNodes)
      .where(eq(projectTreeNodes.id, sourceNoteId));
    expect(sourceNode).toMatchObject({
      parentId: analysisGroupId,
      label: "generated_note",
    });
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
