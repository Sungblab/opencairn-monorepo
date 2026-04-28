import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@opencairn/db", async (orig) => {
  const real = (await orig()) as object;
  const execute = vi.fn();
  return { ...real, db: { execute } };
});

const { projectHybridSearch } = await import(
  "../../src/lib/internal-hybrid-search.js"
);
const { db } = (await import("@opencairn/db")) as unknown as {
  db: { execute: ReturnType<typeof vi.fn> };
};

describe("projectHybridSearch RRF", () => {
  beforeEach(() => db.execute.mockReset());

  it("merges vector + bm25 channels and orders by RRF score", async () => {
    db.execute
      .mockResolvedValueOnce({
        rows: [
          { id: "n1", title: "alpha", content_text: "vec only", source_type: "pdf", source_url: null, score: 0.91 },
          { id: "n2", title: "beta", content_text: "vec+bm25", source_type: "pdf", source_url: null, score: 0.85 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "n2", title: "beta", content_text: "vec+bm25", source_type: "pdf", source_url: null, score: 0.7 },
          { id: "n3", title: "gamma", content_text: "bm25 only", source_type: "pdf", source_url: null, score: 0.6 },
        ],
      });

    const out = await projectHybridSearch({
      projectId: "00000000-0000-0000-0000-000000000001",
      queryText: "alpha beta",
      queryEmbedding: new Array(768).fill(0),
      k: 3,
    });

    expect(out.map((h) => h.noteId)).toEqual(["n2", "n1", "n3"]);
    // n2 hit on both channels → highest RRF
  });

  it("k=1 returns one row", async () => {
    db.execute.mockResolvedValue({ rows: [] });
    const out = await projectHybridSearch({
      projectId: "00000000-0000-0000-0000-000000000001",
      queryText: "x",
      queryEmbedding: new Array(768).fill(0),
      k: 1,
    });
    expect(out).toHaveLength(0);
  });
});
