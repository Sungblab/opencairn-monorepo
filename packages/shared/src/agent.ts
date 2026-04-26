import { z } from "zod";

/**
 * Plan 2D — `save_suggestion` SSE chunk payload schema.
 *
 * Emitted by the agent runtime when it detects the conversation has
 * produced content worth persisting as a note. The web client renders
 * the existing `<SaveSuggestionCard>` and, on Save, runs the markdown
 * through `markdownToPlate` and inserts into the active note.
 *
 * `source_message_id` is optional because the stub generator (env-flagged)
 * doesn't track real message ids in the same shape.
 */
export const saveSuggestionSchema = z.object({
  title: z.string().min(1).max(200),
  body_markdown: z.string().min(1),
  source_message_id: z.string().uuid().optional(),
});

export type SaveSuggestion = z.infer<typeof saveSuggestionSchema>;
