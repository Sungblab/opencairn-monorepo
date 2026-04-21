import { describe, it, expect } from "vitest";
import {
  plateValueToText,
  emptyEditorValue,
  parseEditorContent,
} from "./editor-utils";

describe("editor-utils", () => {
  it("plateValueToText flattens nested children", () => {
    const v = [
      { type: "h1", children: [{ text: "Title" }] },
      { type: "p", children: [{ text: "Body " }, { text: "end", bold: true }] },
    ];
    expect(plateValueToText(v)).toContain("Title");
    expect(plateValueToText(v)).toContain("Body end");
  });

  it("plateValueToText inserts space between sibling blocks (BM25 tokenization)", () => {
    const v = [
      { type: "p", children: [{ text: "Hello" }] },
      { type: "p", children: [{ text: "world" }] },
    ];
    // must NOT be "Helloworld"
    expect(plateValueToText(v)).toBe("Hello world");
  });

  it("plateValueToText handles non-array input", () => {
    expect(plateValueToText(null)).toBe("");
    expect(plateValueToText({ foo: "bar" })).toBe("");
    expect(plateValueToText(undefined)).toBe("");
  });

  it("plateValueToText caps recursion depth", () => {
    // Build a 100-deep nested children chain; should not stack-overflow and
    // should return "" (or the leaf text up to the cap).
    let node: unknown = { text: "deep" };
    for (let i = 0; i < 100; i++) node = { type: "x", children: [node] };
    expect(() => plateValueToText([node])).not.toThrow();
  });

  it("emptyEditorValue returns a single paragraph", () => {
    const v = emptyEditorValue();
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("p");
  });

  it("parseEditorContent handles null / invalid / array", () => {
    expect(parseEditorContent(null)).toEqual(emptyEditorValue());
    expect(parseEditorContent({ not: "array" })).toEqual(emptyEditorValue());
    const arr = [{ type: "p", children: [{ text: "x" }] }];
    expect(parseEditorContent(arr)).toEqual(arr);
  });
});
