// Plan 2D — Tailwind class tokens shared between the editor's read view
// and the chat message renderer so blockquotes, code, tables, etc. look
// identical in both places. Keep this file dependency-free.

export const proseClasses = {
  /** Block-level paragraph spacing — applied at the renderer container. */
  body: "prose prose-sm dark:prose-invert max-w-none",
  /** Code block wrapper (NOT inline code). */
  codeBlock:
    "rounded-md border border-[color:var(--border)] bg-[color:var(--bg-muted)] text-xs font-mono leading-relaxed overflow-x-auto",
  /** Inline code mark. */
  codeInline:
    "rounded bg-[color:var(--bg-muted)] px-1 py-0.5 text-[0.85em] font-mono",
  /** Blockquote (default — no callout prefix). */
  blockquote:
    "border-l-2 border-[color:var(--border)] pl-3 italic text-[color:var(--fg-muted)]",
  /** GFM table wrapper. */
  table:
    "border-collapse text-sm [&_th]:border [&_th]:px-3 [&_th]:py-1 [&_td]:border [&_td]:px-3 [&_td]:py-1",
  /** Mermaid diagram container. */
  mermaidContainer:
    "my-2 flex items-center justify-center rounded border border-[color:var(--border)] bg-[color:var(--bg-base)] p-2",
  /** Callout per-kind border classes. */
  calloutBorder: {
    info: "border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-950/30",
    warn: "border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950/30",
    tip: "border-l-4 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
    danger: "border-l-4 border-red-400 bg-red-50 dark:bg-red-950/30",
  },
} as const;

export type CalloutKind = keyof typeof proseClasses.calloutBorder;
