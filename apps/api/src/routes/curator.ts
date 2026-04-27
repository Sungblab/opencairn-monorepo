import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  projects,
  suggestions,
  eq,
  and,
  inArray,
  desc,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Plan 8 — Curator Agent public API.
//
// POST /api/curator/run       → starts CuratorWorkflow, returns workflowId 202.
// GET  /api/curator/suggestions → list pending curator suggestions for a project.

const curatorRoutes = new Hono<AppEnv>();

const runSchema = z.object({
  projectId: z.string().uuid(),
  maxOrphans: z.number().int().min(1).max(200).optional(),
  maxDuplicatePairs: z.number().int().min(1).max(100).optional(),
  maxContradictionPairs: z.number().int().min(1).max(20).optional(),
});

curatorRoutes.post(
  "/run",
  requireAuth,
  zValidator("json", runSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "notFound" }, 404);

    if (!(await canWrite(userId, { type: "project", id: body.projectId }))) {
      return c.json({ error: "notFound" }, 404);
    }

    const client = await getTemporalClient();
    const workflowId = `curator-${randomUUID()}`;

    await client.workflow.start("CuratorWorkflow", {
      taskQueue: taskQueue(),
      workflowId,
      args: [
        {
          project_id: body.projectId,
          workspace_id: proj.workspaceId,
          user_id: userId,
          max_orphans: body.maxOrphans ?? 50,
          max_duplicate_pairs: body.maxDuplicatePairs ?? 20,
          max_contradiction_pairs: body.maxContradictionPairs ?? 5,
          workflowId,
        },
      ],
    });

    return c.json({ workflowId }, 202);
  },
);

const CURATOR_TYPES = [
  "curator_orphan",
  "curator_duplicate",
  "curator_contradiction",
] as const;

curatorRoutes.get(
  "/suggestions",
  requireAuth,
  async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.query("projectId");

    if (!projectId) {
      return c.json({ error: "projectId required" }, 400);
    }

    if (!z.string().uuid().safeParse(projectId).success) {
      return c.json({ error: "invalid projectId" }, 400);
    }

    const rows = await db
      .select()
      .from(suggestions)
      .where(
        and(
          eq(suggestions.userId, userId),
          eq(suggestions.projectId, projectId),
          inArray(suggestions.type, [...CURATOR_TYPES]),
          eq(suggestions.status, "pending"),
        ),
      )
      .orderBy(desc(suggestions.createdAt))
      .limit(50);

    return c.json(rows);
  },
);

export { curatorRoutes };
