import {
  db as defaultDb,
  notes,
  projects,
  workspaces,
  eq,
  isNull,
  and,
  type DB,
} from "@opencairn/db";
import type { ScopeType } from "@opencairn/shared";
import { canRead } from "./permissions";

export class ScopeValidationError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "ScopeValidationError";
  }
}

// Resolve the human-friendly label for a scope and assert it lives inside
// the conversation's workspace. The check defends Plan 11A's "workspace is
// the isolation boundary" rule against forged scope_id values — a chat
// initialised with `scope_id` from another workspace must be rejected
// before any RAG lookup runs.
//
// Throws ScopeValidationError(403) when the resolved row's workspaceId
// disagrees with the conversation, ScopeValidationError(404) when the row
// doesn't exist (or is soft-deleted, for notes).
export async function validateScope(
  workspaceId: string,
  scopeType: ScopeType,
  scopeId: string,
  options?: { db?: DB; userId?: string },
): Promise<{ label: string }> {
  const conn = options?.db ?? defaultDb;

  if (scopeType === "workspace") {
    if (scopeId !== workspaceId) {
      throw new ScopeValidationError(403, "scope outside workspace");
    }
    const [ws] = await conn
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (!ws) {
      throw new ScopeValidationError(404, "workspace not found");
    }
    return { label: ws.name };
  }

  // For project / page lookups: collapse "row exists in another
  // workspace" with "row does not exist at all" into a single response.
  // Distinguishing the two leaks an existence oracle — a caller who
  // doesn't belong to the target workspace can otherwise enumerate
  // project/page UUIDs and learn whether each one is real. Mirrors the
  // silent-false behaviour of `permissions.canRead`.
  if (scopeType === "project") {
    const [row] = await conn
      .select({ name: projects.name, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, scopeId));
    if (!row || row.workspaceId !== workspaceId) {
      throw new ScopeValidationError(404, "scope target not found");
    }
    if (
      options?.userId &&
      !(await canRead(
        options.userId,
        { type: "project", id: scopeId },
        { db: conn },
      ))
    ) {
      throw new ScopeValidationError(403, "forbidden");
    }
    return { label: row.name };
  }

  // page — soft-deleted notes resolve as not-found so a chat scoped to a
  // trashed page can't be created. Cross-workspace and not-existing both
  // collapse to 404 (existence-oracle defence above).
  const [row] = await conn
    .select({ title: notes.title, workspaceId: notes.workspaceId })
    .from(notes)
    .where(and(eq(notes.id, scopeId), isNull(notes.deletedAt)));
  if (!row || row.workspaceId !== workspaceId) {
    throw new ScopeValidationError(404, "scope target not found");
  }
  if (
    options?.userId &&
    !(await canRead(
      options.userId,
      { type: "note", id: scopeId },
      { db: conn },
    ))
  ) {
    throw new ScopeValidationError(403, "forbidden");
  }
  return { label: row.title || "Untitled" };
}
