import { describe, it, expect } from "vitest";
import {
  readBlockSelection,
  type BlockSelectionEditor,
} from "./read-block-selection";

function makeEditor(
  block: { id?: unknown },
  text: string,
): BlockSelectionEditor {
  return {
    api: {
      block: () => [block, [0]],
      string: () => text,
    },
  };
}

describe("readBlockSelection", () => {
  it("returns blockId + full block range when the cursor sits in a block", () => {
    const result = readBlockSelection(makeEditor({ id: "b1" }, "hello world"));
    expect(result).toEqual({
      blockId: "b1",
      start: 0,
      end: 11,
      text: "hello world",
    });
  });

  it("returns null when no block is at the selection", () => {
    const editor: BlockSelectionEditor = {
      api: { block: () => undefined, string: () => "" },
    };
    expect(readBlockSelection(editor)).toBeNull();
  });

  it("returns null when the block has no id", () => {
    expect(readBlockSelection(makeEditor({}, "hello"))).toBeNull();
  });

  it("returns null when the block has a non-string id", () => {
    expect(readBlockSelection(makeEditor({ id: 42 }, "hello"))).toBeNull();
  });

  it("returns null on an empty block (zod min(1) would reject anyway)", () => {
    expect(readBlockSelection(makeEditor({ id: "b1" }, ""))).toBeNull();
  });

  it("returns null when the block text exceeds the 4000-char ceiling", () => {
    const long = "x".repeat(4001);
    expect(readBlockSelection(makeEditor({ id: "b1" }, long))).toBeNull();
  });

  it("accepts text exactly at the 4000-char ceiling", () => {
    const max = "x".repeat(4000);
    const result = readBlockSelection(makeEditor({ id: "b1" }, max));
    expect(result?.end).toBe(4000);
  });
});
