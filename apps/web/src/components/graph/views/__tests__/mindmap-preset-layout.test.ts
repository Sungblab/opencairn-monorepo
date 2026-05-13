import { describe, expect, it } from "vitest";
import type { ViewNode } from "@opencairn/shared";
import type { GroundedEdge } from "../../grounded-types";
import { layoutMindmapPreset } from "../mindmap-preset-layout";

const nodes = (items: Array<Partial<ViewNode> & { id: string; name: string }>) =>
  items as ViewNode[];

const edges = (items: Array<Partial<GroundedEdge> & {
  sourceId: string;
  targetId: string;
}>) => items as GroundedEdge[];

describe("layoutMindmapPreset", () => {
  it("keeps chain-shaped data from collapsing into one straight line", () => {
    const out = layoutMindmapPreset(
      nodes([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ]),
      edges([
        { sourceId: "a", targetId: "b", relationType: "next", weight: 1 },
        { sourceId: "b", targetId: "c", relationType: "next", weight: 1 },
        { sourceId: "c", targetId: "d", relationType: "next", weight: 1 },
      ]),
      "a",
    );

    expect(new Set([...out.positions.values()].map((pos) => Math.round(pos.y))).size)
      .toBeGreaterThan(2);
  });

  it("uses the requested root when it exists", () => {
    const out = layoutMindmapPreset(
      nodes([
        { id: "a", name: "A", degree: 1 },
        { id: "b", name: "B", degree: 2 },
      ]),
      edges([{ sourceId: "a", targetId: "b", relationType: "next", weight: 1 }]),
      "a",
    );

    expect(out.rootId).toBe("a");
  });

  it("places disconnected nodes on an outer ring instead of dropping them", () => {
    const out = layoutMindmapPreset(
      nodes([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ]),
      edges([{ sourceId: "a", targetId: "b", relationType: "next", weight: 1 }]),
      "a",
    );

    expect(out.positions.has("c")).toBe(true);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});
