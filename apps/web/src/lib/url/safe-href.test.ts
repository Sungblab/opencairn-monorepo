import { describe, expect, it } from "vitest";
import { safeHref } from "./safe-href";

describe("safeHref", () => {
  it("allows http and https", () => {
    expect(safeHref("https://example.com/x")).toBe("https://example.com/x");
    expect(safeHref("http://example.com/x")).toBe("http://example.com/x");
  });

  it("allows mailto", () => {
    expect(safeHref("mailto:alice@example.com")).toBe("mailto:alice@example.com");
  });

  it("allows schemeless / relative paths", () => {
    expect(safeHref("/notes/abc")).toBe("/notes/abc");
    expect(safeHref("#fragment")).toBe("#fragment");
    expect(safeHref("?q=1")).toBe("?q=1");
  });

  it("blocks javascript:", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("JavaScript:alert(1)")).toBe("#");
    expect(safeHref("  javascript:alert(1)  ")).toBe("#");
    expect(safeHref("\tjavascript:alert(1)")).toBe("#");
  });

  it("blocks data:", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("blocks vbscript: and file:", () => {
    expect(safeHref("vbscript:msgbox(1)")).toBe("#");
    expect(safeHref("file:///etc/passwd")).toBe("#");
  });

  it("returns # for non-string input", () => {
    expect(safeHref(undefined)).toBe("#");
    expect(safeHref(null)).toBe("#");
    expect(safeHref(123)).toBe("#");
    expect(safeHref({})).toBe("#");
  });

  it("returns # for empty string", () => {
    expect(safeHref("")).toBe("#");
    expect(safeHref("   ")).toBe("#");
  });
});
