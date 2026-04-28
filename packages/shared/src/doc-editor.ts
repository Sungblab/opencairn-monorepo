import { z } from "zod";

// v1 command set — Plan 11B Phase A. /cite + /factcheck land in Phase B
// when ResearchAgent.hybrid_search is exposed as a builtin tool.
export const docEditorCommandSchema = z.enum([
  "improve",
  "translate",
  "summarize",
  "expand",
]);
export type DocEditorCommand = z.infer<typeof docEditorCommandSchema>;

export const docEditorSelectionSchema = z.object({
  blockId: z.string().min(1).max(64),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string().min(1).max(4000),
});
export type DocEditorSelection = z.infer<typeof docEditorSelectionSchema>;

export const docEditorRequestSchema = z
  .object({
    selection: docEditorSelectionSchema,
    language: z.string().min(2).max(20).optional(),
    documentContextSnippet: z.string().max(4000).default(""),
  })
  .refine((v) => v.selection.end > v.selection.start, {
    message: "selection range invalid",
  });
export type DocEditorRequest = z.infer<typeof docEditorRequestSchema>;

export const docEditorHunkSchema = z.object({
  blockId: z.string().min(1),
  originalRange: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
  originalText: z.string(),
  replacementText: z.string(),
});
export type DocEditorHunk = z.infer<typeof docEditorHunkSchema>;

export const docEditorDiffPayloadSchema = z.object({
  hunks: z.array(docEditorHunkSchema).min(1),
  summary: z.string().max(280),
});
export type DocEditorDiffPayload = z.infer<typeof docEditorDiffPayloadSchema>;

// SSE wire format. `delta` carries token-by-token text only (UI may
// optionally render a running preview); the authoritative result is
// `doc_editor_result`. `cost` mirrors chat.ts.
export const docEditorSseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({
    type: z.literal("doc_editor_result"),
    output_mode: z.enum(["diff"]),
    payload: docEditorDiffPayloadSchema,
  }),
  z.object({
    type: z.literal("cost"),
    tokens_in: z.number().int().nonnegative(),
    tokens_out: z.number().int().nonnegative(),
    cost_krw: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum([
      "llm_failed",
      "selection_race",
      "command_unknown",
      "internal",
    ]),
    message: z.string(),
  }),
  z.object({ type: z.literal("done") }),
]);
export type DocEditorSseEvent = z.infer<typeof docEditorSseEventSchema>;
