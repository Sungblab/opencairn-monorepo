import { describe, expect, it } from "vitest";
import {
  buildForceGraphData,
  getGraphLabelFontSize,
  getGraphLabel,
  getGraphNeighborhood,
  truncateGraphLabel,
} from "../force-graph-model";
import type { GroundedGraphResponse } from "../../grounded-types";

const snap: GroundedGraphResponse = {
  viewType: "graph",
  layout: "fcose",
  rootId: null,
  truncated: false,
  totalConcepts: 3,
  nodes: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Very long Korean English concept name that should not flood the graph",
      description: "root",
      degree: 12,
      noteCount: 3,
      firstNoteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Child",
      description: "",
      degree: 1,
      noteCount: 1,
      firstNoteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Isolated",
      description: "",
      degree: 0,
      noteCount: 0,
      firstNoteId: null,
    },
  ],
  edges: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      sourceId: "11111111-1111-4111-8111-111111111111",
      targetId: "22222222-2222-4222-8222-222222222222",
      relationType: "co-mentioned",
      weight: 1,
      support: {
        claimId: null,
        evidenceBundleId: null,
        supportScore: 0,
        citationCount: 0,
        status: "missing",
      },
    },
  ],
};

describe("force graph model", () => {
  it("maps grounded graph data into draggable force graph nodes and links", () => {
    const graph = buildForceGraphData(snap);

    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes[0]?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(graph.nodes[0]?.isHub).toBe(true);
    expect(graph.nodes[1]?.isHub).toBe(false);
    expect(graph.nodes.some((node) => node.kind === "note")).toBe(true);
    expect(graph.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        edgeId: "44444444-4444-4444-8444-444444444444",
        source: "11111111-1111-4111-8111-111111111111",
        target: "22222222-2222-4222-8222-222222222222",
        relationType: "co-mentioned",
      }),
      expect.objectContaining({
        edgeId: "note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111",
        relationType: "source-note",
      }),
    ]));
    expect(graph.topNodeIds.has("11111111-1111-4111-8111-111111111111")).toBe(
      true,
    );
  });

  it("truncates labels before drawing them on canvas", () => {
    expect(truncateGraphLabel("short")).toBe("short");
    expect(truncateGraphLabel("abcdefghijklmnopqrstuvwxyz", 12)).toBe(
      "abcdefghijk...",
    );
  });

  it("shows labels only for high-signal, hovered, selected, or zoomed-in nodes", () => {
    const node = buildForceGraphData(snap).nodes[1];

    expect(
      getGraphLabel(node, {
        zoom: 0.45,
        topNodeIds: new Set(),
        hoveredNodeId: null,
        selectedNodeId: null,
        neighborIds: new Set(),
      }),
    ).toBe("");

    expect(
      getGraphLabel(node, {
        zoom: 0.45,
        topNodeIds: new Set(),
        hoveredNodeId: node.id,
        selectedNodeId: null,
        neighborIds: new Set(),
      }),
    ).toBe("Child");

    expect(
      getGraphLabel(node, {
        zoom: 1.1,
        topNodeIds: new Set(),
        hoveredNodeId: null,
        selectedNodeId: null,
        neighborIds: new Set(),
      }),
    ).toBe("Child");
  });

  it("keeps labels small at every zoom level", () => {
    expect(getGraphLabelFontSize({ zoom: 0.4, important: false })).toBe(0);
    expect(getGraphLabelFontSize({ zoom: 0.4, important: true })).toBe(8);
    expect(getGraphLabelFontSize({ zoom: 1.2, important: false })).toBe(8);
    expect(getGraphLabelFontSize({ zoom: 2.4, important: true })).toBe(9);
  });

  it("builds one-hop highlight sets for hover and selected states", () => {
    const neighborhood = getGraphNeighborhood(snap.edges, "11111111-1111-4111-8111-111111111111");

    expect([...neighborhood.nodeIds].sort()).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect([...neighborhood.edgeIds]).toEqual([
      "44444444-4444-4444-8444-444444444444",
    ]);
  });
});
