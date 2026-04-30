// Plan 2E Phase B-4 — Math trigger plugin tests (Task 4.1 scaffolding).
//
// Uses minimal editor mocks (plain objects, no full Slate bootstrap) following
// the pattern established in paste-norm.test.ts and mermaid-fence.test.ts.
// node environment — pure logic tests, no DOM/React.

import { describe, expect, it } from "vitest";
import {
  isInsideCodeContext,
} from "./math-trigger";

// ─── Task 4.1 — isInsideCodeContext ───────────────────────────────────────────

describe("isInsideCodeContext", () => {
  it("returns true when selection is in code_block", () => {
    const editor = {
      children: [
        {
          type: "code_block",
          children: [{ type: "code_line", children: [{ text: "" }] }],
        },
      ],
      selection: {
        anchor: { path: [0, 0, 0], offset: 0 },
        focus: { path: [0, 0, 0], offset: 0 },
      },
    };
    expect(isInsideCodeContext(editor)).toBe(true);
  });

  it("returns false in a paragraph", () => {
    const editor = {
      children: [{ type: "paragraph", children: [{ text: "hi" }] }],
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
    };
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
