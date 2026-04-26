import { describe, it, expect } from "vitest";
import {
  ViewType,
  ViewLayout,
  ViewNode,
  ViewEdge,
  ViewSpec,
  GraphViewResponse,
} from "../src/api-types";

describe("ViewSpec schema", () => {
  it("accepts a minimal valid mindmap ViewSpec", () => {
    const result = ViewSpec.parse({
      viewType: "mindmap",
      layout: "dagre",
      rootId: "11111111-1111-4111-8111-111111111111",
      nodes: [
        { id: "11111111-1111-4111-8111-111111111111", name: "Root" },
      ],
      edges: [],
    });
    expect(result.viewType).toBe("mindmap");
  });

  it("rejects unknown viewType", () => {
    expect(() => ViewType.parse("bogus")).toThrow();
  });

  it("accepts eventYear in nodes", () => {
    const node = ViewNode.parse({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Trans",
      eventYear: 2017,
    });
    expect(node.eventYear).toBe(2017);
  });

  it("rejects edges with weight > 1", () => {
    expect(() =>
      ViewEdge.parse({
        sourceId: "11111111-1111-4111-8111-111111111111",
        targetId: "22222222-2222-4222-8222-222222222222",
        relationType: "uses",
        weight: 2,
      }),
    ).toThrow();
  });

  it("caps nodes at 500", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      name: `n${i}`,
    }));
    expect(() =>
      ViewSpec.parse({
        viewType: "graph",
        layout: "fcose",
        rootId: null,
        nodes: tooMany,
        edges: [],
      }),
    ).toThrow();
  });

  it("GraphViewResponse extends ViewSpec with truncated/totalConcepts", () => {
    const result = GraphViewResponse.parse({
      viewType: "graph",
      layout: "fcose",
      rootId: null,
      nodes: [],
      edges: [],
      truncated: false,
      totalConcepts: 0,
    });
    expect(result.truncated).toBe(false);
    expect(result.totalConcepts).toBe(0);
  });

  it("ViewLayout enum exposes all 4 layouts", () => {
    expect(ViewLayout.options).toEqual([
      "fcose",
      "dagre",
      "preset",
      "cose-bilkent",
    ]);
  });
});
