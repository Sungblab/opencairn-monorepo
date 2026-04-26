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
// Infinite-loop safety: `onChange` fires again after `replaceNodes`, but
// `isMermaidCodeBlock` checks `type === 'code_block'`; the new node has
// `type === 'mermaid'`, so the guard is false and the loop exits cleanly.
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

export const MermaidFencePlugin = createPlatePlugin({
  key: "mermaid-fence",
  handlers: {
    onChange: ({ editor }) => {
      // Walk top-level only — mermaid blocks shouldn't appear inside lists
      // or tables, and recursion would slow the per-keystroke handler.
      const value = editor.children as unknown as Array<{
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
    },
  },
});
