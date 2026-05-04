import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, projects, eq } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Plan 8 — Librarian Agent public API.
//
// POST /api/librarian/run
//   -> starts LibrarianWorkflow for one project and returns { workflowId } 202.
//
// Librarian mutates the knowledge graph by merging duplicates and strengthening
// links, so it requires project write access.

const librarianRoutes = new Hono<AppEnv>();

const runSchema = z.object({
  projectId: z.string().uuid(),
});

librarianRoutes.post(
  "/run",
  requireAuth,
  zValidator("json", runSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const [project] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!project) return c.json({ error: "notFound" }, 404);

    if (!(await canWrite(userId, { type: "project", id: body.projectId }))) {
      return c.json({ error: "notFound" }, 404);
    }

    const client = await getTemporalClient();
    const workflowId = `librarian-${randomUUID()}`;

    await client.workflow.start("LibrarianWorkflow", {
      taskQueue: taskQueue(),
      workflowId,
      args: [
        {
          project_id: body.projectId,
          workspace_id: project.workspaceId,
          user_id: userId,
          workflowId,
        },
      ],
    });

    return c.json({ workflowId }, 202);
  },
);

export { librarianRoutes };
