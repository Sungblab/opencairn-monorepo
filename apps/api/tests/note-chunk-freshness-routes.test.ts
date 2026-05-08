import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";

const mocks = vi.hoisted(() => ({
  refreshNoteChunkIndexBestEffort: vi.fn(),
}));

vi.mock("../src/lib/note-chunk-refresh", () => ({
  refreshNoteChunkIndexBestEffort: mocks.refreshNoteChunkIndexBestEffort,
}));

const app = createApp();

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
});
