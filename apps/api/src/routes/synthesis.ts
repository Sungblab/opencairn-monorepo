import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, projects, eq } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { canRead, canWrite } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Plan 8 — Synthesis Agent public API.
//
// POST /api/synthesis/run  → starts SynthesisWorkflow, returns workflowId 202.
// The caller supplies a list of note IDs it can already read (canRead enforced
// per note), a projectId, and an optional title / style string.

const synthesisRoutes = new Hono<AppEnv>();

const runSchema = z.object({
  noteIds: z
    .array(z.string().uuid())
    .min(1, "At least one note is required")
    .max(10, "At most 10 notes can be synthesized at once"),
  projectId: z.string().uuid(),
  title: z.string().max(200).optional(),
  style: z.string().max(100).optional(),
});

synthesisRoutes.post(
  "/run",
  requireAuth,
  zValidator("json", runSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    // Resolve project → workspace, checking write access on the project
    // (synthesis creates a new note in the project).
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "notFound" }, 404);

    if (!(await canWrite(userId, { type: "project", id: body.projectId }))) {
      return c.json({ error: "notFound" }, 404);
    }

    // Verify the user can read each source note. Any missing / inaccessible
    // note fails the whole request rather than silently skipping — the caller
    // should only pass IDs it has already loaded in its UI.
    for (const noteId of body.noteIds) {
      const ok = await canRead(userId, { type: "note", id: noteId });
      if (!ok) {
        return c.json({ error: "notFound" }, 404);
      }
    }

    const client = await getTemporalClient();
    const workflowId = `synthesis-${randomUUID()}`;

    await client.workflow.start("SynthesisWorkflow", {
      taskQueue: taskQueue(),
      workflowId,
      args: [
        {
          note_ids: body.noteIds,
          project_id: body.projectId,
          workspace_id: proj.workspaceId,
          user_id: userId,
          title: body.title ?? "Synthesis",
          style: body.style ?? "",
          workflowId,
        },
      ],
    });

    return c.json({ workflowId }, 202);
  },
);

export { synthesisRoutes };
