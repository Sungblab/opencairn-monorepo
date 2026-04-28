import type { DocEditorSelection } from "@opencairn/shared";

// Plan 11B Phase A — capture the block-level selection for a slash AI
// command. We always operate on the *whole* containing block (not the
// user's text-range selection) so the LLM sees a complete sentence /
// paragraph and the worker's hunk offsets line up with `applyHunksToValue`.
//
// Why block-level only in Phase A:
//   * Robust offset mapping from a Slate Range to the block's flat-text
//     index requires walking every sibling and accounting for inline
//     elements (links, mentions). That's a Phase C concern when the Diff
//     View needs precise selection echoing.
//   * Block-level keeps the worker prompt deterministic ("rewrite this
//     paragraph") and avoids selection-drift from cursor moves between
//     menu open and command dispatch.
//
// Returns null when:
//   * No selection
//   * Block has no `id` (newly inserted, pre-normalize, or non-id'd type)
//   * Block text is empty (commands need at least one character)
//   * Block text exceeds the 4000-char selection ceiling enforced by
//     `docEditorSelectionSchema` — the slash menu silently no-ops rather
//     than ship an obviously-rejectable request

const MAX_SELECTION_CHARS = 4000;

// We narrow the editor surface to exactly the two `api` reads we need
// (block + string) so this helper stays callable from anywhere holding a
// Plate editor without dragging the full PlateEditor generic.
export interface BlockSelectionEditor {
  api: {
    block: () => [{ id?: unknown }, unknown[]] | undefined;
    string: (options: { at: unknown }) => string;
  };
}

export function readBlockSelection(
  editor: BlockSelectionEditor,
): DocEditorSelection | null {
  const entry = editor.api.block();
  if (!entry) return null;
  const [block, blockPath] = entry;
  const blockId = typeof block.id === "string" ? block.id : null;
  if (!blockId) return null;
  const text = editor.api.string({ at: blockPath });
  if (!text || text.length === 0) return null;
  if (text.length > MAX_SELECTION_CHARS) return null;
  return {
    blockId,
    start: 0,
    end: text.length,
    text,
  };
}
