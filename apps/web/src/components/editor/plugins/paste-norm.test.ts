// Plan 2E Phase B — Test for embed URL paste detection helpers.
//
// We test the helper functions `tryInsertEmbed` and `isInsideCodeBlockOrLine`
// directly (unit tests on the pure logic) rather than mounting the full
// Plate editor in a test. This matches the approach used by Phase A's
// normalizeEscapes tests (pure-function, no editor fixture).

import { describe, it, expect, vi } from "vitest";
import { tryInsertEmbed, isInsideCodeBlockOrLine } from "./paste-norm";

// ─── Minimal editor fixture ───────────────────────────────────────────────

function makeEditor(nodeTypes: string[] = ["p"]) {
  const nodes = nodeTypes.map((type) => ({ type, children: [{ text: "" }] }));
  // selection points at [0] by default
  const editor = {
    selection: { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 0 } },
    children: nodes,
    tf: {
      insertNodes: vi.fn(),
    },
    // Minimal Slate node iteration needed by Editor.nodes
    // We stub isInsideCodeBlockOrLine separately for most tests.
  };
  return editor;
}

// ─── isInsideCodeBlockOrLine ──────────────────────────────────────────────

describe("isInsideCodeBlockOrLine", () => {
  it("returns false for a plain paragraph editor", () => {
    // Build a minimal editor shape with a real children/selection pair
    // so Editor.nodes can traverse it. We cast to avoid full Slate bootstrap.
    const fakeEditor = {
      selection: {
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [0, 0], offset: 0 },
      },
      children: [{ type: "p", children: [{ text: "" }] }],
    };
    // Editor.nodes performs real traversal; pass the fake editor
    // (Slate's invariants are minimal for a static read).
    // We just verify the function doesn't crash and returns false.
    const result = isInsideCodeBlockOrLine(fakeEditor as never);
    // paragraph = not a code block
    expect(result).toBe(false);
  });
});

// ─── tryInsertEmbed ───────────────────────────────────────────────────────

describe("tryInsertEmbed: embed URL auto-insertion", () => {
  it("inserts an embed node for a YouTube URL", () => {
    const editor = makeEditor();
    // Stub isInsideCodeBlockOrLine to return false for this test
    const result = tryInsertEmbed(
      editor as never,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(result).toBe(true);
    expect(editor.tf.insertNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "embed",
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      }),
    );
  });

  it("inserts an embed node for a Vimeo URL", () => {
    const editor = makeEditor();
    const result = tryInsertEmbed(editor as never, "https://vimeo.com/123456789");
    expect(result).toBe(true);
    expect(editor.tf.insertNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "embed",
        provider: "vimeo",
        embedUrl: "https://player.vimeo.com/video/123456789",
      }),
    );
  });

  it("inserts an embed node for a Loom URL", () => {
    const editor = makeEditor();
    const result = tryInsertEmbed(
      editor as never,
      "https://www.loom.com/share/abc123def456",
    );
    expect(result).toBe(true);
    expect(editor.tf.insertNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "embed",
        provider: "loom",
        embedUrl: "https://www.loom.com/embed/abc123def456",
      }),
    );
  });

  it("returns false for a regular URL (not an embed provider)", () => {
    const editor = makeEditor();
    const result = tryInsertEmbed(editor as never, "https://example.com/page");
    expect(result).toBe(false);
    expect(editor.tf.insertNodes).not.toHaveBeenCalled();
  });

  it("returns false when text has surrounding content", () => {
    const editor = makeEditor();
    const result = tryInsertEmbed(
      editor as never,
      "check out https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(result).toBe(false);
    expect(editor.tf.insertNodes).not.toHaveBeenCalled();
  });

  it("returns false for plain non-URL text", () => {
    const editor = makeEditor();
    const result = tryInsertEmbed(editor as never, "hello world");
    expect(result).toBe(false);
  });

  it("inserts a trailing paragraph node after the embed", () => {
    const editor = makeEditor();
    tryInsertEmbed(
      editor as never,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    // First call = embed node, second call = paragraph
    expect(editor.tf.insertNodes).toHaveBeenCalledTimes(2);
    expect(editor.tf.insertNodes).toHaveBeenLastCalledWith({
      type: "p",
      children: [{ text: "" }],
    });
  });
});
