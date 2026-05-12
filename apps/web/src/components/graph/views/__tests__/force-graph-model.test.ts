import { describe, expect, it } from "vitest";
import {
  buildForceGraphData,
  getForceGraphNeighborhood,
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
      surfaceType: "source_membership",
      sourceNotes: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Lecture 2: Input_Output",
        },
      ],
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      sourceId: "11111111-1111-4111-8111-111111111111",
      targetId: "22222222-2222-4222-8222-222222222222",
      relationType: "wiki-link",
      weight: 1,
      support: {
        claimId: null,
        evidenceBundleId: null,
        supportScore: 0,
        citationCount: 0,
        status: "missing",
      },
      surfaceType: "wiki_link",
      displayOnly: true,
      sourceNoteLinks: [
        {
          sourceNoteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sourceTitle: "Lecture 2: Input_Output",
          targetNoteId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          targetTitle: "Lecture 3: Memory",
        },
      ],
    },
  ],
  noteLinks: [
    {
      sourceNoteId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sourceTitle: "Standalone source",
      targetNoteId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      targetTitle: "Standalone target",
    },
  ],
};

describe("force graph model", () => {
  it("maps grounded graph data into draggable force graph nodes and links", () => {
    const graph = buildForceGraphData(snap);

    expect(graph.nodes).toHaveLength(7);
    expect(graph.nodes[0]?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(graph.nodes[0]?.isHub).toBe(true);
    expect(graph.nodes[1]?.isHub).toBe(false);
    expect(graph.nodes.some((node) => node.kind === "note")).toBe(true);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Lecture 2: Input_Output",
          shortLabel: "Lecture 2: Input_Output",
          kind: "note",
          isHub: true,
        }),
      ]),
    );
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
      expect.objectContaining({
        edgeId: "note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:22222222-2222-4222-8222-222222222222",
        relationType: "source-note",
      }),
      expect.objectContaining({
        edgeId:
          "wiki-note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa->bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:55555555-5555-4555-8555-555555555555",
        source: "note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        target: "note:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        relationType: "wiki-link",
        surfaceType: "wiki_link",
      }),
      expect.objectContaining({
        edgeId:
          "wiki-note:cccccccc-cccc-4ccc-8ccc-cccccccccccc->dddddddd-dddd-4ddd-8ddd-dddddddddddd:project",
        source: "note:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        target: "note:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        relationType: "wiki-link",
        surfaceType: "wiki_link",
      }),
    ]));
    expect(graph.topNodeIds.has("11111111-1111-4111-8111-111111111111")).toBe(
      true,
    );
  });

  it("seeds non-linear radial positions before the force simulation starts", () => {
    const graph = buildForceGraphData(snap);
    const positioned = graph.nodes.filter(
      (node) => typeof node.x === "number" && typeof node.y === "number",
    );

    expect(positioned).toHaveLength(graph.nodes.length);
    const uniqueCoordinates = new Set(
      positioned.map(
        (node) => `${Math.round(node.x ?? 0)}:${Math.round(node.y ?? 0)}`,
      ),
    );
    expect(uniqueCoordinates.size).toBeGreaterThan(3);
    const [a, b, c] = positioned;
    const area =
      ((b?.x ?? 0) - (a?.x ?? 0)) * ((c?.y ?? 0) - (a?.y ?? 0)) -
      ((b?.y ?? 0) - (a?.y ?? 0)) * ((c?.x ?? 0) - (a?.x ?? 0));
    expect(Math.abs(area)).toBeGreaterThan(1);
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
    ).toBe("");

    expect(
      getGraphLabel(node, {
        zoom: 1.35,
        topNodeIds: new Set([node.id]),
        hoveredNodeId: null,
        selectedNodeId: null,
        neighborIds: new Set(),
      }),
    ).toBe("Child");

    expect(
      getGraphLabel(node, {
        zoom: 1.7,
        topNodeIds: new Set(),
        hoveredNodeId: null,
        selectedNodeId: null,
        neighborIds: new Set(),
      }),
    ).toBe("Child");
  });

  it("keeps labels small at every zoom level", () => {
    expect(getGraphLabelFontSize({ zoom: 0.4, important: false })).toBe(0);
    expect(getGraphLabelFontSize({ zoom: 0.4, important: true })).toBe(7);
    expect(getGraphLabelFontSize({ zoom: 1.2, important: false })).toBe(0);
    expect(getGraphLabelFontSize({ zoom: 1.7, important: false })).toBe(7);
    expect(getGraphLabelFontSize({ zoom: 2.4, important: true })).toBe(8);
  });

  it("builds one-hop highlight sets for hover and selected states", () => {
    const neighborhood = getGraphNeighborhood(snap.edges, "11111111-1111-4111-8111-111111111111");

    expect([...neighborhood.nodeIds].sort()).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect([...neighborhood.edgeIds].sort()).toEqual([
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ]);
  });

  it("builds one-hop highlight sets from rendered force links including note hubs", () => {
    const graph = buildForceGraphData(snap);
    const neighborhood = getForceGraphNeighborhood(
      graph.links,
      "note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect([...neighborhood.nodeIds].sort()).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "note:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
    expect([...neighborhood.edgeIds].sort()).toEqual([
      "note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:11111111-1111-4111-8111-111111111111",
      "note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:22222222-2222-4222-8222-222222222222",
      "wiki-note:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa->bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:55555555-5555-4555-8555-555555555555",
    ]);
  });

  it("renders note-to-note wiki links even when notes have no concept mapping", () => {
    const graph = buildForceGraphData(snap);
    const neighborhood = getForceGraphNeighborhood(
      graph.links,
      "note:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "note:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Standalone source",
          kind: "note",
        }),
        expect.objectContaining({
          id: "note:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          name: "Standalone target",
          kind: "note",
        }),
      ]),
    );
    expect([...neighborhood.nodeIds].sort()).toEqual([
      "note:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "note:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ]);
    expect([...neighborhood.edgeIds]).toEqual([
      "wiki-note:cccccccc-cccc-4ccc-8ccc-cccccccccccc->dddddddd-dddd-4ddd-8ddd-dddddddddddd:project",
    ]);
  });
});
