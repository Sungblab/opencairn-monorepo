import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, projects, eq } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { canRead } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Plan 8 — Temporal/Staleness Agent public API.
//
// POST /api/agents/temporal/stale-check
//   → starts StalenessWorkflow, returns { workflowId } 202.
//
// Named "temporal" in the route prefix to match the agent's design scope
// (time-based staleness detection) while the workflow/activity code uses
// the package name "staleness" / "temporal_agent" to avoid collision with
// the `temporalio` Python package.

const stalenessRoutes = new Hono<AppEnv>();

const staleCheckSchema = z.object({
  projectId: z.string().uuid(),
  staleDays: z.number().int().min(1).max(365).optional().default(90),
  maxNotes: z.number().int().min(1).max(50).optional().default(20),
  scoreThreshold: z.number().min(0).max(1).optional().default(0.5),
});

stalenessRoutes.post(
  "/stale-check",
  requireAuth,
  zValidator("json", staleCheckSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "project_not_found" }, 404);

    if (!(await canRead(userId, { type: "project", id: body.projectId }))) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const client = await getTemporalClient();
    const workflowId = `staleness-${randomUUID()}`;

    await client.workflow.start("StalenessWorkflow", {
      taskQueue: taskQueue(),
      workflowId,
      args: [
        {
          workspace_id: proj.workspaceId,
          project_id: body.projectId,
          user_id: userId,
          stale_days: body.staleDays,
          max_notes: body.maxNotes,
          score_threshold: body.scoreThreshold,
        },
      ],
    });

    return c.json({ workflowId }, 202);
  },
);

export { stalenessRoutes };
