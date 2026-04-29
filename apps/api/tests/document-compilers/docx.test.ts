import { describe, it, expect } from "vitest";
import { compileDocx } from "../../src/lib/document-compilers/docx.js";

const FIXTURE = {
  format: "docx" as const,
  title: "Synthesis Doc",
  abstract: "An overview of the topic.",
  sections: [
    { title: "Intro", content: "<p>Hello [1] world.</p>", source_ids: ["abc12345"] },
    { title: "Methods", content: "<p>Methodology details.</p>", source_ids: [] },
  ],
  bibliography: [
    { cite_key: "src:abc12345", author: "Doe", title: "Paper", year: 2024, url: "https://x", source_id: "abc12345" },
  ],
  template: "report" as const,
};

describe("compileDocx", () => {
  it("produces a non-empty Buffer with DOCX zip magic bytes", async () => {
    const buf = await compileDocx(FIXTURE);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("includes the expected DOCX zip entries in the binary payload", async () => {
    // DOCX is a ZIP; the body XML is DEFLATE-compressed, so payload text
    // (e.g. the title) is not available as plaintext. Entry filenames in
    // the ZIP local-file headers ARE plaintext, so we assert on those —
    // their presence proves docx produced a real OOXML container.
    const buf = await compileDocx(FIXTURE);
    const haystack = buf.toString("utf-8");
    expect(haystack).toContain("word/document.xml");
    expect(haystack).toContain("[Content_Types].xml");
  });
});
