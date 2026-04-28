import { describe, expect, it } from "vitest";

import { generateSlug, isValidSlug } from "../../src/lib/mcp-slug";

describe("mcp slug helpers", () => {
  it("normalizes display names and suffixes collisions", () => {
    expect(generateSlug("My Linear", new Set())).toBe("my_linear");
    expect(generateSlug("My Linear", new Set(["my_linear"]))).toBe(
      "my_linear_2",
    );
  });

  it("validates worker-safe slugs", () => {
    expect(isValidSlug("linear_2")).toBe(true);
    expect(isValidSlug("Linear-2")).toBe(false);
    expect(isValidSlug("x".repeat(33))).toBe(false);
  });
});
