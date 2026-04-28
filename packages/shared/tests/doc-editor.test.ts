import { describe, it, expect } from "vitest";
import {
  docEditorCommandSchema,
  docEditorRequestSchema,
  docEditorSseEventSchema,
} from "../src/doc-editor";

describe("doc-editor zod", () => {
  it("only accepts the v1 command set", () => {
    expect(docEditorCommandSchema.safeParse("improve").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("translate").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("summarize").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("expand").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("cite").success).toBe(false);
    expect(docEditorCommandSchema.safeParse("factcheck").success).toBe(false);
  });

  it("requires non-empty selection text", () => {
    const ok = docEditorRequestSchema.safeParse({
      selection: { blockId: "b1", start: 0, end: 5, text: "hello" },
      documentContextSnippet: "some surrounding context",
    });
    expect(ok.success).toBe(true);

    const bad = docEditorRequestSchema.safeParse({
      selection: { blockId: "b1", start: 0, end: 0, text: "" },
      documentContextSnippet: "",
    });
    expect(bad.success).toBe(false);
  });

  it("doc_editor_result hunks carry blockId + range + replacement", () => {
    const ev = docEditorSseEventSchema.safeParse({
      type: "doc_editor_result",
      output_mode: "diff",
      payload: {
        hunks: [
          {
            blockId: "b1",
            originalRange: { start: 0, end: 5 },
            originalText: "hello",
            replacementText: "Hello there",
          },
        ],
        summary: "1 sentence rewritten",
      },
    });
    expect(ev.success).toBe(true);
  });
});
