// Plan 2E Phase A — collapse JSON-escape artifacts in pasted markdown so the
// editor doesn't render literal `\*foo\*` from clipboard sources like Slack
// exports, Notion ZIPs, or AI chat output.
//
// The function is text-only. Callers (`paste-norm` plugin and
// `markdownToPlate`) are responsible for skipping it on text inside fenced
// code blocks — escape sequences inside <code> are intentional.

const MARKDOWN_SIGNIFICANT_ESCAPES = /\\([*_#\[\]()`!.])/g;

export function normalizeEscapes(input: string): string {
  if (!input) return input;

  // 1) Collapse `\X` for markdown-significant X (one backslash → none).
  //    Example: `\\*foo\\*` → `*foo*`.
  // 2) Then handle escaped whitespace literals (`\\n` / `\\t`) → real
  //    newline/tab. The order matters: doing whitespace first would convert
  //    a `\n` inside `\\#\\n` into a literal newline before step 1 inspects
  //    the leading `\\#`.
  return input
    .replace(MARKDOWN_SIGNIFICANT_ESCAPES, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}
