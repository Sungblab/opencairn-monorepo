import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Tx } from "../client";
import { notes } from "../schema/notes";
import { wikiLinks } from "../schema/wiki-links";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIKI_LINK_TARGET_CHUNK_SIZE = 500;

export type WikiLinkReferences = {
  targetIds: Set<string>;
  targetTitles: Set<string>;
};

export function extractWikiLinkTargets(plateValue: unknown): Set<string> {
  const refs = extractWikiLinkReferences(plateValue);
  return new Set([...refs.targetIds, ...refs.targetTitles]);
}

export function extractWikiLinkReferences(plateValue: unknown): WikiLinkReferences {
  const refs: WikiLinkReferences = {
    targetIds: new Set(),
    targetTitles: new Set(),
  };
  if (!Array.isArray(plateValue)) return refs;
  const stack: unknown[] = [...plateValue];
  while (stack.length) {
    const n = stack.pop();
    if (n && typeof n === "object") {
      const node = n as {
        type?: string;
        targetId?: unknown;
        noteId?: unknown;
        children?: unknown;
      };
      const targetId =
        node.type === "wiki-link" ? node.targetId
        : node.type === "wikilink" ? node.noteId
        : null;
      if (
        typeof targetId === "string" &&
        UUID_RE.test(targetId)
      ) {
        refs.targetIds.add(targetId);
      } else if (node.type === "wikilink") {
        const label = wikiLinkLabel(node);
        if (label) refs.targetTitles.add(label);
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) stack.push(child);
      }
    }
  }
  return refs;
}

function wikiLinkLabel(node: { label?: unknown; children?: unknown }): string | null {
  if (typeof node.label === "string" && node.label.trim()) {
    return node.label.trim();
  }
  if (!Array.isArray(node.children)) return null;
  const label = node.children
    .map((child) =>
      child && typeof child === "object" && "text" in child
        ? String((child as { text?: unknown }).text ?? "")
        : "",
    )
    .join("")
    .trim();
  return label || null;
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

  const candidates = [...targets]
    .map((target) => target.trim())
    .filter((target) => target && target !== sourceNoteId);
  if (candidates.length === 0) return;

  const liveSet = new Set<string>();
  const candidateIds = candidates.filter((target) => UUID_RE.test(target));
  for (let i = 0; i < candidateIds.length; i += WIKI_LINK_TARGET_CHUNK_SIZE) {
    const chunk = candidateIds.slice(i, i + WIKI_LINK_TARGET_CHUNK_SIZE);
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

  const candidateTitles = [...new Set(
    candidates.filter((target) => !UUID_RE.test(target)),
  )];
  for (let i = 0; i < candidateTitles.length; i += WIKI_LINK_TARGET_CHUNK_SIZE) {
    const chunk = candidateTitles.slice(i, i + WIKI_LINK_TARGET_CHUNK_SIZE);
    const live = await tx
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(and(
        inArray(notes.title, chunk),
        isNull(notes.deletedAt),
        eq(notes.workspaceId, workspaceId),
      ));
    const idsByTitle = new Map<string, string[]>();
    for (const row of live) {
      if (row.id === sourceNoteId) continue;
      const ids = idsByTitle.get(row.title) ?? [];
      ids.push(row.id);
      idsByTitle.set(row.title, ids);
    }
    for (const ids of idsByTitle.values()) {
      if (ids.length === 1) liveSet.add(ids[0]);
    }
  }

  const rows = [...liveSet].map((targetNoteId) => ({
    sourceNoteId,
    targetNoteId,
    workspaceId,
  }));
  if (rows.length === 0) return;

  await tx.insert(wikiLinks).values(rows).onConflictDoNothing();
}
