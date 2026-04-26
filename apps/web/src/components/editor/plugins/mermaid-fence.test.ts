import { describe, expect, it, vi } from "vitest";
import {
  isUndoOfMermaidConversion,
  runMermaidFenceConversion,
} from "./mermaid-fence";

describe("isUndoOfMermaidConversion", () => {
  it("returns true when ops contain a remove_node of a mermaid element", () => {
    const ops = [
      { type: "remove_node", node: { type: "mermaid" } },
      { type: "insert_node", node: { type: "code_block" } },
    ];
    expect(isUndoOfMermaidConversion(ops)).toBe(true);
  });

  it("returns false for ordinary text/insert/set ops", () => {
    const ops = [
      { type: "insert_text", text: "m" },
      { type: "set_node" },
    ];
    expect(isUndoOfMermaidConversion(ops)).toBe(false);
  });

  it("returns false when removed node is not mermaid", () => {
    const ops = [{ type: "remove_node", node: { type: "code_block" } }];
    expect(isUndoOfMermaidConversion(ops)).toBe(false);
  });
});

describe("runMermaidFenceConversion", () => {
  function makeEditor(opts: {
    children: unknown[];
    operations: { type: string; node?: { type?: string } }[];
  }) {
    return {
      children: opts.children,
      operations: opts.operations,
      tf: {
        replaceNodes: vi.fn(),
      },
    };
  }

  it("converts a top-level code_block with lang=mermaid into a mermaid element", () => {
    const editor = makeEditor({
      operations: [{ type: "insert_text" }],
      children: [
        {
          type: "code_block",
          lang: "mermaid",
          children: [
            { type: "code_line", children: [{ text: "graph TD" }] },
            { type: "code_line", children: [{ text: "A --> B" }] },
          ],
        },
      ],
    });
    runMermaidFenceConversion(editor);
    expect(editor.tf.replaceNodes).toHaveBeenCalledTimes(1);
    expect(editor.tf.replaceNodes).toHaveBeenCalledWith(
      { type: "mermaid", code: "graph TD\nA --> B", children: [{ text: "" }] },
      { at: [0] },
    );
  });

  it("does NOT re-convert after an undo of its own transformation", () => {
    // Slate replays the inverse of replaceNodes: remove_node(mermaid) +
    // insert_node(code_block). Without the guard, onChange would re-convert.
    const editor = makeEditor({
      operations: [
        { type: "remove_node", node: { type: "mermaid" } },
        { type: "insert_node", node: { type: "code_block" } },
      ],
      children: [
        {
          type: "code_block",
          lang: "mermaid",
          children: [{ type: "code_line", children: [{ text: "graph TD" }] }],
        },
      ],
    });
    runMermaidFenceConversion(editor);
    expect(editor.tf.replaceNodes).not.toHaveBeenCalled();
  });

  it("ignores non-mermaid code_blocks", () => {
    const editor = makeEditor({
      operations: [{ type: "insert_text" }],
      children: [
        {
          type: "code_block",
          lang: "ts",
          children: [{ type: "code_line", children: [{ text: "x" }] }],
        },
      ],
    });
    runMermaidFenceConversion(editor);
    expect(editor.tf.replaceNodes).not.toHaveBeenCalled();
  });

  it("accepts capitalized 'Mermaid' lang", () => {
    const editor = makeEditor({
      operations: [{ type: "insert_text" }],
      children: [
        {
          type: "code_block",
          lang: "Mermaid",
          children: [{ type: "code_line", children: [{ text: "x" }] }],
        },
      ],
    });
    runMermaidFenceConversion(editor);
    expect(editor.tf.replaceNodes).toHaveBeenCalledTimes(1);
  });
});
