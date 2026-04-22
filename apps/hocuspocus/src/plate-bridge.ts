// Plan 2B Task 12: Plate value ↔ Y.Doc bridge — server-side only.
//
// Converts Plate JSON (array of Slate/Plate block nodes) to and from the
// Yjs shared type that Hocuspocus hosts as the canonical document state.
//
// Client-side (apps/web) uses `@platejs/yjs`; server-side here uses
// `@slate-yjs/core`. Both libraries share the same underlying convention
// of a `Y.XmlText` mounted at a shared-root key on the Y.Doc. As long as
// both sides use the SAME key (ROOT_KEY = "content"), shared type identity
// is preserved across the WebSocket boundary and edits apply cleanly.
//
// This module is used by:
//   - persistence.ts (Task 13): seed a fresh Y.Doc from legacy
//     `notes.content` Plate JSON on first fetch, and extract a snapshot
//     back to `notes.content` on store (mirror, not source of truth).
//   - block-orphan-reaper.ts (Task 14): walk the Plate tree on change
//     to detect block IDs that have been removed from the document.
//
// See docs/architecture/collaboration-model.md for the broader design.

import * as Y from "yjs";
import {
  slateNodesToInsertDelta,
  yTextToSlateElement,
} from "@slate-yjs/core";

// `slate` is a transitive peer dep of @slate-yjs/core, not a direct dep of
// @opencairn/hocuspocus. `slateNodesToInsertDelta` is typed as
// `(nodes: Node[]) => InsertDelta` where `Node` comes from slate; we cast
// Plate JSON through `unknown` to sidestep importing slate's types here.

const ROOT_KEY = "content";

/**
 * Exported so persistence.ts + block-orphan-reaper.ts (and any future
 * consumers) do not hardcode the shared-root key. Must match the key
 * `@platejs/yjs` uses on the client — keep the two in lockstep.
 */
export const PLATE_BRIDGE_ROOT_KEY = ROOT_KEY;

/**
 * The canonical empty document — a single empty paragraph. Plate + Slate
 * reject a truly empty `children: []` root, so callers that need a
 * "blank doc" value must seed this shape.
 */
export const EMPTY_PLATE_VALUE: ReadonlyArray<Record<string, unknown>> = [
  { type: "p", children: [{ text: "" }] },
];

function getSharedRoot(doc: Y.Doc): Y.XmlText {
  return doc.get(ROOT_KEY, Y.XmlText) as Y.XmlText;
}

/**
 * Apply a Plate JSON value to a Y.Doc. Idempotent: if the shared root
 * already has content, this is a no-op (so a re-seed attempt against a
 * doc that was loaded from storage does not duplicate blocks).
 *
 * Must be called inside a Y.Doc that is not yet observed by clients, or
 * wrapped in a transaction whose origin is considered local — otherwise
 * the insertions will be round-tripped as edits.
 */
export function plateToYDoc(doc: Y.Doc, value: unknown[]): void {
  const sharedRoot = getSharedRoot(doc);
  if (sharedRoot.length > 0) return; // idempotent guard against re-seed
  const insertDelta = slateNodesToInsertDelta(
    value as unknown as Parameters<typeof slateNodesToInsertDelta>[0],
  );
  sharedRoot.applyDelta(insertDelta);
}

/**
 * Extract a Plate JSON snapshot from a Y.Doc. Returns a non-empty array:
 * an empty Y.Doc yields the canonical empty-paragraph value so the DB
 * mirror and any initial client hydration both see a valid tree.
 */
export function yDocToPlate(doc: Y.Doc): unknown[] {
  const sharedRoot = getSharedRoot(doc);
  if (sharedRoot.length === 0) {
    return EMPTY_PLATE_VALUE.map((n) => ({ ...n }));
  }
  const slateRoot = yTextToSlateElement(sharedRoot) as {
    children?: unknown[];
  };
  const children = slateRoot?.children;
  if (!Array.isArray(children) || children.length === 0) {
    return EMPTY_PLATE_VALUE.map((n) => ({ ...n }));
  }
  return children;
}
