import { describe, it, expect } from "vitest";
import {
  synthesisFormatValues,
  synthesisTemplateValues,
  createSynthesisRunSchema,
  synthesisStreamEventSchema,
} from "../src/synthesis-types";

describe("synthesis types", () => {
  it("accepts a valid create payload", () => {
    const r = createSynthesisRunSchema.safeParse({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      projectId: null,
      format: "latex",
      template: "korean_thesis",
      userPrompt: "Write the intro",
      explicitSourceIds: [],
      noteIds: [],
      autoSearch: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown format", () => {
    const r = createSynthesisRunSchema.safeParse({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      format: "pptx",
      template: "ieee",
      userPrompt: "x",
      explicitSourceIds: [],
      noteIds: [],
      autoSearch: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects userPrompt > 4000 chars", () => {
    const r = createSynthesisRunSchema.safeParse({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      format: "md",
      template: "report",
      userPrompt: "x".repeat(4001),
      explicitSourceIds: [],
      noteIds: [],
      autoSearch: false,
    });
    expect(r.success).toBe(false);
  });

  it("parses a 'done' SSE event", () => {
    const r = synthesisStreamEventSchema.safeParse({
      kind: "done",
      docUrl: "/api/synthesis/runs/abc/document?format=docx",
      format: "docx",
      sourceCount: 7,
      tokensUsed: 12430,
    });
    expect(r.success).toBe(true);
  });

  it("parses an 'error' SSE event", () => {
    const r = synthesisStreamEventSchema.safeParse({ kind: "error", code: "compile_failed" });
    expect(r.success).toBe(true);
  });

  it("enumerates all 4 formats and 5 templates", () => {
    expect([...synthesisFormatValues].sort()).toEqual(["docx", "latex", "md", "pdf"]);
    expect([...synthesisTemplateValues].sort()).toEqual(
      ["acm", "apa", "ieee", "korean_thesis", "report"],
    );
  });
});
