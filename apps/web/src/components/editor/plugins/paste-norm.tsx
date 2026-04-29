"use client";
import { createPlatePlugin } from "platejs/react";
import { normalizeEscapes } from "@/lib/markdown/escape-norm";

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

export const PasteNormPlugin = createPlatePlugin({
  key: "paste-norm",
}).extend(() => ({
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
}));
