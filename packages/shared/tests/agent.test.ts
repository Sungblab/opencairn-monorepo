import { describe, expect, it } from "vitest";
import { saveSuggestionSchema, stripAgentDirectiveFences } from "../src/agent";

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

describe("stripAgentDirectiveFences", () => {
  it("removes internal agent directive fences from user-visible markdown", () => {
    const markdown = [
      "노트를 준비했습니다.",
      "",
      "```save-suggestion",
      '{"title":"요약","body_markdown":"# 요약"}',
      "```",
      "",
      "```agent-actions",
      '{"actions":[{"kind":"note.create","risk":"write","input":{"title":"요약"}}]}',
      "```",
      "",
      "```agent-file",
      '{"files":[{"filename":"summary.md","content":"# 요약"}]}',
      "```",
    ].join("\n");

    expect(stripAgentDirectiveFences(markdown)).toBe("노트를 준비했습니다.");
  });

  it("does not strip ordinary fenced code blocks", () => {
    const markdown = ["설명", "", "```ts", "const x = 1;", "```"].join("\n");

    expect(stripAgentDirectiveFences(markdown)).toBe(markdown);
  });

  it("removes an unclosed directive fence while a response is still streaming", () => {
    const markdown = [
      "노트를 준비했습니다.",
      "",
      "```agent-actions",
      '{"actions":[{"kind":"note.create"',
    ].join("\n");

    expect(stripAgentDirectiveFences(markdown)).toBe("노트를 준비했습니다.");
  });

  it("supports indented and tilde directive fences", () => {
    const markdown = [
      "파일을 준비했습니다.",
      "",
      "   ~~~agent-file",
      '{"files":[{"filename":"a.md","content":"x"}]}',
      "   ~~~",
    ].join("\n");

    expect(stripAgentDirectiveFences(markdown)).toBe("파일을 준비했습니다.");
  });
});
