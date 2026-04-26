import { describe, expect, it } from "vitest";
import { saveSuggestionSchema } from "../src/agent";

describe("saveSuggestionSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "My note",
      body_markdown: "# Hello\n\nworld",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional source_message_id", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "T",
      body_markdown: "x",
      source_message_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "",
      body_markdown: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty body_markdown", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "T",
      body_markdown: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "x".repeat(201),
      body_markdown: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid source_message_id", () => {
    const result = saveSuggestionSchema.safeParse({
      title: "T",
      body_markdown: "x",
      source_message_id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});
