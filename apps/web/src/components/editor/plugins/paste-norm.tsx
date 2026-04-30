"use client";
import { createPlatePlugin } from "platejs/react";
import { normalizeEscapes } from "@/lib/markdown/escape-norm";
import { toEmbedUrl } from "@/lib/embeds/to-embed-url";

// Plan 2E Phase A — Paste-time escape normalization.
//
// Why: Chat AI output, Slack/Discord exports, and Notion ZIP markdown often
// arrive with double-escaped markdown (`\*foo\*`, `\#heading`). Without this
// plugin those land in the editor as literal text, never as inline marks.
//
// What: A `text/plain` parser whose `transformData` runs `normalizeEscapes`
// over the clipboard string before any other deserializer sees it. Plate
// dispatches parsers by `format`, so HTML pastes (which already carry
// structural marks) are untouched. Mirrors the strategy in
// @platejs/markdown's parser, including the `text/html` short-circuit so we
// don't fight a richer paste.
//
// Code-block safety: rendered code blocks paste as `<pre><code>` (HTML), so
// they never reach this text/plain path. For raw text/plain pastes we accept
// that escaped backslashes inside what the user *intends* as a code block
// will be normalized — there's no structural signal to detect that case
// before deserialization. If the user wants the literal `\*`, they can hit
// Cmd-Z; the trade-off is correct in the common case.
//
// Plan 2E Phase B — Embed URL paste detection (Task 1.5).
// Extended: after escape normalization, if pasted plain text is a single
// URL matching one of the 3 supported embed providers, insert an `embed`
// node instead of plain text. Skipped inside code_block / code_line.

/** Returns true if the current selection is inside a code block or code line.
 *
 * We avoid importing `slate` directly (it's a transitive dep, not declared
 * in web's package.json). Instead we walk the path of the current selection
 * and check each ancestor node's type.
 */
export function isInsideCodeBlockOrLine(editor: {
  selection: { anchor?: { path?: number[] } } | null;
  children: Array<{ type?: string; children?: unknown[] }>;
}): boolean {
  const path = editor.selection?.anchor?.path;
  if (!path || path.length === 0) return false;
  // Walk from the root down the selection path, checking each node's type.
  // A code_block appears at depth 0; a code_line at depth 1.
  let current: unknown = { children: editor.children };
  for (const idx of path) {
    const node = current as { children?: unknown[]; type?: string };
    const child = node.children?.[idx] as { type?: string; children?: unknown[] } | undefined;
    if (!child) break;
    if (child.type === "code_block" || child.type === "code_line") return true;
    current = child;
  }
  return false;
}

interface PlateEditorForPaste {
  selection: { anchor?: { path?: number[] } } | null;
  children: Array<{ type?: string; children?: unknown[] }>;
  tf: {
    insertNodes: (nodes: unknown, options?: unknown) => void;
  };
  [key: string]: unknown;
}

/**
 * Attempt to insert an embed node for a pasted URL.
 * Returns true if an embed was inserted (caller should stop processing).
 */
export function tryInsertEmbed(
  editor: PlateEditorForPaste,
  plainText: string,
): boolean {
  const trimmed = plainText.trim();
  // Must be a single whitespace-free https?:// URL — no surrounding text
  if (!/^https?:\/\/\S+$/.test(trimmed)) return false;
  // Skip if cursor is inside a code block
  if (isInsideCodeBlockOrLine(editor)) return false;
  const resolution = toEmbedUrl(trimmed);
  if (!resolution) return false;
  editor.tf.insertNodes({
    type: "embed",
    provider: resolution.provider,
    url: trimmed,
    embedUrl: resolution.embedUrl,
    children: [{ text: "" }],
  });
  // Insert an empty paragraph after so the caret isn't trapped in the void.
  editor.tf.insertNodes({ type: "p", children: [{ text: "" }] });
  return true;
}

export const PasteNormPlugin = createPlatePlugin({
  key: "paste-norm",
})
  .extend(() => ({
    parser: {
      format: "text/plain",
      query: ({ dataTransfer }) => {
        // Defer to richer paste paths when present. If the clipboard carries
        // HTML, structural marks are already encoded — running our text-level
        // normalization on top would risk corrupting `<code>` text.
        if (dataTransfer.getData("text/html")) return false;
        return true;
      },
      transformData: ({ data }) => normalizeEscapes(data),
    },
  }))
  .extend(() => ({
    handlers: {
      onPaste: ({ editor, event }) => {
        // Plan 2E Phase B — embed URL auto-insertion.
        // Run before the text/plain parser pipeline. If the clipboard
        // carries only an embed URL (no HTML, no extra text), insert the
        // embed node and stop the event so the parser doesn't also insert
        // the raw URL as a paragraph.
        const dt = event.clipboardData;
        if (!dt) return;
        if (dt.getData("text/html")) return; // defer to HTML path
        const plainText = dt.getData("text/plain");
        if (!plainText) return;
        const inserted = tryInsertEmbed(
          editor as unknown as PlateEditorForPaste,
          plainText,
        );
        if (inserted) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  }));
