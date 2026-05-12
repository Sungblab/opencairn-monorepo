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

const AGENT_DIRECTIVE_LANGUAGES = new Set([
  "save-suggestion",
  "agent-file",
  "agent-actions",
]);

function parseFence(line: string):
  | { marker: "`" | "~"; length: number; language: string }
  | null {
  const match = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(line);
  if (!match) return null;
  const fence = match[1] ?? "";
  const info = (match[2] ?? "").trim();
  return {
    marker: fence[0] === "~" ? "~" : "`",
    length: fence.length,
    language: info.split(/\s+/)[0]?.toLowerCase() ?? "",
  };
}

function isClosingFence(
  line: string,
  fence: { marker: "`" | "~"; length: number },
): boolean {
  const marker = fence.marker === "`" ? "`" : "~";
  const re = new RegExp(`^ {0,3}${marker}{${fence.length},}\\s*$`);
  return re.test(line);
}

export function stripAgentDirectiveFences(markdown: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let directiveFence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of lines) {
    if (directiveFence) {
      if (isClosingFence(line, directiveFence)) {
        directiveFence = null;
      }
      continue;
    }

    const opening = parseFence(line);
    if (opening && AGENT_DIRECTIVE_LANGUAGES.has(opening.language)) {
      directiveFence = opening;
      continue;
    }

    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const stripSaveSuggestionFences = stripAgentDirectiveFences;
