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

  // Workspace members are the universe of potential readers — guests
  // without membership cannot reach the target page in the first place.
  const members = await conn
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, target.workspaceId));

  // Step 1: collect users who can read the target page.
  const targetReaders: string[] = [];
  for (const m of members) {
    const role = await resolveRole(m.userId, { type: "note", id: targetPageId }, options);
    if (role !== "none") targetReaders.push(m.userId);
  }

  // Step 2: for each note citation, find target readers who CANNOT read it.
  const hiddenSources: PinDelta["hiddenSources"] = [];
  const hiddenUserSet = new Set<string>();

  for (const cite of citations) {
    if (cite.source_type !== "note") continue;
    const blocked: string[] = [];
    for (const u of targetReaders) {
      const role = await resolveRole(u, { type: "note", id: cite.source_id }, options);
      if (role === "none") {
        blocked.push(u);
        hiddenUserSet.add(u);
      }
    }
    if (blocked.length > 0) {
      hiddenSources.push({
        sourceType: cite.source_type,
        sourceId: cite.source_id,
        snippet: cite.snippet,
      });
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
