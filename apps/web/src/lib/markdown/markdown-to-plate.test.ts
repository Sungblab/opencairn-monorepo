import { describe, expect, it } from "vitest";
import { markdownToPlate } from "./markdown-to-plate";

describe("markdownToPlate — GFM basics", () => {
  it("returns a single empty paragraph for empty input", () => {
    const result = markdownToPlate("");
    expect(result).toEqual([{ type: "p", children: [{ text: "" }] }]);
  });

  it("converts a heading", () => {
    const result = markdownToPlate("# Hello");
    expect(result[0]).toMatchObject({ type: "h1" });
    expect(result[0].children?.[0]?.text).toBe("Hello");
  });

  it("converts a paragraph", () => {
    const result = markdownToPlate("Hello world");
    expect(result[0]).toMatchObject({ type: "p" });
    expect(result[0].children?.[0]?.text).toBe("Hello world");
  });

  it("converts a fenced code block (no lang)", () => {
    const result = markdownToPlate("```\nconst x = 1;\n```");
    expect(result[0]).toMatchObject({ type: "code_block" });
  });

  it("converts a bulleted list", () => {
    const result = markdownToPlate("- a\n- b");
    // @platejs/markdown produces indent-based list elements; both items
    // surface as paragraphs with `listStyleType: "disc"`.
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("does not throw on malformed markdown", () => {
    expect(() => markdownToPlate("# Heading\n```js\nunterminated")).not.toThrow();
  });
});
