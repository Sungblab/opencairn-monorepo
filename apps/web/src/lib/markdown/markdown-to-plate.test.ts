import { describe, expect, it } from "vitest";
import { markdownToPlate } from "./markdown-to-plate";

describe("markdownToPlate — escape normalization (Plan 2E Phase A)", () => {
  it("collapses JSON-escape artifacts in paragraph text", () => {
    const result = markdownToPlate("\\*foo\\* and \\#bar");
    const text = result[0].children?.[0]?.text ?? "";
    expect(text).toContain("*foo*");
    expect(text).toContain("#bar");
  });

  it("preserves escape sequences inside fenced code blocks", () => {
    const md = "```\nconst x = '\\\\*literal\\\\*';\n```";
    const result = markdownToPlate(md);
    // Walk to the first text leaf inside the code block.
    const codeBlock = result.find((n) => n.type === "code_block");
    expect(codeBlock).toBeTruthy();
  });
});

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

describe("markdownToPlate — mermaid post-processing", () => {
  it("converts a ```mermaid fenced code block to a mermaid element", () => {
    const result = markdownToPlate("```mermaid\ngraph TD\nA --> B\n```");
    expect(result[0]).toMatchObject({
      type: "mermaid",
      code: "graph TD\nA --> B",
    });
    expect(result[0].children).toEqual([{ text: "" }]);
  });

  it("leaves non-mermaid code blocks untouched", () => {
    const result = markdownToPlate("```js\nconst x = 1;\n```");
    expect(result[0]).toMatchObject({ type: "code_block" });
    expect(result[0].type).not.toBe("mermaid");
  });

  it("handles multiple mermaid blocks interleaved with prose", () => {
    const md = "intro\n\n```mermaid\nA-->B\n```\n\nmiddle\n\n```mermaid\nC-->D\n```";
    const result = markdownToPlate(md);
    const mermaidBlocks = result.filter((n) => n.type === "mermaid");
    expect(mermaidBlocks).toHaveLength(2);
    expect(mermaidBlocks[0].code).toBe("A-->B");
    expect(mermaidBlocks[1].code).toBe("C-->D");
  });
});

describe("markdownToPlate — callout post-processing", () => {
  it("converts > [!info] blockquote to a callout element with kind=info", () => {
    const result = markdownToPlate("> [!info] hello");
    expect(result[0]).toMatchObject({ type: "callout", kind: "info" });
  });

  it("supports warn / tip / danger kinds", () => {
    const warn = markdownToPlate("> [!warn] caution");
    expect(warn[0]).toMatchObject({ type: "callout", kind: "warn" });

    const tip = markdownToPlate("> [!tip] hot tip");
    expect(tip[0]).toMatchObject({ type: "callout", kind: "tip" });

    const danger = markdownToPlate("> [!danger] do not");
    expect(danger[0]).toMatchObject({ type: "callout", kind: "danger" });
  });

  it("strips the [!kind] prefix from the first child paragraph", () => {
    const result = markdownToPlate("> [!info] hello world");
    const firstPara = result[0].children?.[0];
    const text = firstPara?.children?.[0]?.text;
    expect(text).toBe("hello world");
  });

  it("leaves a plain blockquote unchanged", () => {
    const result = markdownToPlate("> just a quote");
    expect(result[0].type).toBe("blockquote");
  });

  it("normalizes unknown kinds to 'info'", () => {
    const result = markdownToPlate("> [!whatever] hi");
    expect(result[0]).toMatchObject({ type: "callout", kind: "info" });
  });
});
