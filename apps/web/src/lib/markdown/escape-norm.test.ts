import { describe, expect, it } from "vitest";

import { normalizeEscapes } from "./escape-norm";

describe("normalizeEscapes", () => {
  it.each([
    ["\\*foo\\*", "*foo*"],
    ["\\_bar\\_", "_bar_"],
    ["\\#heading", "#heading"],
    ["\\[a\\]\\(b\\)", "[a](b)"],
    ["회의 끝났\\.", "회의 끝났."],
    ["already normal", "already normal"],
    ["", ""],
    ["plain text without escapes", "plain text without escapes"],
    ["\\!important", "!important"],
    ["mixed \\* and _ ", "mixed * and _ "],
    ["\\`code\\`", "`code`"],
    ["double \\\\* should not collapse fully", "double \\* should not collapse fully"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeEscapes(input)).toBe(expected);
  });

  it("collapses \\n to a real newline", () => {
    expect(normalizeEscapes("first\\nsecond")).toBe("first\nsecond");
  });

  it("collapses \\t to a real tab", () => {
    expect(normalizeEscapes("col\\tcol")).toBe("col\tcol");
  });

  it("is idempotent on already-normal text", () => {
    const a = normalizeEscapes("hello");
    const b = normalizeEscapes(a);
    expect(b).toBe(a);
  });
});
