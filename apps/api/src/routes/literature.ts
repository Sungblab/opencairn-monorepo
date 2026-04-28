import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "node:crypto";
import { db, importJobs, notes, projects, eq, and, isNull } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit } from "../lib/rate-limit";
import {
  federatedSearch,
  type LiteratureSource,
} from "../lib/literature-search";
import { canWrite, resolveRole } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
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
  })

  .post("/import", async (c) => {
    const user = c.get("user");
    let body: { ids?: unknown; projectId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    if (
      !body.ids ||
      !Array.isArray(body.ids) ||
      body.ids.length === 0 ||
      !body.ids.every((id) => typeof id === "string" && id.length > 0)
    ) {
      return c.json({ error: "ids must be a non-empty array of strings" }, 400);
    }
    if (body.ids.length > 50) {
      return c.json({ error: "ids must contain at most 50 items" }, 400);
    }
    if (typeof body.projectId !== "string" || !isUuid(body.projectId)) {
      return c.json({ error: "projectId is required (uuid)" }, 400);
    }

    const projectId = body.projectId;
    const ids = body.ids as string[];

    if (!(await canWrite(user.id, { type: "project", id: projectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);

    const { workspaceId } = proj;

    // Concurrency guard: at most 3 in-flight literature imports per
    // workspace. The queued state covers the brief window between row
    // insert and Temporal startWorkflow returning.
    const running = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.workspaceId, workspaceId),
          eq(importJobs.source, "literature_search"),
          eq(importJobs.status, "running"),
        ),
      );
    if (running.length >= 3) {
      return c.json(
        { error: "Too many concurrent imports — try again shortly" },
        429,
      );
    }

    // Pre-check dedupe by DOI so the response can tell the UI which ids
    // were skipped before the workflow even starts. The worker repeats
    // this check inside the workflow (lit_dedupe_check) — both layers
    // exist because the workflow is the authoritative race-free path,
    // and this layer just trims the user-facing surface.
    const doiIds = ids.filter((id) => !id.startsWith("arxiv:"));
    let skipped: string[] = [];
    if (doiIds.length > 0) {
      const existingRows = await db
        .select({ doi: notes.doi })
        .from(notes)
        .where(
          and(
            eq(notes.workspaceId, workspaceId),
            isNull(notes.deletedAt),
            // pgvector inArray fails on enums sometimes — but doi is plain
            // text, so a single SQL with `in (...)` would work. Looping
            // here keeps it readable for batches of ≤50 ids and avoids
            // a second `inArray` import.
          ),
        );
      const existingDois = new Set(
        existingRows.map((r) => r.doi).filter((d): d is string => !!d),
      );
      skipped = doiIds.filter((d) => existingDois.has(d));
    }

    const freshIds = ids.filter((id) => !skipped.includes(id));
    if (freshIds.length === 0) {
      return c.json(
        { jobId: null, workflowId: null, skipped, queued: 0 },
        202,
      );
    }

    const jobId = randomUUID();
    const workflowId = `lit-import-${randomUUID()}`;

    await db.insert(importJobs).values({
      id: jobId,
      workspaceId,
      userId: user.id,
      source: "literature_search",
      workflowId,
      sourceMetadata: {
        sources: ["arxiv", "semantic_scholar"],
        selectedIds: freshIds,
        totalResults: ids.length,
      },
    });

    const client = await getTemporalClient();
    await client.workflow.start("LitImportWorkflow", {
      taskQueue: taskQueue(),
      workflowId,
      args: [
        {
          job_id: jobId,
          user_id: user.id,
          workspace_id: workspaceId,
          ids: freshIds,
        },
      ],
    });

    return c.json(
      { jobId, workflowId, skipped, queued: freshIds.length },
      202,
    );
  })

  .get("/import/:jobId", async (c) => {
    const user = c.get("user");
    const jobId = c.req.param("jobId");
    if (!isUuid(jobId)) return c.json({ error: "Not found" }, 404);

    const [row] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, jobId));
    if (!row) return c.json({ error: "Not found" }, 404);
    // Owner-only read — workspace-wide visibility is a Tier-1 follow-up
    // (would need a workspaceMembers lookup; out of scope here).
    if (row.userId !== user.id) return c.json({ error: "Forbidden" }, 403);

    return c.json({
      status: row.status,
      totalItems: row.totalItems,
      completedItems: row.completedItems,
      failedItems: row.failedItems,
      finishedAt: row.finishedAt ?? null,
    });
  });
