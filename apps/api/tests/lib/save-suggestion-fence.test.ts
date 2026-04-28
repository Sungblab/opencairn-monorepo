import { describe, it, expect } from "vitest";
import { extractSaveSuggestion } from "../../src/lib/save-suggestion-fence.js";

describe("extractSaveSuggestion", () => {
  it("returns null when no fence", () => {
    expect(extractSaveSuggestion("just a normal answer")).toBeNull();
  });

  it("parses a single fence", () => {
    const text = [
      "Here's the answer.",
      "",
      "```save-suggestion",
      `{"title": "Pivot table notes", "body_markdown": "# Notes\\n\\n- bullet"}`,
      "```",
      "",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toEqual({
      title: "Pivot table notes",
      body_markdown: "# Notes\n\n- bullet",
    });
  });

  it("returns the LAST fence when multiple appear", () => {
    const text = [
      "```save-suggestion",
      `{"title": "first", "body_markdown": "f"}`,
      "```",
      "```save-suggestion",
      `{"title": "second", "body_markdown": "s"}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)?.title).toBe("second");
  });

  it("returns null on malformed JSON", () => {
    const text = [
      "```save-suggestion",
      `{"title": "broken", body_markdown:}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toBeNull();
  });

  it("returns null when shape is invalid (missing body_markdown)", () => {
    const text = [
      "```save-suggestion",
      `{"title": "no body"}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toBeNull();
  });

  it("returns null when title or body is empty", () => {
    const text = [
      "```save-suggestion",
      `{"title": "", "body_markdown": "hi"}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toBeNull();
  });

  it("returns null when payload exceeds 16KB", () => {
    const big = "a".repeat(20_000);
    const text = [
      "```save-suggestion",
      `{"title": "big", "body_markdown": "${big}"}`,
      "```",
    ].join("\n");
    expect(extractSaveSuggestion(text)).toBeNull();
  });
});
