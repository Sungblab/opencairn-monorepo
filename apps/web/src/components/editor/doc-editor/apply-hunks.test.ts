import { describe, it, expect } from "vitest";
import type { Value } from "platejs";
import { applyHunksToValue } from "./apply-hunks";

describe("applyHunksToValue", () => {
  const initial: Value = [
    {
      type: "p",
      id: "b1",
      children: [{ text: "hello world" }],
    },
  ];

  it("replaces a substring inside a single text node", () => {
    const next = applyHunksToValue(initial, [
      {
        blockId: "b1",
        originalRange: { start: 0, end: 5 },
        originalText: "hello",
        replacementText: "Hi",
      },
    ]);
    expect(next).toEqual([
      { type: "p", id: "b1", children: [{ text: "Hi world" }] },
    ]);
  });

  it("returns input unchanged when the originalText no longer matches", () => {
    const stale: Value = [
      { type: "p", id: "b1", children: [{ text: "different content" }] },
    ];
    const next = applyHunksToValue(stale, [
      {
        blockId: "b1",
        originalRange: { start: 0, end: 5 },
        originalText: "hello",
        replacementText: "Hi",
      },
    ]);
    expect(next).toEqual(stale);
  });

  it("skips hunks targeting unknown block ids", () => {
    const next = applyHunksToValue(initial, [
      {
        blockId: "missing",
        originalRange: { start: 0, end: 5 },
        originalText: "hello",
        replacementText: "Hi",
      },
    ]);
    expect(next).toEqual(initial);
  });

  it("preserves marks on text outside the hunk range", () => {
    // Block: "hello world" where "world" is bold. We replace the "hello"
    // prefix — the bold mark on "world" must survive.
    const styled: Value = [
      {
        type: "p",
        id: "b1",
        children: [
          { text: "hello " },
          { text: "world", bold: true },
        ],
      },
    ];
    const next = applyHunksToValue(styled, [
      {
        blockId: "b1",
        originalRange: { start: 0, end: 5 },
        originalText: "hello",
        replacementText: "Hi",
      },
    ]);
    const block = next[0] as {
      children: Array<{ text: string; bold?: boolean }>;
    };
    const bolded = block.children.find((c) => c.bold === true);
    expect(bolded).toBeDefined();
    expect(bolded?.text).toBe("world");
  });

  it("returns the same array reference when no hunks apply", () => {
    const next = applyHunksToValue(initial, []);
    expect(next).toBe(initial);
  });

  it("applies multiple non-overlapping hunks in a single block", () => {
    // Block: "alpha bravo charlie" — two hunks, "alpha"→"A" and
    // "charlie"→"C". Right-to-left application keeps left offsets valid.
    const v: Value = [
      { type: "p", id: "b1", children: [{ text: "alpha bravo charlie" }] },
    ];
    const next = applyHunksToValue(v, [
      {
        blockId: "b1",
        originalRange: { start: 0, end: 5 },
        originalText: "alpha",
        replacementText: "A",
      },
      {
        blockId: "b1",
        originalRange: { start: 12, end: 19 },
        originalText: "charlie",
        replacementText: "C",
      },
    ]);
    const block = next[0] as { children: Array<{ text: string }> };
    expect(block.children.map((c) => c.text).join("")).toBe("A bravo C");
  });
});
