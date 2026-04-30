"use client";

import { createPlatePlugin } from "platejs/react";

// Plan 2E Phase B-4 — Math UX triggers (scaffolding).
//
// Subsequent tasks (4.2–4.4) add:
//   - applyDollarInlineTrigger  ($expr$ → inline_equation)
//   - applyDollarBlockTrigger   ($$ on empty line → equation block)
//   - triggerMathShortcut       (Ctrl+Shift+M → inline_equation)
//
// Node types: "inline_equation" (InlineEquationPlugin key) and "equation"
// (EquationPlugin key) from @platejs/math. The texExpression attribute
// follows TEquationElement from @platejs/utils.

// ─── isInsideCodeContext ───────────────────────────────────────────────────────
// Walk the anchor path and check each ancestor's type for code_block/code_line.
// Avoids importing from `slate` (not a declared dependency).

export function isInsideCodeContext(editor: {
  selection: { anchor?: { path?: number[] } } | null;
  children: Array<{ type?: string; children?: unknown[] }>;
}): boolean {
  const path = editor.selection?.anchor?.path;
  if (!path || path.length === 0) return false;
  let current: unknown = { children: editor.children };
  for (const idx of path) {
    const node = current as { children?: unknown[]; type?: string };
    const child = node.children?.[idx] as
      | { type?: string; children?: unknown[] }
      | undefined;
    if (!child) break;
    if (child.type === "code_block" || child.type === "code_line") return true;
    current = child;
  }
  return false;
}

// ─── Plugin definition ────────────────────────────────────────────────────────

export const mathTriggerPlugin = createPlatePlugin({
  key: "math-trigger",
  handlers: {
    // onChange: transforms are added in tasks 4.2 / 4.3
    onChange: ({ editor: _editor }) => {
      // intentionally empty — see tasks 4.2 / 4.3
    },
  },
});
