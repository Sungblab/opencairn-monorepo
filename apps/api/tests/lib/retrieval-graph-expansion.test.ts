import { describe, expect, it, vi, beforeEach } from "vitest";

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

const { expandGraphCandidates } = await import(
  "../../src/lib/retrieval-graph-expansion.js"
);

describe("expandGraphCandidates", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns no hits without seed notes", async () => {
    const hits = await expandGraphCandidates({
      workspaceId: "ws1",
      projectId: "p1",
      seedNoteIds: [],
    });

    expect(hits).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("queries only within workspace/project and bounded depth", async () => {
    execute.mockResolvedValueOnce({
      rows: [
        {
          note_id: "n2",
          chunk_id: "c2",
          title: "Related",
          heading_path: "Details",
          content_text: "related snippet",
          source_type: "manual",
          source_url: null,
          updated_at: "2026-05-03T00:00:00.000Z",
          graph_score: 0.8,
          graph_path: "Alpha --[depends-on]--> Beta",
        },
      ],
    });

    const hits = await expandGraphCandidates({
      workspaceId: "ws1",
      projectId: "p1",
      seedNoteIds: ["n1"],
      maxDepth: 2,
      limit: 10,
    });

    expect(hits).toEqual([
      expect.objectContaining({
        noteId: "n2",
        chunkId: "c2",
        title: "Related",
        headingPath: "Details",
        snippet: "related snippet",
        sourceType: "manual",
        graphScore: 0.8,
        graphPath: "Alpha --[depends-on]--> Beta",
      }),
    ]);
    const query = String(execute.mock.calls[0]?.[0]);
    expect(query).toContain("WITH RECURSIVE");
    expect(query).toContain("UNION ALL");
    expect(query).toContain("n.workspace_id");
    expect(query).toContain("n.project_id");
    expect(query).toContain("c.workspace_id");
    expect(query).toContain("c.project_id");
    expect(query).toContain("deleted_at IS NULL");
    const normalizedQuery = query.replace(/\s+/g, " ");
    expect(normalizedQuery).toContain("GROUP BY n.id, c.id");
    expect(normalizedQuery).not.toContain("GROUP BY n.id, c.id, n.title");
    expect(execute.mock.calls[0]?.[0].values).toContain("ws1");
    expect(execute.mock.calls[0]?.[0].values).toContain("p1");
    expect(execute.mock.calls[0]?.[0].values).toContain(2);
  });
});
