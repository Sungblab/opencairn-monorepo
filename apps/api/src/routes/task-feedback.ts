import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, db, eq, projects, taskFeedback } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import type { AppEnv } from "../lib/types";

const taskFeedbackTargetSchema = z.enum([
  "chat_run",
  "workflow_run",
  "agent_action",
  "agent_file",
  "document_generation",
]);

const taskFeedbackRatingSchema = z.enum(["useful", "not_useful", "skipped"]);

const postBody = z.object({
  projectId: z.string().uuid(),
  targetType: taskFeedbackTargetSchema,
  targetId: z.string().trim().min(1).max(240),
  artifactId: z.string().uuid().optional(),
  rating: taskFeedbackRatingSchema,
  reason: z.string().trim().min(1).max(80).optional(),
  comment: z.string().trim().min(1).max(1000).optional(),
  followUpIntent: z.string().trim().min(1).max(80).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const taskFeedbackRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .post("/", zValidator("json", postBody), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    if (!(await canRead(userId, { type: "project", id: body.projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const [project] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, body.projectId))
      .limit(1);
    if (!project) return c.json({ error: "not_found" }, 404);

    const [row] = await db
      .insert(taskFeedback)
      .values({
        workspaceId: project.workspaceId,
        projectId: body.projectId,
        userId,
        targetType: body.targetType,
        targetId: body.targetId,
        artifactId: body.artifactId ?? null,
        rating: body.rating,
        reason: body.reason ?? null,
        comment: body.comment ?? null,
        followUpIntent: body.followUpIntent ?? null,
        metadata: body.metadata ?? null,
      })
      .onConflictDoUpdate({
        target: [
          taskFeedback.projectId,
          taskFeedback.targetType,
          taskFeedback.targetId,
          taskFeedback.userId,
        ],
        set: {
          artifactId: body.artifactId ?? null,
          rating: body.rating,
          reason: body.reason ?? null,
          comment: body.comment ?? null,
          followUpIntent: body.followUpIntent ?? null,
          metadata: body.metadata ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({
        rating: taskFeedback.rating,
        reason: taskFeedback.reason,
        followUpIntent: taskFeedback.followUpIntent,
      });

    return c.json({ ok: true, feedback: row }, 201);
  })
  .get(
    "/",
    zValidator(
      "query",
      z.object({
        projectId: z.string().uuid(),
        targetType: taskFeedbackTargetSchema,
        targetId: z.string().trim().min(1).max(240),
      }),
    ),
    async (c) => {
      const userId = c.get("userId");
      const query = c.req.valid("query");

      if (!(await canRead(userId, { type: "project", id: query.projectId }))) {
        return c.json({ error: "forbidden" }, 403);
      }

      const [row] = await db
        .select({
          rating: taskFeedback.rating,
          reason: taskFeedback.reason,
          comment: taskFeedback.comment,
          followUpIntent: taskFeedback.followUpIntent,
        })
        .from(taskFeedback)
        .where(
          and(
            eq(taskFeedback.projectId, query.projectId),
            eq(taskFeedback.targetType, query.targetType),
            eq(taskFeedback.targetId, query.targetId),
            eq(taskFeedback.userId, userId),
          ),
        );

      return c.json(row ?? null);
    },
  );
