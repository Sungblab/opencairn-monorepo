import { beforeEach, describe, expect, it, vi } from "vitest";

const indexNoteChunks = vi.fn();
const embed = vi.fn(async () => [0.1, 0.2, 0.3]);

vi.mock("../../src/lib/note-chunk-indexer", () => ({
  indexNoteChunks,
}));

vi.mock("../../src/lib/llm", () => ({
  getChatProvider: vi.fn(() => ({ embed })),
}));

const { refreshNoteChunkIndex } = await import(
  "../../src/lib/note-chunk-refresh.js"
);

describe("refreshNoteChunkIndex", () => {
  beforeEach(() => {
    indexNoteChunks.mockReset();
    indexNoteChunks.mockResolvedValue(undefined);
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
});
