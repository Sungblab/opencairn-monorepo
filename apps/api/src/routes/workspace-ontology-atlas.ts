import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, db, eq, inArray, isNull, notes } from "@opencairn/db";
import { workspaceAtlasQuerySchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { requeueNoteAnalysisJobForNote } from "../lib/note-analysis-jobs";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { isUuid } from "../lib/validators";
import { getWorkspaceOntologyAtlasForUser } from "../lib/workspace-ontology-atlas";
import type { AppEnv } from "../lib/types";

const refreshAtlasEvidenceSchema = z.object({
  noteIds: z.array(z.string().uuid()).min(1).max(20),
});

export const workspaceOntologyAtlasRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get(
    "/:workspaceId/ontology-atlas",
    zValidator("query", workspaceAtlasQuerySchema),
    async (c) => {
      const user = c.get("user");
      const workspaceId = c.req.param("workspaceId");
      if (!isUuid(workspaceId)) {
        return c.json({ error: "bad-request" }, 400);
      }
      const body = await getWorkspaceOntologyAtlasForUser(
        user.id,
        workspaceId,
        c.req.valid("query"),
      );
      if (!body) return c.json({ error: "forbidden" }, 403);
      return c.json(body);
    },
  )
  .post(
    "/:workspaceId/ontology-atlas/refresh",
    zValidator("json", refreshAtlasEvidenceSchema),
    async (c) => {
      const user = c.get("user");
      const workspaceId = c.req.param("workspaceId");
      if (!isUuid(workspaceId)) {
        return c.json({ error: "bad-request" }, 400);
      }
      const body = c.req.valid("json");
      const requestedNoteIds = [...new Set(body.noteIds)];
      const rows = await db
        .select({
          id: notes.id,
          projectId: notes.projectId,
          workspaceId: notes.workspaceId,
        })
        .from(notes)
        .where(
          and(
            inArray(notes.id, requestedNoteIds),
            eq(notes.workspaceId, workspaceId),
            isNull(notes.deletedAt),
          ),
        );
      const rowById = new Map(rows.map((row) => [row.id, row]));
      const permissionResults = await Promise.all(
        requestedNoteIds.map(async (noteId) => {
          const row = rowById.get(noteId);
          if (!row) return { error: "not-found" as const };
          if (!(await canWrite(user.id, { type: "note", id: noteId }))) {
            return { error: "forbidden" as const };
          }
          return { error: null };
        }),
      );
      const firstPermissionError = permissionResults.find(
        (result) => result.error,
      );
      if (firstPermissionError?.error === "not-found") {
        return c.json({ error: "not-found" }, 404);
      }
      if (firstPermissionError?.error === "forbidden") {
        return c.json({ error: "forbidden" }, 403);
      }

      const temporal = await getTemporalClient();
      const compilerWorkflowIds: string[] = [];
      const compilerStartFailures: Array<{ noteId: string; message: string }> = [];
      for (const noteId of requestedNoteIds) {
        const row = rowById.get(noteId);
        if (!row) continue;
        const workflowId = `compiler-refresh-${noteId}-${randomUUID()}`;
        try {
          await temporal.workflow.start("CompilerWorkflow", {
            taskQueue: taskQueue(),
            workflowId,
            args: [
              {
                note_id: noteId,
                project_id: row.projectId,
                workspace_id: row.workspaceId,
                user_id: user.id,
              },
            ],
          });
          compilerWorkflowIds.push(workflowId);
        } catch (error) {
          compilerStartFailures.push({
            noteId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const queueResults = await Promise.all(
        requestedNoteIds.map((noteId) => {
          const row = rowById.get(noteId);
          return requeueNoteAnalysisJobForNote({
            noteId,
            projectId: row?.projectId,
            debounceMs: 0,
          });
        }),
      );
      if (compilerWorkflowIds.length === 0 && compilerStartFailures.length > 0) {
        return c.json(
          {
            error: "compiler-start-failed",
            compilerStartFailures,
          },
          503,
        );
      }
      return c.json(
        {
          noteIds: requestedNoteIds,
          queuedNoteAnalysisJobs: queueResults.filter((result) => result.status === "queued").length,
          compilerWorkflowIds,
          compilerStartFailures,
        },
        compilerStartFailures.length > 0 ? 207 : 202,
      );
    },
  );
