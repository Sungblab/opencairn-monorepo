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

      // Over-fetch by 2x so the per-row canRead filter still has room to
      // fill the page after dropping private notes — same pattern the
      // mentions search uses.
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

      const visibleNotes: ScopeTargetSearchHit[] = [];
      for (const row of noteRows) {
        if (await canRead(userId, { type: "note", id: row.id })) {
          visibleNotes.push({ type: "page", id: row.id, label: row.title || "Untitled" });
          if (visibleNotes.length >= SCOPE_TARGETS_LIMIT) break;
        }
      }

      const visibleProjects: ScopeTargetSearchHit[] = [];
      for (const row of projectRows) {
        if (await canRead(userId, { type: "project", id: row.id })) {
          visibleProjects.push({ type: "project", id: row.id, label: row.name });
        }
      }

      // Pages first, then projects — chips usually anchor on the most
      // specific scope, and project rows are less common anyway.
      return c.json([...visibleNotes, ...visibleProjects]);
    },
  );
