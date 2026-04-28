import { describe, it, expect } from "vitest";
import {
  docEditorClaimSchema,
  docEditorCommandSchema,
  docEditorCommentPayloadSchema,
  docEditorRequestSchema,
  docEditorSseEventSchema,
} from "../src/doc-editor";

describe("doc-editor zod", () => {
  it("accepts the v2 command set", () => {
    expect(docEditorCommandSchema.safeParse("improve").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("translate").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("summarize").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("expand").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("cite").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("factcheck").success).toBe(true);
    expect(docEditorCommandSchema.safeParse("outline").success).toBe(false);
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

  it("validates factcheck claims and comment payload events", () => {
    const claim = {
      blockId: "b1",
      range: { start: 10, end: 42 },
      verdict: "supported",
      evidence: [
        {
          source_id: "00000000-0000-0000-0000-000000000001",
          snippet: "The paper reports 84% accuracy on MNIST.",
          url_or_ref: "https://example.com/paper",
          confidence: 0.82,
        },
      ],
      note: "Two independent sources confirm.",
    };
    expect(docEditorClaimSchema.safeParse(claim).success).toBe(true);
    expect(
      docEditorClaimSchema.safeParse({ ...claim, verdict: "maybe" }).success,
    ).toBe(false);
    expect(
      docEditorCommentPayloadSchema.safeParse({ claims: [] }).success,
    ).toBe(false);

    const result = docEditorSseEventSchema.safeParse({
      type: "doc_editor_result",
      output_mode: "comment",
      payload: { claims: [claim] },
    });
    expect(result.success).toBe(true);

    const inserted = docEditorSseEventSchema.safeParse({
      type: "factcheck_comments_inserted",
      commentIds: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(inserted.success).toBe(true);
  });
});
