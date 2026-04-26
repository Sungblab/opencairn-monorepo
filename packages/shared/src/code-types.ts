import { z } from "zod";

export const canvasLanguages = ["python", "javascript", "html", "react"] as const;
export type CanvasLanguage = (typeof canvasLanguages)[number];

export const codeAgentRunRequestSchema = z.object({
  noteId: z.string().uuid(),
  prompt: z.string().min(1).max(4000),
  language: z.enum(canvasLanguages),
});
export type CodeAgentRunRequest = z.infer<typeof codeAgentRunRequestSchema>;

export const codeAgentFeedbackSchema = z.discriminatedUnion("kind", [
  z.object({ runId: z.string().uuid(), kind: z.literal("ok"), stdout: z.string().max(8 * 1024).optional() }),
  z.object({
    runId: z.string().uuid(),
    kind: z.literal("error"),
    error: z.string().max(4 * 1024),
    stdout: z.string().max(8 * 1024).optional(),
  }),
]);
export type CodeAgentFeedback = z.infer<typeof codeAgentFeedbackSchema>;

export const codeAgentTurnSchema = z.object({
  kind: z.enum(["generate", "fix"]),
  source: z.string().max(64 * 1024),
  explanation: z.string().max(2000).optional().nullable(),
  seq: z.number().int().min(0),
});
export type CodeAgentTurn = z.infer<typeof codeAgentTurnSchema>;

export const codeAgentEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued"), runId: z.string().uuid() }),
  z.object({ kind: z.literal("thought"), text: z.string() }),
  z.object({ kind: z.literal("token"), delta: z.string() }),
  z.object({ kind: z.literal("turn_complete"), turn: codeAgentTurnSchema }),
  z.object({ kind: z.literal("awaiting_feedback") }),
  z.object({
    kind: z.literal("done"),
    status: z.enum(["completed", "max_turns", "cancelled", "abandoned"]),
  }),
  z.object({ kind: z.literal("error"), code: z.string() }),
]);
export type CodeAgentEvent = z.infer<typeof codeAgentEventSchema>;

export const MAX_CANVAS_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MB
export const canvasOutputCreateSchema = z.object({
  noteId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  mimeType: z.enum(["image/png", "image/svg+xml"]),
});
export type CanvasOutputCreate = z.infer<typeof canvasOutputCreateSchema>;
