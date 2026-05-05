import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Tx } from "../client";
import { notes } from "../schema/notes";
import { wikiLinks } from "../schema/wiki-links";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIKI_LINK_TARGET_CHUNK_SIZE = 500;

export function extractWikiLinkTargets(plateValue: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(plateValue)) return out;
  const stack: unknown[] = [...plateValue];
  while (stack.length) {
    const n = stack.pop();
    if (n && typeof n === "object") {
      const node = n as { type?: string; targetId?: unknown; children?: unknown };
      if (
        node.type === "wiki-link" &&
        typeof node.targetId === "string" &&
        UUID_RE.test(node.targetId)
      ) {
        out.add(node.targetId);
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) stack.push(child);
      }
    }
  }
  return out;
}

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

export async function syncWikiLinks(
  tx: Tx,
  sourceNoteId: string,
  targets: Set<string>,
  workspaceId: string,
): Promise<void> {
  await tx.delete(wikiLinks).where(eq(wikiLinks.sourceNoteId, sourceNoteId));
  if (targets.size === 0) return;

  const candidates = [...targets].filter((id) => id !== sourceNoteId);
  if (candidates.length === 0) return;

  const liveSet = new Set<string>();
  for (let i = 0; i < candidates.length; i += WIKI_LINK_TARGET_CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + WIKI_LINK_TARGET_CHUNK_SIZE);
    const live = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(
        inArray(notes.id, chunk),
        isNull(notes.deletedAt),
        eq(notes.workspaceId, workspaceId),
      ));
    for (const row of live) {
      liveSet.add(row.id);
    }
  }
  const rows = candidates
    .filter((targetNoteId) => liveSet.has(targetNoteId))
    .map((targetNoteId) => ({ sourceNoteId, targetNoteId, workspaceId }));
  if (rows.length === 0) return;

  await tx.insert(wikiLinks).values(rows).onConflictDoNothing();
}
