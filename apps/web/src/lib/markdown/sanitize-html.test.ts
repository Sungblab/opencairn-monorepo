import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize-html";

describe("sanitizeHtml", () => {
  it("removes <script> tags", () => {
    expect(sanitizeHtml("<script>alert(1)</script>hi")).toBe("hi");
  });

  it("removes inline event handlers", () => {
    expect(sanitizeHtml('<a href="x" onclick="bad()">link</a>')).not.toContain(
      "onclick",
    );
  });

  it("removes <iframe>", () => {
    expect(sanitizeHtml("<iframe src=evil></iframe>x")).toBe("x");
  });

  it("preserves common GFM markup", () => {
    const out = sanitizeHtml("<strong>bold</strong> <em>i</em>");
    expect(out).toContain("<strong>");
    expect(out).toContain("<em>");
  });

  it("preserves whitelisted SVG", () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>';
    const out = sanitizeHtml(svg);
    expect(out).toContain("<svg");
    expect(out).toContain("<circle");
  });

  it("strips javascript: protocol from href", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });
});
