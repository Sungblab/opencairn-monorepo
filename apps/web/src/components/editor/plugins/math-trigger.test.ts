// Plan 2E Phase B-4 — Math trigger plugin tests.
//
// Uses minimal editor mocks (plain objects, no full Slate bootstrap) following
// the pattern established in paste-norm.test.ts and mermaid-fence.test.ts.
// node environment — pure logic tests, no DOM/React.

import { describe, expect, it, vi } from "vitest";
import {
  isInsideCodeContext,
  applyDollarInlineTrigger,
  applyDollarBlockTrigger,
} from "./math-trigger";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal paragraph editor with the given text and selection at end. */
function makeEditorWithText(text: string) {
  return {
    selection: {
      anchor: { path: [0, 0], offset: text.length },
      focus: { path: [0, 0], offset: text.length },
    },
    children: [
      { type: "paragraph", children: [{ text }] },
    ],
    tf: {
      delete: vi.fn(),
      insertNodes: vi.fn(),
      removeNodes: vi.fn(),
    },
  };
}

/** Build an editor whose root block is a code_block. */
function makeEditorWithCodeBlockText(text: string) {
  return {
    selection: {
      anchor: { path: [0, 0, 0], offset: text.length },
      focus: { path: [0, 0, 0], offset: text.length },
    },
    children: [
      {
        type: "code_block",
        children: [{ type: "code_line", children: [{ text }] }],
      },
    ],
    tf: {
      delete: vi.fn(),
      insertNodes: vi.fn(),
      removeNodes: vi.fn(),
    },
  };
}

// ─── Task 4.1 — isInsideCodeContext ───────────────────────────────────────────

describe("isInsideCodeContext", () => {
  it("returns true when selection is in code_block", () => {
    const editor = makeEditorWithCodeBlockText("hello") as never;
    expect(isInsideCodeContext(editor)).toBe(true);
  });

  it("returns false in a paragraph", () => {
    const editor = makeEditorWithText("hi") as never;
    expect(isInsideCodeContext(editor)).toBe(false);
  });

  it("returns false when no selection", () => {
    const editor = {
      selection: null,
      children: [{ type: "paragraph", children: [{ text: "" }] }],
    };
    expect(isInsideCodeContext(editor)).toBe(false);
  });
});

// ─── Task 4.2 — applyDollarInlineTrigger ─────────────────────────────────────

describe("applyDollarInlineTrigger", () => {
  it("converts $x^2$ into an inline_equation node", () => {
    const text = "equation $x^2$ inline";
    const editor = makeEditorWithText(text);
    applyDollarInlineTrigger(editor as never);
    expect(editor.tf.delete).toHaveBeenCalledTimes(1);
    expect(editor.tf.insertNodes).toHaveBeenCalledTimes(1);
    expect(editor.tf.insertNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "inline_equation",
        texExpression: "x^2",
      }),
      expect.anything(),
    );
  });

  it("does nothing when only one $ is present", () => {
    const editor = makeEditorWithText("price $5 USD");
    applyDollarInlineTrigger(editor as never);
    expect(editor.tf.delete).not.toHaveBeenCalled();
    expect(editor.tf.insertNodes).not.toHaveBeenCalled();
  });

  it("does nothing inside a code block", () => {
    const editor = makeEditorWithCodeBlockText("$x^2$");
    applyDollarInlineTrigger(editor as never);
    expect(editor.tf.delete).not.toHaveBeenCalled();
    expect(editor.tf.insertNodes).not.toHaveBeenCalled();
  });

  it("ignores escaped \\$", () => {
    const editor = makeEditorWithText("escaped \\$x^2\\$ pair");
    applyDollarInlineTrigger(editor as never);
    expect(editor.tf.delete).not.toHaveBeenCalled();
    expect(editor.tf.insertNodes).not.toHaveBeenCalled();
  });

  it("does nothing when selection is null", () => {
    const editor = {
      selection: null,
      children: [{ type: "paragraph", children: [{ text: "$x^2$" }] }],
      tf: {
        delete: vi.fn(),
        insertNodes: vi.fn(),
        removeNodes: vi.fn(),
      },
    };
    applyDollarInlineTrigger(editor as never);
    expect(editor.tf.delete).not.toHaveBeenCalled();
  });
});

// ─── Task 4.3 — applyDollarBlockTrigger ──────────────────────────────────────

describe("applyDollarBlockTrigger", () => {
  it("converts a paragraph containing only `$$` to an empty equation block", () => {
    const editor = makeEditorWithText("$$");
    applyDollarBlockTrigger(editor as never);
    expect(editor.tf.removeNodes).toHaveBeenCalledWith({ at: [0] });
    expect(editor.tf.insertNodes).toHaveBeenCalledWith(
      expect.objectContaining({ type: "equation", texExpression: "" }),
      expect.objectContaining({ at: [0] }),
    );
  });

  it("ignores `$$` inside a paragraph with other text", () => {
    const editor = makeEditorWithText("foo $$ bar");
    applyDollarBlockTrigger(editor as never);
    expect(editor.tf.removeNodes).not.toHaveBeenCalled();
    expect(editor.tf.insertNodes).not.toHaveBeenCalled();
  });

  it("ignores `$$` inside code block", () => {
    const editor = makeEditorWithCodeBlockText("$$");
    applyDollarBlockTrigger(editor as never);
    expect(editor.tf.removeNodes).not.toHaveBeenCalled();
    expect(editor.tf.insertNodes).not.toHaveBeenCalled();
  });

  it("does nothing when selection is null", () => {
    const editor = {
      selection: null,
      children: [{ type: "paragraph", children: [{ text: "$$" }] }],
      tf: {
        delete: vi.fn(),
        insertNodes: vi.fn(),
        removeNodes: vi.fn(),
      },
    };
    applyDollarBlockTrigger(editor as never);
    expect(editor.tf.removeNodes).not.toHaveBeenCalled();
  });
});
