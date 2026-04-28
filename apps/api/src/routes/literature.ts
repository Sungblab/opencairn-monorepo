import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit } from "../lib/rate-limit";
import {
  federatedSearch,
  type LiteratureSource,
} from "../lib/literature-search";
import { resolveRole } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Plan: Literature Search & Auto-Import (2026-04-27).
//
// Public surface:
//   GET /api/literature/search?q&workspaceId&sources&limit&offset
//
// Auth: requireAuth (session) + workspace membership check (any role).
// Rate limit: 60 req/60s per workspace. Tier 1 follow-up if abused.
//
// POST /api/literature/import + GET /api/literature/import/:jobId land in
// Task 7.

const ALLOWED_SOURCES: readonly LiteratureSource[] = [
  "arxiv",
  "semantic_scholar",
  "crossref",
] as const;
const ALLOWED_SOURCE_SET = new Set<string>(ALLOWED_SOURCES);

const searchSchema = z.object({
  q: z.string().min(1).max(500),
  workspaceId: z.string().uuid(),
  // Comma-separated subset of arxiv, semantic_scholar, crossref. Defaults
  // to arxiv+semantic_scholar at the federation layer when absent.
  sources: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const literatureRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/search", zValidator("query", searchSchema), async (c) => {
    const userId = c.get("userId");
    const { q, workspaceId, sources: sourcesRaw, limit, offset } =
      c.req.valid("query");

    // Workspace membership gate — any role can search, but only members.
    // Plan omits this check; added so a logged-in attacker cannot probe
    // arbitrary workspace ids (search results are public-data only, but a
    // 200 vs 403 timing channel still leaks workspace existence).
    const role = await resolveRole(userId, {
      type: "workspace",
      id: workspaceId,
    });
    if (role === "none") {
      return c.json({ error: "Forbidden" }, 403);
    }

    // Per-workspace rate limit so one noisy member can't starve the others.
    const rl = checkRateLimit(`lit:search:${workspaceId}`, 60, 60_000);
    if (!rl.allowed) {
      return c.json(
        { error: "Rate limit exceeded", retryAfterSec: rl.retryAfterSec },
        429,
      );
    }

    const sources = (sourcesRaw
      ? sourcesRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is LiteratureSource => ALLOWED_SOURCE_SET.has(s))
      : ["arxiv", "semantic_scholar"]) as LiteratureSource[];

    // Fetch limit+offset upstream so pagination doesn't drop the tail of
    // page N when the user navigates to page N+1.
    const { results, sourceMeta } = await federatedSearch({
      query: q,
      sources,
      limit: limit + offset,
    });
    const page = results.slice(offset, offset + limit);

    return c.json({
      results: page,
      total: results.length,
      sources: sourceMeta,
    });
  });
