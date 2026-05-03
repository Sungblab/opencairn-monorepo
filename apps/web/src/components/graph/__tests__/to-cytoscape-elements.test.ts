import { describe, it, expect } from "vitest";
import { toCytoscapeElements } from "../to-cytoscape-elements";
import type { GraphSnapshot } from "../graph-types";

const seed: GraphSnapshot = {
  nodes: [
    { id: "n1", name: "Alpha", description: "a", degree: 2, noteCount: 1, firstNoteId: "no1" },
    { id: "n2", name: "Beta", description: "b", degree: 1, noteCount: 0, firstNoteId: null },
  ],
  edges: [{ id: "e1", sourceId: "n1", targetId: "n2", relationType: "is-a", weight: 1 }],
  truncated: false,
  totalConcepts: 2,
  // Plan 5 Phase 2: GraphSnapshot is now `GraphViewResponse` (ViewSpec +
  // truncated/totalConcepts). Default-view fixture mirrors what the server
  // returns for `?view=graph` so toCytoscapeElements stays the unit under test.
  viewType: "graph",
  layout: "fcose",
  rootId: null,
};

describe("toCytoscapeElements", () => {
  it("emits one element per node + edge with discriminator", () => {
    const out = toCytoscapeElements(seed, { search: "", relation: null });
    expect(out).toHaveLength(3);
    expect(out.filter((e) => e.data.type === "node")).toHaveLength(2);
    expect(out.filter((e) => e.data.type === "edge")).toHaveLength(1);
  });

  it("filters nodes by search (case-insensitive substring)", () => {
    const out = toCytoscapeElements(seed, { search: "ALPHA", relation: null });
    const nodes = out.filter((e) => e.data.type === "node");
    expect(nodes.map((n) => n.data.id)).toEqual(["n1"]);
  });

  it("drops edges whose endpoints are filtered out (no dangling edges)", () => {
    const out = toCytoscapeElements(seed, { search: "alpha", relation: null });
    expect(out.filter((e) => e.data.type === "edge")).toHaveLength(0);
  });

  it("filters edges by relation while keeping all visible nodes", () => {
    const out = toCytoscapeElements(seed, { search: "", relation: "uses" });
    expect(out.filter((e) => e.data.type === "edge")).toHaveLength(0);
    expect(out.filter((e) => e.data.type === "node")).toHaveLength(2);
  });

  it("carries grounded edge support metadata into edge elements", () => {
    const out = toCytoscapeElements(
      {
        ...seed,
        edges: [
          {
            id: "e1",
            sourceId: "n1",
            targetId: "n2",
            relationType: "is-a",
            weight: 1,
            support: {
              claimId: "claim-1",
              evidenceBundleId: "bundle-1",
              supportScore: 0.42,
              citationCount: 2,
              status: "weak",
            },
          },
        ],
      },
      { search: "", relation: null },
    );
    const edge = out.find((e) => e.data.type === "edge");
    expect(edge?.data).toMatchObject({
      supportStatus: "weak",
      supportScore: 0.42,
      citationCount: 2,
      evidenceBundleId: "bundle-1",
    });
  });
});
