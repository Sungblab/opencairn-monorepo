"use client";

import { createPlatePlugin } from "platejs/react";

// Plan 2E Phase B-4 — Math UX triggers.
//
// This plugin wires three input methods for math nodes:
//   1. `$expr$` inline trigger — replaces the text with an inline_equation node
//   2. `$$` block trigger — converts an empty paragraph to an equation block
//   3. Ctrl+Shift+M shortcut — wraps the current selection as inline_equation
//
// All triggers are no-ops when the selection is inside a code_block / code_line.
// Node types: "inline_equation" (InlineEquationPlugin key) and "equation"
// (EquationPlugin key) — these come from @platejs/math, NOT "math_inline"/"math_block".
//
// The attribute that holds the LaTeX source is `texExpression` (matches TEquationElement).

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

// ─── applyDollarInlineTrigger ─────────────────────────────────────────────────
// Pattern: `$expr$` in the current text node → inline_equation node.
// Runs after every change. Looks for a `$...$` match in the current leaf text.

const INLINE_RE = /(?<!\\)\$([^\n$]+?)(?<!\\)\$/;

interface MathTriggerEditor {
  selection: {
    anchor?: { path?: number[]; offset?: number };
    focus?: { path?: number[]; offset?: number };
  } | null;
  children: Array<{
    type?: string;
    children?: unknown[];
  }>;
  tf: {
    delete: (opts: { at: { anchor: unknown; focus: unknown } }) => void;
    insertNodes: (node: unknown, opts?: unknown) => void;
    removeNodes: (opts: { at: number[] }) => void;
  };
}

/** Resolve a path in the editor's children tree, returning the leaf text node. */
function resolveLeaf(
  editor: MathTriggerEditor,
  path: number[],
): { text: string } | null {
  let node: unknown = { children: editor.children };
  for (const idx of path) {
    const n = node as { children?: unknown[] };
    if (!n.children) return null;
    node = n.children[idx];
    if (!node) return null;
  }
  const leaf = node as { text?: unknown };
  if (typeof leaf.text !== "string") return null;
  return leaf as { text: string };
}

function resolveNode(
  editor: { children: unknown[] },
  path: number[],
): unknown | null {
  let node: unknown = { children: editor.children };
  for (const idx of path) {
    const n = node as { children?: unknown[] };
    if (!n.children) return null;
    node = n.children[idx];
    if (!node) return null;
  }
  return node;
}

function samePath(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((idx, i) => idx === right[i]);
}

export function applyDollarInlineTrigger(editor: MathTriggerEditor): void {
  if (isInsideCodeContext(editor)) return;

  const anchorPath = editor.selection?.anchor?.path;
  if (!anchorPath) return;

  const leaf = resolveLeaf(editor, anchorPath);
  if (!leaf) return;
  const text = leaf.text;
  const match = INLINE_RE.exec(text);
  if (!match) return;

  const start = match.index;
  const end = start + match[0].length;
  const tex = match[1];

  // Delete the matched `$expr$` text range
  editor.tf.delete({
    at: {
      anchor: { path: anchorPath, offset: start },
      focus: { path: anchorPath, offset: end },
    },
  });
  // Insert inline_equation node at the deletion point
  editor.tf.insertNodes(
    {
      type: "inline_equation",
      texExpression: tex,
      children: [{ text: "" }],
    },
    { at: { path: anchorPath, offset: start } },
  );
}

// ─── applyDollarBlockTrigger ──────────────────────────────────────────────────
// Pattern: paragraph containing exactly `$$` → equation block node.
// Replaces the nearest paragraph ancestor so nested blocks (columns, etc.) work.

