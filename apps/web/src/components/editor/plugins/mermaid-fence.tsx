"use client";
import { createPlatePlugin } from "platejs/react";

// Plan 2D Task 15 — When the user finishes a code block and its language is
// `mermaid`, transform it into our void Mermaid element. The rule fires
// in `change` (post-mutation) so the user can keep editing the block
// shell normally; only when they actually type ```mermaid does the
// swap occur.
//
// Why a custom plugin instead of `@platejs/autoformat`? Autoformat
// works on character triggers in a paragraph, not on whole-block lang
// changes. The simpler approach is a once-per-change scan that:
//   - finds top-level code_block nodes with lang === 'mermaid'
//   - replaces them with { type: 'mermaid', code: <joined lines> }
//
// The replacement is a single `replaceNodes` call so undo lands in one
// step, not three.
//
// Undo-trap safety: when the user undoes our conversion, Slate replays the
// inverse operations of `replaceNodes` — i.e., a `remove_node` of the just-
// inserted `mermaid` element followed by `insert_node` of the original
// `code_block`. Without a guard, `onChange` would re-fire and re-convert
// the restored code_block, making undo impossible. We detect this case by
// scanning `editor.operations` for a `remove_node` of a `mermaid` element
// and bail out for that change tick.
//
// Index stability: we do a 1:1 replacement (one code_block → one mermaid
// node), so indices do not shift after `replaceNodes`. The `i++` loop
// is safe.

interface CodeLineNode {
  children?: { text?: string }[];
}
interface CodeBlockNode {
  type: "code_block";
  lang?: string;
  children?: CodeLineNode[];
}

function isMermaidCodeBlock(n: { type?: string; lang?: string }): n is CodeBlockNode {
  return n.type === "code_block" && (n.lang === "mermaid" || n.lang === "Mermaid");
}

function joinLines(node: CodeBlockNode): string {
  return (node.children ?? [])
    .map((line) => line.children?.[0]?.text ?? "")
    .join("\n");
}

interface RemoveNodeOp {
  type: "remove_node";
  node?: { type?: string };
}

export function isUndoOfMermaidConversion(
  ops: readonly { type: string }[],
): boolean {
  return ops.some((op) => {
    if (op.type !== "remove_node") return false;
    const removed = (op as RemoveNodeOp).node;
    return removed?.type === "mermaid";
  });
}

interface MermaidFenceEditorShape {
  operations: readonly { type: string }[];
  children: readonly unknown[];
  tf: {
    replaceNodes: (
      node: { type: "mermaid"; code: string; children: { text: string }[] },
      options: { at: number[] },
    ) => void;
  };
}

export function runMermaidFenceConversion(editor: MermaidFenceEditorShape): void {
  // If this change tick is the inverse of our own conversion (the user
  // pressed undo), don't re-fire — that would create an undo trap where
  // the restored code_block is immediately re-converted.
  if (isUndoOfMermaidConversion(editor.operations)) return;

  // Walk top-level only — mermaid blocks shouldn't appear inside lists
  // or tables, and recursion would slow the per-keystroke handler.
  const value = editor.children as Array<{
    type?: string;
    lang?: string;
    children?: unknown[];
  }>;
  for (let i = 0; i < value.length; i++) {
    const n = value[i] as CodeBlockNode;
    if (isMermaidCodeBlock(n)) {
      const code = joinLines(n);
      editor.tf.replaceNodes(
        { type: "mermaid", code, children: [{ text: "" }] },
        { at: [i] },
      );
    }
  }
}

export const MermaidFencePlugin = createPlatePlugin({
  key: "mermaid-fence",
  handlers: {
    onChange: ({ editor }) => {
      runMermaidFenceConversion(editor as unknown as MermaidFenceEditorShape);
    },
  },
});
