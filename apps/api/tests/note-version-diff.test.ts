import { describe, expect, it } from "vitest";

import { diffPlateValues } from "../src/lib/note-version-diff";

describe("note version diff", () => {
  it("marks added and removed blocks", () => {
    const diff = diffPlateValues({
      fromVersion: 1,
      toVersion: "current",
      before: [{ type: "p", children: [{ text: "old" }] }],
      after: [
        { type: "p", children: [{ text: "old" }] },
        { type: "p", children: [{ text: "new" }] },
      ],
    });

    expect(diff.summary.addedBlocks).toBe(1);
    expect(diff.blocks.map((b) => b.status)).toEqual(["unchanged", "added"]);
  });

  it("marks changed text with insert and delete parts", () => {
    const diff = diffPlateValues({
      fromVersion: 2,
      toVersion: "current",
      before: [{ type: "p", children: [{ text: "hello old world" }] }],
      after: [{ type: "p", children: [{ text: "hello new world" }] }],
    });

    expect(diff.summary.changedBlocks).toBe(1);
    expect(diff.blocks[0]?.textDiff).toEqual([
      { kind: "equal", text: "hello " },
      { kind: "delete", text: "old" },
      { kind: "insert", text: "new" },
      { kind: "equal", text: " world" },
    ]);
  });
});
