import { describe, it, expect } from "vitest";
import { deriveSlug, isValidSlug, RESERVED_SLUGS } from "./slug";

describe("deriveSlug", () => {
  it("lowercases ASCII and hyphenates whitespace", () => {
    expect(deriveSlug("My Team")).toBe("my-team");
  });

  it("replaces underscores with hyphens", () => {
    expect(deriveSlug("Foo_Bar_Baz")).toBe("foo-bar-baz");
  });

  it("collapses runs of hyphens", () => {
    expect(deriveSlug("a -- b")).toBe("a-b");
  });

  it("strips non-ASCII (including Korean)", () => {
    expect(deriveSlug("한글 Team")).toBe("team");
  });

  it("returns empty string when input reduces to nothing", () => {
    expect(deriveSlug("한글만")).toBe("");
  });

  it("truncates to 40 chars", () => {
    const long = "a".repeat(80);
    expect(deriveSlug(long).length).toBe(40);
  });

  it("trims leading/trailing hyphens", () => {
    expect(deriveSlug("-- hi --")).toBe("");
  });

  it("returns empty for reserved output", () => {
    expect(deriveSlug("api")).toBe("");
  });

  it("returns empty for too-short output", () => {
    expect(deriveSlug("a")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("accepts valid slugs", () => {
    expect(isValidSlug("my-team")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("a1b2c3")).toBe(true);
  });

  it("rejects uppercase, spaces, underscores, unicode", () => {
    expect(isValidSlug("My-Team")).toBe(false);
    expect(isValidSlug("my team")).toBe(false);
    expect(isValidSlug("my_team")).toBe(false);
    expect(isValidSlug("팀")).toBe(false);
  });

  it("rejects too short or too long", () => {
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("a".repeat(41))).toBe(false);
  });

  it("rejects reserved slugs", () => {
    for (const r of RESERVED_SLUGS) expect(isValidSlug(r)).toBe(false);
  });
});
