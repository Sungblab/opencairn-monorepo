import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  notes,
  projects,
  eq,
  and,
  ilike,
  isNull,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Plan 11A — chip combobox backing search. Returns pages + projects in the
// caller's workspace whose name matches `q`. Per-row canRead filter keeps
// private pages out of the suggestion list (the boundary the conversation
// chip eventually re-enforces server-side, but the user shouldn't even
// see suggestions they cannot attach).
//
// 11B will broaden this to include memory entries when L1–L4 ship.

const SCOPE_TARGETS_LIMIT = 10;

const scopeTargetsQuery = z.object({
  workspaceId: z.string().uuid(),
  q: z.string().trim().min(1).max(64),
});

export type ScopeTargetSearchHit = {
  type: "page" | "project";
  id: string;
  label: string;
};

export const searchRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get(
    "/scope-targets",
    zValidator("query", scopeTargetsQuery),
    async (c) => {
      const userId = c.get("userId");
      const { workspaceId, q } = c.req.valid("query");

      if (!(await canRead(userId, { type: "workspace", id: workspaceId }))) {
        return c.json({ error: "forbidden" }, 403);
      }

      // Over-fetch by 2x so the per-row canRead filter still has room
      // to fill the page after dropping private notes — same pattern
      // the mentions search uses. The leading-wildcard `ilike` does
      // NOT use a B-tree on title; migration 0031 adds a pg_trgm GIN
      // index so this query stays sub-100ms past ~10k notes.
      const noteRows = await db
        .select({ id: notes.id, title: notes.title })
        .from(notes)
        .where(
          and(
            eq(notes.workspaceId, workspaceId),
            isNull(notes.deletedAt),
            ilike(notes.title, `%${q}%`),
          ),
        )
        .limit(SCOPE_TARGETS_LIMIT * 2);

      const projectRows = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            ilike(projects.name, `%${q}%`),
          ),
        )
        .limit(SCOPE_TARGETS_LIMIT);

      // Per-row canRead in parallel so total search latency = O(1)
      // resolveRole calls instead of O(rows). The slice happens after
      // the filter so private notes don't burn the result-set budget.
      // `label` is the raw title — clients render the empty-title
      // fallback in their own locale instead of the API hardcoding
      // "Untitled".
      type PageHit = { type: "page"; id: string; label: string };
      type ProjectHit = { type: "project"; id: string; label: string };
      const visibleNotes: ScopeTargetSearchHit[] = (
        await Promise.all(
          noteRows.map(async (row) => {
            const ok = await canRead(userId, { type: "note", id: row.id });
            return ok
              ? ({ type: "page" as const, id: row.id, label: row.title })
              : null;
          }),
        )
      )
        .filter((n): n is PageHit => n !== null)
        .slice(0, SCOPE_TARGETS_LIMIT);

      const visibleProjects: ScopeTargetSearchHit[] = (
        await Promise.all(
          projectRows.map(async (row) => {
            const ok = await canRead(userId, { type: "project", id: row.id });
            return ok
              ? ({ type: "project" as const, id: row.id, label: row.name })
              : null;
          }),
        )
      ).filter((p): p is ProjectHit => p !== null);

      // Pages first, then projects — chips usually anchor on the most
      // specific scope, and project rows are less common anyway.
      return c.json([...visibleNotes, ...visibleProjects]);
    },
  );