export function applyDollarBlockTrigger(editor: MathTriggerEditor): void {
  if (isInsideCodeContext(editor)) return;

  const anchorPath = editor.selection?.anchor?.path;
  if (!anchorPath || anchorPath.length === 0) return;

  let paragraphPath: number[] | null = null;
  let block:
    | { type?: string; children?: Array<{ text?: string }> }
    | null = null;
  for (let depth = anchorPath.length - 1; depth >= 1; depth -= 1) {
    const candidatePath = anchorPath.slice(0, depth);
    const candidate = resolveNode(editor, candidatePath) as
      | { type?: string; children?: Array<{ text?: string }> }
      | null;
    if (candidate?.type === "paragraph" || candidate?.type === "p") {
      paragraphPath = candidatePath;
      block = candidate;
      break;
    }
  }

  if (!paragraphPath || !block) return;
  // Accept both "paragraph" (generic) and "p" (Plate's internal key)
  if (!block.children || block.children.length !== 1) return;
  const text = block.children[0]?.text ?? "";
  if (text !== "$$") return;

  editor.tf.removeNodes({ at: paragraphPath });
  editor.tf.insertNodes(
    {
      type: "equation",
      texExpression: "",
      children: [{ text: "" }],
    },
    { at: paragraphPath },
  );
}

// ─── triggerMathShortcut ───────────────────────────────────────────────────────
// Ctrl+Shift+M (Mac: Cmd+Shift+M) wraps the current non-collapsed selection
// as an inline_equation node whose texExpression is the selected text.
// Wired into the plugin's onKeyDown in task 4.4.

interface ShortcutEditor {
  selection: {
    anchor?: { path?: number[]; offset?: number };
    focus?: { path?: number[]; offset?: number };
  } | null;
  children: Array<{ type?: string; children?: unknown[] }>;
  tf: {
    delete: (opts?: { at?: unknown }) => void;
    insertNodes: (node: unknown, opts?: unknown) => void;
  };
}

/** Extract the selected string from a within-leaf selection (same path). */
function getEditorString(
  editor: ShortcutEditor,
  anchor: { path: number[]; offset: number },
  focus: { path: number[]; offset: number },
): string | null {
  // Simple case: selection is within a single text leaf
  if (samePath(anchor.path, focus.path)) {
    let node: unknown = { children: editor.children };
    for (const idx of anchor.path) {
      const n = node as { children?: unknown[] };
      if (!n.children) return null;
      node = n.children[idx];
      if (!node) return null;
    }
    const leaf = node as { text?: string };
    if (typeof leaf.text !== "string") return null;
    const [start, end] =
      anchor.offset < focus.offset
        ? [anchor.offset, focus.offset]
        : [focus.offset, anchor.offset];
    return leaf.text.slice(start, end);
  }
  // Cross-leaf selections — not supported in this implementation;
  // returning null prevents the caller from deleting unsupported selections.
  return null;
}

export function triggerMathShortcut(editor: ShortcutEditor): void {
  const sel = editor.selection;
  if (!sel) return;
  const anchor = sel.anchor;
  const focus = sel.focus;
  if (!anchor?.path || !focus?.path) return;

  // Collapsed selection = no-op
  const anchorKey = `${anchor.path.join(",")},${anchor.offset ?? 0}`;
  const focusKey = `${focus.path.join(",")},${focus.offset ?? 0}`;
  if (anchorKey === focusKey) return;

  if (isInsideCodeContext(editor as never)) return;

  const fragment = getEditorString(
    editor,
    { path: anchor.path, offset: anchor.offset ?? 0 },
    { path: focus.path, offset: focus.offset ?? 0 },
  );
  if (fragment === null) return;

  editor.tf.delete({ at: sel });
  editor.tf.insertNodes({
    type: "inline_equation",
    texExpression: fragment,
    children: [{ text: "" }],
  });
}

// ─── Plugin definition ────────────────────────────────────────────────────────

export const mathTriggerPlugin = createPlatePlugin({
  key: "math-trigger",
  handlers: {
    onChange: ({ editor }) => {
      const e = editor as unknown as MathTriggerEditor;
      applyDollarInlineTrigger(e);
      applyDollarBlockTrigger(e);
    },
    onKeyDown: ({ editor, event }) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        triggerMathShortcut(editor as unknown as ShortcutEditor);
        return true;
      }
      return false;
    },
  },
});
