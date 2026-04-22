// Plan 2B Task 14: block orphan reaper.
//
// When a user deletes a block from the Y.Doc (say, `blk_A`) that had a
// thread of comments anchored to it via `comments.anchor_block_id = 'blk_A'`,
// those comments are now "orphaned" — the UI can no longer render the
// block highlight. Policy (docs/architecture/collaboration-model.md § 5.2):
//   - DO NOT delete the comment row (threads outlive edits).
//   - DO set `anchor_block_id = NULL` so the comment demotes to a
//     page-level comment, still visible in the comments side panel.
//
// This runs in the `onChange` hook — we only care about the committed state
// of the Y.Doc, not incremental sync messages. Persistence extension runs
// its own onChange; ordering doesn't matter here because we walk the Y.Doc
// directly, not the pending update.
//
// Error-tolerant: a reaper failure must never drop the edit. We catch and
// log — the canonical Y-state has already been accepted by the time onChange
// fires, and at worst orphaned anchors linger until the next edit triggers
// another reap.

import type { Extension, onChangePayload } from "@hocuspocus/server";
import {
  and,
  eq,
  inArray,
  isNotNull,
  comments,
  type DB,
} from "@opencairn/db";
import { yDocToPlate } from "./plate-bridge.js";
import { logger } from "./logger.js";

// page:<uuid> — same shape as auth.ts / persistence.ts.
const DOC_RE =
  /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Walk a Plate JSON tree and collect every string `id` field. Plate/Slate
 * blocks typically carry an `id` on each element; text leaves do not. We
 * treat anything with a string id as a potential anchor target.
 */
function collectBlockIds(plateValue: unknown[]): Set<string> {
  const ids = new Set<string>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as { id?: unknown; children?: unknown };
    if (typeof node.id === "string") ids.add(node.id);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  plateValue.forEach(walk);
  return ids;
}

export function makeBlockOrphanReaper(db: DB): Extension {
  return {
    extensionName: "block-orphan-reaper",

    async onChange({ document, documentName }: onChangePayload) {
      try {
        const m = DOC_RE.exec(documentName);
        if (!m) return;
        const noteId = m[1]!;

        const value = yDocToPlate(document);
        const present = collectBlockIds(value);

        const anchored = await db
          .select({
            id: comments.id,
            anchor: comments.anchorBlockId,
          })
          .from(comments)
          .where(
            and(
              eq(comments.noteId, noteId),
              isNotNull(comments.anchorBlockId),
            ),
          );

        const orphans = anchored
          .filter((c) => c.anchor && !present.has(c.anchor))
          .map((c) => c.id);
        if (orphans.length === 0) return;

        await db
          .update(comments)
          .set({ anchorBlockId: null, updatedAt: new Date() })
          .where(inArray(comments.id, orphans));

        logger.info(
          { noteId, count: orphans.length },
          "orphaned comments demoted to page-level",
        );
      } catch (err) {
        // Never surface — a reaper failure must not abort the edit pipeline.
        logger.error({ err }, "block-orphan-reaper failed");
      }
    },
  };
}
