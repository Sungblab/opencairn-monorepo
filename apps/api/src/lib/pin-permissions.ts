import {
  db as defaultDb,
  workspaceMembers,
  notes,
  eq,
  type DB,
} from "@opencairn/db";
import { resolveRole } from "./permissions";
import type { Citation } from "@opencairn/shared";

export type PinDelta = {
  hiddenSources: { sourceType: string; sourceId: string; snippet: string }[];
  hiddenUsers: { userId: string; reason: string }[];
};

// Compute the visibility delta when pinning a message that carries
// `citations` to `targetPageId`. A delta exists when at least one source
// note cited by the message is invisible to a workspace member who would
// otherwise be able to read the target page.
//
// The pin itself is harmless — the answer text + the in-line citation
// preview are written to the page body. But the *cited source link* would
// be a dead-end for those readers, and worse, the snippet text could leak
// content the source's permissions explicitly hide. The 409 confirmation
// modal exists so the user can take responsibility for that leak.
//
// External / concept citations skip the check: external sources have no
// workspace permission model, and concepts ride workspace-level visibility
// from the wiki. (Concept-level permissions are a Plan 5+ concern.)
//
// Cost guard: for an M-member workspace and N note citations the walk is
// O(M + M*N) `resolveRole` calls (~2-4 DB roundtrips each). We hard-cap
// both axes so a malicious payload can't pin one DB-stalling request to
// every workspace member; over-cap throws so the caller can surface a
// "too large to evaluate" error to the user.
//
// Concurrency guard: `Promise.all` over the worst-case 200×50=10_000
// `resolveRole` calls would saturate the postgres connection pool (each
// call is 2-4 roundtrips, and pgbouncer/pg pool defaults sit around
// 10-20 connections). We process in serial chunks so at most
// CHUNK_CONCURRENCY in-flight checks contend for the pool at once.
const MAX_MEMBERS_FOR_PIN_DELTA = 200;
const MAX_NOTE_CITATIONS_FOR_PIN_DELTA = 50;
const CHUNK_CONCURRENCY = 10;

async function mapInChunks<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const results = await Promise.all(slice.map(fn));
    out.push(...results);
  }
  return out;
}

export async function computePinDelta(
  citations: Citation[],
  targetPageId: string,
  options?: { db?: DB },
): Promise<PinDelta> {
  const conn = options?.db ?? defaultDb;
  const [target] = await conn
    .select({ workspaceId: notes.workspaceId })
    .from(notes)
    .where(eq(notes.id, targetPageId));
  if (!target) {
    throw Object.assign(new Error("target page not found"), { status: 404 as const });
  }

  const members = await conn
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, target.workspaceId));
  if (members.length > MAX_MEMBERS_FOR_PIN_DELTA) {
    throw Object.assign(
      new Error(
        `pin delta computation refused: workspace has ${members.length} members (max ${MAX_MEMBERS_FOR_PIN_DELTA})`,
      ),
      { status: 413 as const },
    );
  }
  const noteCitations = citations.filter((c) => c.source_type === "note");
  if (noteCitations.length > MAX_NOTE_CITATIONS_FOR_PIN_DELTA) {
    throw Object.assign(
      new Error(
        `pin delta computation refused: ${noteCitations.length} note citations (max ${MAX_NOTE_CITATIONS_FOR_PIN_DELTA})`,
      ),
      { status: 413 as const },
    );
  }

  // Step 1: collect users who can read the target page. Chunked to
  // bound concurrent DB roundtrips at CHUNK_CONCURRENCY rather than the
  // full member list — naive Promise.all would saturate the connection
  // pool on large workspaces.
  const targetReaders = (
    await mapInChunks(members, CHUNK_CONCURRENCY, async (m) => ({
      userId: m.userId,
      role: await resolveRole(m.userId, { type: "note", id: targetPageId }, options),
    }))
  )
    .filter((r) => r.role !== "none")
    .map((r) => r.userId);

  // Step 2: for each note citation, find target readers who CANNOT read
  // it. Citations run sequentially (outer loop) and the per-citation
  // user fan-out is chunked — total in-flight checks stay at ≤
  // CHUNK_CONCURRENCY at any moment, never the worst-case M×N.
  const hiddenSources: PinDelta["hiddenSources"] = [];
  const hiddenUserSet = new Set<string>();

  for (const cite of noteCitations) {
    const userRoles = await mapInChunks(
      targetReaders,
      CHUNK_CONCURRENCY,
      async (u) => ({
        userId: u,
        role: await resolveRole(u, { type: "note", id: cite.source_id }, options),
      }),
    );
    const blocked = userRoles.filter((r) => r.role === "none").map((r) => r.userId);
    if (blocked.length > 0) {
      hiddenSources.push({
        sourceType: cite.source_type,
        sourceId: cite.source_id,
        snippet: cite.snippet,
      });
      for (const u of blocked) hiddenUserSet.add(u);
    }
  }

  return {
    hiddenSources,
    hiddenUsers: Array.from(hiddenUserSet).map((userId) => ({
      userId,
      reason: "no_access_to_cited_source",
    })),
  };
}
