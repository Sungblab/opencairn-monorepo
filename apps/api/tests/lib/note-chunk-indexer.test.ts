import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    insertValues.mockReset();
    deleteWhere.mockReset();
    dbMock.transaction.mockClear();
  });

  it("builds MIME-agnostic chunk rows from note contentText and metadata", async () => {
    insertValues.mockResolvedValue(undefined);

    await indexNoteChunks({
      note: {
        id: "note-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        title: "Attention Paper",
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
        contextText: "Page: Attention Paper\nSection path: Paper",
        contentText: "Alpha beta gamma.",
        deletedAt: null,
        embedding: [0.1, 0.2, 0.3],
      }),
    ]);
  });

  it("requests chunk embeddings in parallel before writing rows", async () => {
    insertValues.mockResolvedValue(undefined);
    const started: string[] = [];
    const releases: Array<(value: number[]) => void> = [];
    const embed = vi.fn(
      (text: string) =>
        new Promise<number[]>((resolve) => {
          started.push(text);
          releases.push(resolve);
        }),
    );

    const indexing = indexNoteChunks({
      note: {
        id: "note-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        title: "Parallel Embed",
        contentText: "# Paper\nFirst paragraph.\n\nSecond paragraph.",
        deletedAt: null,
      },
      embed,
      maxChars: 24,
    });

    await Promise.resolve();
    expect(started).toEqual([
      "Page: Parallel Embed\nSection path: Paper\n\nFirst paragraph.",
      "Page: Parallel Embed\nSection path: Paper\n\nSecond paragraph.",
    ]);
    expect(dbMock.transaction).not.toHaveBeenCalled();

    releases[0]?.([0.1]);
    releases[1]?.([0.2]);
    await indexing;

    expect(insertValues).toHaveBeenCalledWith([
      expect.objectContaining({ chunkIndex: 0, embedding: [0.1] }),
      expect.objectContaining({ chunkIndex: 1, embedding: [0.2] }),
    ]);
  });
});
