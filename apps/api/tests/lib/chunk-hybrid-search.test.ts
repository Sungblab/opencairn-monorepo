import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@opencairn/db", async (orig) => {
  const real = (await orig()) as object;
  return {
    ...real,
    db: { execute },
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
      toString: () => strings.join("?"),
    }),
  };
});

const { projectChunkHybridSearch } = await import(
  "../../src/lib/chunk-hybrid-search.js"
);

describe("projectChunkHybridSearch", () => {
  it("merges vector and full-text rows with active chunk filtering", async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          {
            id: "c1",
            note_id: "n1",
            title: "T",
            heading_path: "Intro",
            content_text: "alpha",
            score: 0.9,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "c1",
            note_id: "n1",
            title: "T",
            heading_path: "Intro",
            content_text: "alpha",
            score: 0.7,
          },
        ],
      });

    const hits = await projectChunkHybridSearch({
      projectId: "p1",
      queryText: "alpha",
      queryEmbedding: [0.1, 0.2],
      k: 5,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      chunkId: "c1",
      noteId: "n1",
      title: "T",
      headingPath: "Intro",
      snippet: "alpha",
    });
    expect(String(execute.mock.calls[0]?.[0])).toContain("deleted_at IS NULL");
  });
});
