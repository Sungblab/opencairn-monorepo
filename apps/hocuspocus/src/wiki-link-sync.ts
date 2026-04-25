import { wikiLinks, notes, eq, and, inArray, isNull, type Tx } from "@opencairn/db";

// `i` flag: external systems (some Better Auth flows, ingest sources) can
// emit upper- or mixed-case UUIDs. Plate is consistent today but we don't
// own the producers transitively — be permissive on read.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Walk a Plate value (deeply nested array of nodes with `children`) and
 * collect unique wiki-link `targetId`s. Pure function — no I/O.
 *
 * The wiki-link node type key is hard-coded to "wiki-link" because that is
 * the value `WIKILINK_KEY` in apps/web/src/components/editor/plugins/wiki-link.tsx
 * exports. CI grep guard pins both keys to prevent silent rename breakage.
 */
export function extractWikiLinkTargets(plateValue: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(plateValue)) return out;
  const stack: unknown[] = [...plateValue];
  while (stack.length) {
    const n = stack.pop();
    if (n && typeof n === "object") {
      const node = n as {
        type?: string;
        targetId?: unknown;
        children?: unknown;
      };
      if (
        node.type === "wiki-link" &&
        typeof node.targetId === "string" &&
        UUID_RE.test(node.targetId)
      ) {
        out.add(node.targetId);
      }
      if (Array.isArray(node.children)) {
        for (const c of node.children) stack.push(c);
      }
    }
  }
  return out;
}

/**
 * Resolve the workspace_id for a source note. Returns null if the note
 * doesn't exist or its project was hard-deleted between fetch and store
 * (Hocuspocus race tolerated — caller bails).
 */
export async function resolveWorkspaceForNote(
  tx: Tx,
  noteId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ workspaceId: notes.workspaceId })
    .from(notes)
    .where(eq(notes.id, noteId));
  return rows[0]?.workspaceId ?? null;
}

/**
 * Replace the wiki_links rows for `sourceNoteId` with the deduped target set.
 * Runs inside the transaction passed by persistence.store, so the new index
 * is committed atomically with notes.content.
 *
 * Targets pointing to non-existent / soft-deleted notes are silently dropped
 * (matches the migration's backfill semantic). Self-references are dropped.
 * Cross-workspace targets are silently dropped (defense against a poisoned
 * Plate value where targetId resolves to a note in a different workspace).
 */
export async function syncWikiLinks(
  tx: Tx,
  sourceNoteId: string,
  targets: Set<string>,
  workspaceId: string,
): Promise<void> {
  // 1) full rebuild — drop existing rows for this source.
  await tx.delete(wikiLinks).where(eq(wikiLinks.sourceNoteId, sourceNoteId));

  if (targets.size === 0) return;

  // 2) drop self-references, then verify each target points to a live,
  //    same-workspace note.
  const candidates = [...targets].filter((id) => id !== sourceNoteId);
  if (candidates.length === 0) return;

  const live = await tx
    .select({ id: notes.id })
    .from(notes)
    .where(and(
      inArray(notes.id, candidates),
      isNull(notes.deletedAt),
      eq(notes.workspaceId, workspaceId),
    ));
  const liveSet = new Set(live.map((r) => r.id));
  const rows = candidates
    .filter((t) => liveSet.has(t))
    .map((targetNoteId) => ({ sourceNoteId, targetNoteId, workspaceId }));
  if (rows.length === 0) return;

  // .onConflictDoNothing() guards against the rare case where two Hocuspocus
  // store transactions for the same note interleave — the DELETE→SELECT→INSERT
  // sequence is atomic *per* tx, but PostgreSQL's READ COMMITTED default lets
  // a peer tx commit between the DELETE and INSERT and reach the unique
  // constraint first. Cheaper than escalating isolation; the constraint
  // itself still enforces correctness.
  await tx.insert(wikiLinks).values(rows).onConflictDoNothing();
}
