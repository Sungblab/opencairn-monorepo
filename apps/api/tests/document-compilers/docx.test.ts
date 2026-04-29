import { describe, it, expect } from "vitest";
import * as JSZip from "jszip";
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

describe("compileDocx — content correctness", () => {
  async function unzipDocumentXml(buf: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buf);
    const file = zip.file("word/document.xml");
    if (!file) throw new Error("word/document.xml missing");
    return file.async("string");
  }

  it("does not emit empty paragraphs for empty section content", async () => {
    const out = await compileDocx({
      ...FIXTURE,
      sections: [{ title: "Empty", content: "", source_ids: [] }],
    });
    const xml = await unzipDocumentXml(out);
    // The section heading paragraph must exist (contains "Empty"),
    // and there should be no run with literal empty <w:t> right after it
    // beyond what docx itself emits structurally. Easiest assertion:
    // count "<w:t" hits should equal expected non-empty pieces.
    expect(xml).toContain("Empty");
    expect(xml).not.toMatch(/<w:t[^>]*>\s*<\/w:t>/);
  });

  it("renders abstract text when provided", async () => {
    const out = await compileDocx({ ...FIXTURE });
    const xml = await unzipDocumentXml(out);
    expect(xml).toContain("An overview of the topic.");
  });

  it("decodes HTML entities into plain characters", async () => {
    const out = await compileDocx({
      ...FIXTURE,
      sections: [
        { title: "Entities", content: "<p>Tom &amp; Jerry &lt;b&gt; tag &amp; safe</p>", source_ids: [] },
      ],
    });
    const xml = await unzipDocumentXml(out);
    // After decode + DOCX XML escaping, ampersand becomes &amp; in the
    // OOXML payload (DOCX itself escapes to XML), but the bare-entity
    // form "&amp;amp;" should NOT appear (which would be a double-encode).
    expect(xml).not.toContain("&amp;amp;");
    expect(xml).not.toContain("&amp;lt;");
    expect(xml).toContain("Tom");
    expect(xml).toContain("Jerry");
  });

  it("omits the references section when bibliography is empty", async () => {
    const out = await compileDocx({ ...FIXTURE, bibliography: [] });
    const xml = await unzipDocumentXml(out);
    expect(xml).not.toContain("References");
  });

  it("omits the abstract block when abstract is null", async () => {
    const out = await compileDocx({ ...FIXTURE, abstract: null });
    const xml = await unzipDocumentXml(out);
    expect(xml).not.toContain("Abstract");
  });
});
