import { describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const deleteWhere = vi.fn();
const dbMock = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      delete: vi.fn(() => ({ where: deleteWhere })),
      insert: vi.fn(() => ({ values: insertValues })),
    }),
  ),
};

vi.mock("@opencairn/db", async (orig) => {
  const real = (await orig()) as object;
  return { ...real, db: dbMock };
});

const { indexNoteChunks } = await import("../../src/lib/note-chunk-indexer.js");

describe("indexNoteChunks", () => {
  it("builds MIME-agnostic chunk rows from note contentText and metadata", async () => {
    insertValues.mockResolvedValue(undefined);

    await indexNoteChunks({
      note: {
        id: "note-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        contentText: "# Paper\nAlpha beta gamma.",
        deletedAt: null,
      },
      embed: async () => [0.1, 0.2, 0.3],
      maxChars: 40,
    });

    expect(insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        workspaceId: "ws-1",
        projectId: "project-1",
        noteId: "note-1",
        chunkIndex: 0,
        headingPath: "Paper",
        contentText: "Alpha beta gamma.",
        deletedAt: null,
        embedding: [0.1, 0.2, 0.3],
      }),
    ]);
  });
});
