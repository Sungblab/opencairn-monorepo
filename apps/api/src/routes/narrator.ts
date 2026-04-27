import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, notes, projects, eq } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { canRead } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

// Plan 8 — Narrator Agent public API.
//
// POST /api/narrator/run  → starts NarratorWorkflow, returns workflowId 202.
// The caller supplies a noteId (must be readable by the current user) and
// an optional style string.

const narratorRoutes = new Hono<AppEnv>();

const runSchema = z.object({
  noteId: z.string().uuid(),
  style: z
    .enum(["conversational", "educational", "debate"])
    .optional()
    .default("conversational"),
});

narratorRoutes.post(
  "/run",
  requireAuth,
  zValidator("json", runSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    // Verify the user can read the note.
    const ok = await canRead(userId, { type: "note", id: body.noteId });
    if (!ok) return c.json({ error: "note_not_found" }, 404);

    // Look up project_id from the note.
    const [note] = await db
      .select({ projectId: notes.projectId })
      .from(notes)
      .where(eq(notes.id, body.noteId));
    if (!note) return c.json({ error: "note_not_found" }, 404);

    // Look up workspace_id from the project.
    const [proj] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, note.projectId));
    if (!proj) return c.json({ error: "project_not_found" }, 404);

    const client = await getTemporalClient();
    const workflowId = `narrator-${randomUUID()}`;

    await client.workflow.start("NarratorWorkflow", {
      taskQueue: taskQueue(),
      workflowId,
      args: [
        {
          note_id: body.noteId,
          project_id: note.projectId,
          workspace_id: proj.workspaceId,
          user_id: userId,
          style: body.style,
        },
      ],
    });

    return c.json({ workflowId }, 202);
  },
);

export { narratorRoutes };
