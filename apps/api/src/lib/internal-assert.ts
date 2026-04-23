import {
  concepts,
  notes,
  projects,
  eq,
  inArray,
  and,
  isNull,
  type DB,
} from "@opencairn/db";

// Defense-in-depth for /api/internal/* write routes.
//
// Every one of those endpoints lives behind the shared `INTERNAL_API_SECRET`
// header, so a rogue external caller cannot hit them — but a worker bug, a
// misrouted Temporal payload, or a forwarded-workflow-from-another-workspace
// invocation would otherwise write *anywhere* because the routes trusted
// whatever `projectId` / `noteId` / `conceptId` came in. Post-hoc review
// Plan 1 H-3 + Plan 4 C-3 called this "방어 심도 0".
//
// The fix: every write route now requires an explicit `workspaceId` param,
// and `assertResourceWorkspace` resolves the target resource's *actual*
// workspace and throws `WorkspaceMismatchError` if they do not agree.
// Callers translate the throw to 403.
//
// [Tier 1 item 1-3 / Plan 4 C-3 + H-1 + H-4 + M-3]

export class WorkspaceMismatchError extends Error {
  readonly resource: { type: string; id: string };
  readonly expected: string;
  readonly actual: string | null;
  constructor(
    resource: { type: string; id: string },
    expected: string,
    actual: string | null,
  ) {
    super(
      `workspace mismatch on ${resource.type} ${resource.id}: expected ${expected}, got ${actual ?? "<missing>"}`,
    );
    this.name = "WorkspaceMismatchError";
    this.resource = resource;
    this.expected = expected;
    this.actual = actual;
  }
}

export type InternalResource =
  | { type: "project"; id: string }
  | { type: "note"; id: string }
  | { type: "concept"; id: string };

/**
 * Resolve the workspace that owns the given resource and compare with the
 * caller-supplied `workspaceId`. Throws `WorkspaceMismatchError` if the
 * resource does not exist, is soft-deleted (notes only), or lives under a
 * different workspace. `tx` can be either the top-level `db` or a drizzle
 * transaction handle — the same query shape works in both contexts.
 */
export async function assertResourceWorkspace(
  tx: DB,
  workspaceId: string,
  resource: InternalResource,
): Promise<void> {
  const actual = await findResourceWorkspace(tx, resource);
  if (actual !== workspaceId) {
    throw new WorkspaceMismatchError(resource, workspaceId, actual);
  }
}

/**
 * Variant for resources that come in as a list (e.g. concepts/merge's
 * `duplicateIds`). All rows must belong to `workspaceId`; any row that
 * does not triggers a throw for the first offender. Non-existent rows
 * are treated the same as foreign-workspace rows.
 */
export async function assertManyResourceWorkspace(
  tx: DB,
  workspaceId: string,
  resource: { type: "concept" | "note" | "project"; ids: string[] },
): Promise<void> {
  if (resource.ids.length === 0) return;
  const uniqueIds = Array.from(new Set(resource.ids));
  const rows = await workspaceLookupMany(tx, resource.type, uniqueIds);
  const byId = new Map(rows);
  for (const id of uniqueIds) {
    const actual = byId.get(id) ?? null;
    if (actual !== workspaceId) {
      throw new WorkspaceMismatchError({ type: resource.type, id }, workspaceId, actual);
    }
  }
}

async function findResourceWorkspace(
  tx: DB,
  resource: InternalResource,
): Promise<string | null> {
  if (resource.type === "project") {
    const [row] = await tx
      .select({ wsId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, resource.id));
    return row?.wsId ?? null;
  }
  if (resource.type === "note") {
    const [row] = await tx
      .select({ wsId: notes.workspaceId })
      .from(notes)
      // Soft-deleted notes resolve as "missing" so internal writers cannot
      // revive them via this path (mirrors permissions.ts Tier 0 fix).
      .where(and(eq(notes.id, resource.id), isNull(notes.deletedAt)));
    return row?.wsId ?? null;
  }
  if (resource.type === "concept") {
    // concepts have no direct workspaceId — they inherit via their project.
    const [row] = await tx
      .select({ wsId: projects.workspaceId })
      .from(concepts)
      .innerJoin(projects, eq(projects.id, concepts.projectId))
      .where(eq(concepts.id, resource.id));
    return row?.wsId ?? null;
  }
  return null;
}

async function workspaceLookupMany(
  tx: DB,
  type: "concept" | "note" | "project",
  ids: string[],
): Promise<Array<[string, string]>> {
  if (type === "project") {
    const rows = await tx
      .select({ id: projects.id, wsId: projects.workspaceId })
      .from(projects)
      .where(inArray(projects.id, ids));
    return rows.map((r) => [r.id, r.wsId]);
  }
  if (type === "note") {
    const rows = await tx
      .select({ id: notes.id, wsId: notes.workspaceId })
      .from(notes)
      .where(and(inArray(notes.id, ids), isNull(notes.deletedAt)));
    return rows.map((r) => [r.id, r.wsId]);
  }
  // concept
  const rows = await tx
    .select({ id: concepts.id, wsId: projects.workspaceId })
    .from(concepts)
    .innerJoin(projects, eq(projects.id, concepts.projectId))
    .where(inArray(concepts.id, ids));
  return rows.map((r) => [r.id, r.wsId]);
}
