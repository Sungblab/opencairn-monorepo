const FENCE_RE = /^[\t ]*```save-suggestion\s*\n([\s\S]*?)\n[\t ]*```\s*$/gm;
const MAX_PAYLOAD_BYTES = 16 * 1024;

export type SaveSuggestion = {
  title: string;
  body_markdown: string;
};

// Returns the LAST recognized save-suggestion fence parsed from `text`,
// or null if none is well-formed. We intentionally return only the last
// match — the system prompt asks for at most one fence; multiple fences
// usually mean the LLM repeated itself, and the latest is most likely
// the intended one.
export function extractSaveSuggestion(text: string): SaveSuggestion | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  // Reset lastIndex because the regex carries state across calls.
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    last = match[1];
  }
  if (last === null) return null;

  const trimmed = last.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PAYLOAD_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const title = obj.title;
  const body = obj.body_markdown;
  if (
    typeof title !== "string" ||
    typeof body !== "string" ||
    title.trim().length === 0 ||
    body.trim().length === 0 ||
    title.length > 512 ||
    body.length > MAX_PAYLOAD_BYTES
  ) {
    return null;
  }
  return { title, body_markdown: body };
}
