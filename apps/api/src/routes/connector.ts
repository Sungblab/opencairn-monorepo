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
  desc,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { canRead } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Plan 8 — Connector Agent public API.
//
// POST /api/connector/run       → starts ConnectorWorkflow, returns workflowId 202.
// GET  /api/connector/suggestions → list pending connector_link suggestions for a project.

const connectorRoutes = new Hono<AppEnv>();

const runSchema = z.object({
  conceptId: z.string().uuid(),
  projectId: z.string().uuid(),
  threshold: z.number().min(0).max(1).optional().default(0.75),
  topK: z.number().int().min(1).max(50).optional().default(10),
});

connectorRoutes.post(
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
    if (!proj) return c.json({ error: "project_not_found" }, 404);

    if (!(await canRead(userId, { type: "project", id: body.projectId }))) {
      return c.json({ error: "project_not_found" }, 404);
    }

    const client = await getTemporalClient();
    const workflowId = `connector-${randomUUID()}`;

    await client.workflow.start("ConnectorWorkflow", {
      taskQueue: taskQueue(),
      workflowId,
      args: [
        {
          concept_id: body.conceptId,
          project_id: body.projectId,
          workspace_id: proj.workspaceId,
          user_id: userId,
          threshold: body.threshold,
          top_k: body.topK,
          workflowId,
        },
      ],
    });

    return c.json({ workflowId }, 202);
  },
);

connectorRoutes.get(
  "/suggestions",
  requireAuth,
  async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.query("projectId");

    if (!projectId) {
      return c.json({ error: "projectId required" }, 400);
    }

    // Validate UUID shape to avoid pg errors.
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(projectId)) {
      return c.json({ error: "invalid projectId" }, 400);
    }

    const rows = await db
      .select()
      .from(suggestions)
      .where(
        and(
          eq(suggestions.userId, userId),
          eq(suggestions.projectId, projectId),
          eq(suggestions.type, "connector_link"),
          eq(suggestions.status, "pending"),
        ),
      )
      .orderBy(desc(suggestions.createdAt))
      .limit(50);

    return c.json(rows);
  },
);

export { connectorRoutes };
