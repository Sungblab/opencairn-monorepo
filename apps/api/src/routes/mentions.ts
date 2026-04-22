import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  workspaceMembers,
  user,
  notes,
  concepts,
  projects,
  eq,
  and,
  ilike,
  isNull,
} from "@opencairn/db";
import {
  mentionSearchQuerySchema,
  type MentionSearchResult,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, resolveRole } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// GET /api/mentions/search?type=user|page|concept&q=&workspaceId=&projectId=&limit=
//
// Permission model:
//   - Caller must have any workspace role (not "none") to query anything.
//   - user: returns workspace members (prefix match on name).
//   - page: returns workspace notes (substring match) filtered per-row by canRead;
//     over-fetch (limit*2) so private-note exclusion still fills the page.
//   - concept: returns concepts across workspace projects (substring match) filtered
//     per-row by project canRead.
//
// NOTE: projectId query param is accepted by the schema but unused here. Plan 2C
// will narrow the search scope with it once the UI carries project context.
export const mentionsRouter = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get(
    "/mentions/search",
    zValidator("query", mentionSearchQuerySchema),
    async (c) => {
      const userId = c.get("userId");
      const { type, q, workspaceId, limit } = c.req.valid("query");

      const wsRole = await resolveRole(userId, {
        type: "workspace",
        id: workspaceId,
      });
      if (wsRole === "none") return c.json({ error: "Forbidden" }, 403);

      let results: MentionSearchResult[] = [];

      if (type === "user") {
        // Prefix match so "al" finds "Alice" but not "Malcolm".
        const rows = await db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            avatarUrl: user.image,
          })
          .from(workspaceMembers)
          .innerJoin(user, eq(user.id, workspaceMembers.userId))
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              ilike(user.name, `${q}%`),
            ),
          )
          .limit(limit);

        results = rows.map((r) => ({
          type: "user" as const,
          id: r.id,
          label: r.name ?? r.email ?? r.id,
          sublabel: r.email ?? undefined,
          avatarUrl: r.avatarUrl ?? undefined,
        }));
      } else if (type === "page") {
        // Over-fetch: canRead may exclude notes (private inheritParent=false),
        // so we pull 2× limit then cap after filtering.
        const rows = await db
          .select({ id: notes.id, title: notes.title })
          .from(notes)
          .where(
            and(
              eq(notes.workspaceId, workspaceId),
              ilike(notes.title, `%${q}%`),
              isNull(notes.deletedAt),
            ),
          )
          .limit(limit * 2);

        const filtered: typeof rows = [];
        for (const r of rows) {
          if (await canRead(userId, { type: "note", id: r.id })) {
            filtered.push(r);
          }
          if (filtered.length >= limit) break;
        }

        results = filtered.map((r) => ({
          type: "page" as const,
          id: r.id,
          label: r.title ?? "Untitled",
        }));
      } else if (type === "concept") {
        // Scope: concepts in projects under this workspace that the caller can read.
        const rows = await db
          .select({
            id: concepts.id,
            name: concepts.name,
            projectId: concepts.projectId,
            projectName: projects.name,
          })
          .from(concepts)
          .innerJoin(projects, eq(projects.id, concepts.projectId))
          .where(
            and(
              eq(projects.workspaceId, workspaceId),
              ilike(concepts.name, `%${q}%`),
            ),
          )
          .limit(limit * 2);

        const filtered: typeof rows = [];
        for (const r of rows) {
          if (await canRead(userId, { type: "project", id: r.projectId })) {
            filtered.push(r);
          }
          if (filtered.length >= limit) break;
        }

        results = filtered.map((r) => ({
          type: "concept" as const,
          id: r.id,
          label: r.name,
          sublabel: r.projectName ?? undefined,
        }));
      }

      return c.json({ results });
    },
  );
