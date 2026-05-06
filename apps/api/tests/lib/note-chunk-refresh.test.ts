import { beforeEach, describe, expect, it, vi } from "vitest";

const indexNoteChunks = vi.fn();
const queueNoteAnalysisJob = vi.fn();
const runNoteAnalysisJob = vi.fn();
const embed = vi.fn(async () => [0.1, 0.2, 0.3]);

vi.mock("../../src/lib/note-chunk-indexer", () => ({
  indexNoteChunks,
}));

vi.mock("../../src/lib/llm", () => ({
  getChatProvider: vi.fn(() => ({ embed })),
}));

vi.mock("../../src/lib/note-analysis-jobs", () => ({
  queueNoteAnalysisJob,
  runNoteAnalysisJob,
}));

const { refreshNoteChunkIndex } = await import(
  "../../src/lib/note-chunk-refresh.js"
);

describe("refreshNoteChunkIndex", () => {
  beforeEach(() => {
    indexNoteChunks.mockReset();
    indexNoteChunks.mockResolvedValue(undefined);
    queueNoteAnalysisJob.mockReset();
    queueNoteAnalysisJob.mockResolvedValue({ jobId: null });
    runNoteAnalysisJob.mockReset();
    runNoteAnalysisJob.mockResolvedValue({ status: "completed", jobId: "job-1" });
    embed.mockClear();
  });

  it("indexes source/internal note content using title and contentText without rewriting note content", async () => {
    await refreshNoteChunkIndex({
      id: "note-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      title: "Imported Source",
      contentText: "fresh source text",
      deletedAt: null,
    });

    expect(indexNoteChunks).toHaveBeenCalledWith({
      note: {
        id: "note-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        title: "Imported Source",
        contentText: "fresh source text",
        deletedAt: null,
      },
      embed,
    });
  });

  it("queues best-effort freshness work instead of embedding on the write path", async () => {
    const { refreshNoteChunkIndexBestEffort } = await import(
      "../../src/lib/note-chunk-refresh.js"
    );

    await refreshNoteChunkIndexBestEffort(
      {
        id: "note-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        title: "Mutable Note",
        contentText: "fresh collaborative text",
        deletedAt: null,
      },
      { yjsStateVector: new Uint8Array([1, 2]) },
    );

    expect(queueNoteAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "note-1",
        contentText: "fresh collaborative text",
      }),
      expect.objectContaining({ yjsStateVector: new Uint8Array([1, 2]) }),
    );
    expect(indexNoteChunks).not.toHaveBeenCalled();
  });

  it("runs queued analysis inline by default to preserve API write freshness", async () => {
    const { refreshNoteChunkIndexBestEffort } = await import(
      "../../src/lib/note-chunk-refresh.js"
    );
    queueNoteAnalysisJob.mockResolvedValue({ jobId: "job-1" });

    await refreshNoteChunkIndexBestEffort({
      id: "note-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      title: "API Note",
      contentText: "fresh body",
      deletedAt: null,
    });

    expect(runNoteAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        embed,
      }),
    );
  });
});
