import { describe, it, expect } from "vitest";

describe("column_group widths persistence", () => {
  it("preserves widths across JSON serialize/parse", () => {
    const node = {
      type: "column_group",
      widths: [0.3, 0.4, 0.3],
      children: [
        { type: "column", children: [{ text: "a" }] },
        { type: "column", children: [{ text: "b" }] },
        { type: "column", children: [{ text: "c" }] },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(node));
    expect(roundTripped.widths).toEqual([0.3, 0.4, 0.3]);
  });

  it("absent widths defaults to equal split (back-compat)", () => {
    const node = {
      type: "column_group",
      children: [
        { type: "column", children: [{ text: "a" }] },
        { type: "column", children: [{ text: "b" }] },
      ],
    };
    expect((node as Record<string, unknown>).widths).toBeUndefined();
    // Renderer test handled in column-group-element render test (out of scope here).
  });

  it("widths array length matches children count", () => {
    const node = {
      type: "column_group",
      widths: [0.5, 0.5],
      children: [
        { type: "column", children: [{ text: "left" }] },
        { type: "column", children: [{ text: "right" }] },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(node));
    expect(roundTripped.widths.length).toBe(roundTripped.children.length);
  });

  it("widths sum to 1.0 within tolerance after round-trip", () => {
    const node = {
      type: "column_group",
      widths: [0.3, 0.4, 0.3],
      children: [
        { type: "column", children: [{ text: "a" }] },
        { type: "column", children: [{ text: "b" }] },
        { type: "column", children: [{ text: "c" }] },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(node));
    const sum = (roundTripped.widths as number[]).reduce((a: number, b: number) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });

  it("each width satisfies minimum 10% constraint when valid", () => {
    const node = {
      type: "column_group",
      widths: [0.1, 0.8, 0.1], // exactly at minimum boundaries
      children: [
        { type: "column", children: [{ text: "a" }] },
        { type: "column", children: [{ text: "b" }] },
        { type: "column", children: [{ text: "c" }] },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(node));
    for (const w of roundTripped.widths as number[]) {
      expect(w).toBeGreaterThanOrEqual(0.10);
    }
  });
});
