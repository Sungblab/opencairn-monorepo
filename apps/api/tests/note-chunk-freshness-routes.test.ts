import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { agentFiles, and, db, eq, projectTreeNodes, wikiLinks } from "@opencairn/db";
import { randomUUID } from "node:crypto";
import { labelFromId } from "../src/lib/tree-queries.js";

const mocks = vi.hoisted(() => ({
  refreshNoteChunkIndexBestEffort: vi.fn(),
}));

vi.mock("../src/lib/note-chunk-refresh", () => ({
  refreshNoteChunkIndexBestEffort: mocks.refreshNoteChunkIndexBestEffort,
}));

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

describe("note chunk freshness route wiring", () => {
  let ctx: SeedResult;
  const previousSecret = process.env.INTERNAL_API_SECRET;

  beforeEach(async () => {
    process.env.INTERNAL_API_SECRET = "test-internal-secret";
    mocks.refreshNoteChunkIndexBestEffort.mockReset();
    mocks.refreshNoteChunkIndexBestEffort.mockResolvedValue(undefined);
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
    if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = previousSecret;
  });

  it("indexes internal source notes from title and contentText after create", async () => {
    const res = await app.request("/api/internal/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "Fresh Source",
        type: "source",
        sourceType: "pdf",
        contentText: "fresh imported body",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { noteId: string };
    expect(mocks.refreshNoteChunkIndexBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: body.noteId,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        title: "Fresh Source",
        contentText: "fresh imported body",
        deletedAt: null,
      }),
    );
  });

  it("indexes worker-created ingest source notes after create", async () => {
    const res = await app.request("/api/internal/source-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({
        userId: ctx.userId,
        projectId: ctx.projectId,
        parentNoteId: null,
        title: "Worker Source",
        content: "worker ingested body",
        sourceType: "pdf",
        objectKey: "uploads/u/source.pdf",
        sourceUrl: null,
        mimeType: "application/pdf",
        triggerCompiler: false,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { noteId: string };
    expect(mocks.refreshNoteChunkIndexBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: body.noteId,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        title: "Worker Source",
        contentText: "worker ingested body",
        deletedAt: null,
      }),
    );
  });

  it("indexes agent-created markdown wiki notes after create", async () => {
    const res = await authedFetch(`/api/projects/${ctx.projectId}/agent-actions`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.create_from_markdown",
        risk: "write",
        input: {
          title: "Agent wiki note",
          folderId: null,
          bodyMarkdown: "# Agent wiki note\n\nThis page should be indexed.",
        },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      action: { status: string; result: { note: { id: string } } };
    };
    expect(body.action.status).toBe("completed");
    expect(mocks.refreshNoteChunkIndexBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: body.action.result.note.id,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        title: "Agent wiki note",
        contentText: "# Agent wiki note\n\nThis page should be indexed.",
        deletedAt: null,
      }),
    );
  });

  it("marks the original uploaded agent file completed when the worker creates its source note", async () => {
    const [file] = await db
      .insert(agentFiles)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        createdBy: ctx.userId,
        title: "Worker Source.pdf",
        filename: "Worker Source.pdf",
        extension: "pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        objectKey: "uploads/u/source.pdf",
        bytes: 64,
        contentHash: "hash",
        source: "manual",
        versionGroupId: randomUUID(),
        version: 1,
        ingestWorkflowId: "ingest-test",
        ingestStatus: "queued",
      })
      .returning({ id: agentFiles.id });
    expect(file).toBeDefined();

    const res = await app.request("/api/internal/source-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({
        userId: ctx.userId,
        projectId: ctx.projectId,
        parentNoteId: null,
        title: "Worker Source",
        content: "worker ingested body",
        sourceType: "pdf",
        objectKey: "uploads/u/source.pdf",
        sourceUrl: null,
        mimeType: "application/pdf",
        treeLabel: "전체 추출 노트",
        originalFileNodeId: file!.id,
        triggerCompiler: false,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { noteId: string };
    const [updated] = await db
      .select({
        ingestStatus: agentFiles.ingestStatus,
        sourceNoteId: agentFiles.sourceNoteId,
      })
      .from(agentFiles)
      .where(eq(agentFiles.id, file!.id));
    expect(updated).toEqual({
      ingestStatus: "completed",
      sourceNoteId: body.noteId,
    });
  });

  it("reindexes internal note patches when contentText changes", async () => {
    const create = await app.request("/api/internal/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "Patch Source",
        type: "source",
        sourceType: "pdf",
        contentText: "old body",
      }),
    });
    const { noteId } = (await create.json()) as { noteId: string };
    mocks.refreshNoteChunkIndexBestEffort.mockClear();

    const patch = await app.request(`/api/internal/notes/${noteId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({ contentText: "new indexed body" }),
    });

    expect(patch.status).toBe(200);
    expect(mocks.refreshNoteChunkIndexBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: noteId,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        title: "Patch Source",
        contentText: "new indexed body",
      }),
    );
  });

  it("syncs wiki links when internal note patch changes Plate content", async () => {
    const create = await app.request("/api/internal/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "Patch Links",
        type: "source",
        sourceType: "pdf",
        contentText: "old body",
      }),
    });
    const { noteId } = (await create.json()) as { noteId: string };

    const patch = await app.request(`/api/internal/notes/${noteId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({
        content: [
          {
            type: "p",
            children: [
              { text: "Related: " },
              {
                type: "wiki-link",
                targetId: ctx.noteId,
                children: [{ text: "seed note" }],
              },
            ],
          },
        ],
        contentText: "Related: seed note",
      }),
    });

    expect(patch.status).toBe(200);
    const rows = await db
      .select({ id: wikiLinks.id })
      .from(wikiLinks)
      .where(
        and(
          eq(wikiLinks.sourceNoteId, noteId),
          eq(wikiLinks.targetNoteId, ctx.noteId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("clears stale wiki links when internal note patch removes Plate links", async () => {
    const create = await app.request("/api/internal/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({
        projectId: ctx.projectId,
        title: "Patch Link Removal",
        type: "source",
        sourceType: "pdf",
        content: [
          {
            type: "p",
            children: [
              { text: "Related: " },
              {
                type: "wiki-link",
                targetId: ctx.noteId,
                children: [{ text: "seed note" }],
              },
            ],
          },
        ],
        contentText: "Related: seed note",
      }),
    });
    const { noteId } = (await create.json()) as { noteId: string };

    const patch = await app.request(`/api/internal/notes/${noteId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-internal-secret",
      },
      body: JSON.stringify({
        content: [{ type: "p", children: [{ text: "No links now" }] }],
        contentText: "No links now",
      }),
    });

    expect(patch.status).toBe(200);
    const rows = await db
      .select({ id: wikiLinks.id })
      .from(wikiLinks)
      .where(eq(wikiLinks.sourceNoteId, noteId));
    expect(rows).toHaveLength(0);
  });

  it("reindexes a note when its project tree node title changes", async () => {
    const nodeId = randomUUID();
    await db.insert(projectTreeNodes).values({
      id: nodeId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      parentId: null,
      kind: "note",
      targetTable: "notes",
      targetId: ctx.noteId,
      label: "Old tree title",
      icon: "file-text",
      path: labelFromId(nodeId),
    });
    mocks.refreshNoteChunkIndexBestEffort.mockClear();

    const res = await authedFetch(`/api/tree/nodes/${nodeId}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ label: "Renamed through tree" }),
    });

    expect(res.status).toBe(200);
    expect(mocks.refreshNoteChunkIndexBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ctx.noteId,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        title: "Renamed through tree",
      }),
    );
  });

  it("reindexes a note when an agent rename action changes its title", async () => {
    mocks.refreshNoteChunkIndexBestEffort.mockClear();

    const res = await authedFetch(`/api/projects/${ctx.projectId}/agent-actions`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        requestId: randomUUID(),
        kind: "note.rename",
        risk: "write",
        input: {
          noteId: ctx.noteId,
          title: "Renamed by librarian",
        },
      }),
    });

    expect(res.status).toBe(201);
    expect(mocks.refreshNoteChunkIndexBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ctx.noteId,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        title: "Renamed by librarian",
      }),
    );
  });
});
