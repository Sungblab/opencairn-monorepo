import { describe, it, expect } from "vitest";
import { layoutTimeline } from "../timeline-layout";
import type { ViewNode } from "@opencairn/shared";

const nodes = (
  xs: Array<Partial<ViewNode> & { id: string; name: string }>,
) => xs as ViewNode[];

describe("layoutTimeline", () => {
  it("returns empty positions for empty input", () => {
    const out = layoutTimeline(nodes([]));
    expect(out.nodes).toEqual([]);
    expect(out.ticks).toEqual([]);
    expect(out.width).toBeGreaterThan(0);
  });

  it("uses eventYear when available, otherwise falls back to createdAt", () => {
    const out = layoutTimeline(
      nodes([
        { id: "a", name: "Trans", eventYear: 2017 },
        { id: "b", name: "BERT", eventYear: 2018 },
      ]),
    );
    const xa = out.nodes.find((n) => n.id === "a")!.x;
    const xb = out.nodes.find((n) => n.id === "b")!.x;
    expect(xa).toBeLessThan(xb);
  });

  it("x-coordinates are monotonically non-decreasing in input order if sorted", () => {
    const out = layoutTimeline(
      nodes([
        { id: "a", name: "1", eventYear: 1990 },
        { id: "b", name: "2", eventYear: 2000 },
        { id: "c", name: "3", eventYear: 2010 },
      ]),
    );
    const xs = out.nodes.map((n) => n.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    }
  });

  it("ticks span min/max year", () => {
    const out = layoutTimeline(
      nodes([
        { id: "a", name: "1", eventYear: 1990 },
        { id: "b", name: "2", eventYear: 2010 },
      ]),
    );
    expect(out.ticks.length).toBeGreaterThan(0);
    const tickYears = out.ticks.map((t) => t.label);
    expect(tickYears[0]).toContain("1990");
    expect(tickYears[tickYears.length - 1]).toContain("2010");
  });

  it("excludes undated concepts instead of stacking them at the midpoint", () => {
    const out = layoutTimeline(
      nodes([
        { id: "a", name: "dated", eventYear: 2017 },
        { id: "b", name: "undated" },
      ]),
    );

    expect(out.nodes.map((node) => node.id)).toEqual(["a"]);
    expect(out.omittedCount).toBe(1);
  });

  it("assigns separate lanes to concepts in the same year", () => {
    const out = layoutTimeline(
      nodes([
        { id: "a", name: "same 1", eventYear: 2026 },
        { id: "b", name: "same 2", eventYear: 2026 },
        { id: "c", name: "same 3", eventYear: 2026 },
      ]),
    );

    expect(new Set(out.nodes.map((node) => node.y)).size).toBe(3);
  });
});
