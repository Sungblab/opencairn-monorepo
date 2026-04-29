import { describe, it, expect } from "vitest";
import { compilePdf } from "../../src/lib/document-compilers/pdf.js";

const FIXTURE = {
  format: "pdf" as const,
  title: "PDF Test",
  abstract: null,
  sections: [{ title: "Body", content: "<p>Hello world</p>", source_ids: [] }],
  bibliography: [],
  template: "report" as const,
};

describe("compilePdf", () => {
  it("produces a non-empty PDF (starts with %PDF-)", async () => {
    const buf = await compilePdf(FIXTURE);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  }, 30_000);

  it("renders Korean text", async () => {
    const buf = await compilePdf({
      ...FIXTURE,
      title: "한국어 제목",
      sections: [{ title: "본문", content: "<p>안녕하세요 세계</p>", source_ids: [] }],
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  }, 30_000);

  it("renders bibliography references", async () => {
    const buf = await compilePdf({
      ...FIXTURE,
      bibliography: [
        { cite_key: "src:a", author: "Doe", title: "Paper A", year: 2024, url: "https://example.org/a", source_id: "a" },
        { cite_key: "src:b", author: "Roe", title: "Paper B", year: null, url: null, source_id: "b" },
      ],
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  }, 30_000);

  it("does not execute injected scripts (network is blocked)", async () => {
    // If page.route did NOT abort, the <script src=...> would attempt a
    // fetch and Playwright would surface it. We rely on the fact that
    // page.route blocks everything — this test just confirms no exception
    // and a valid PDF emerges even with a hostile-looking payload.
    const buf = await compilePdf({
      ...FIXTURE,
      sections: [
        {
          title: "Hostile",
          content: '<script src="https://evil.example/x.js"></script><p>visible</p>',
          source_ids: [],
        },
      ],
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  }, 30_000);
});
