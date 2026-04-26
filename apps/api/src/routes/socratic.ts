import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

const generateSchema = z.object({
  conceptName: z.string().min(1).max(200),
  noteContext: z.string().max(8000).default(""),
});

const evaluateSchema = z.object({
  conceptName: z.string().min(1).max(200),
  question: z.string().min(1).max(2000),
  userAnswer: z.string().min(1).max(4000),
  noteContext: z.string().max(8000).default(""),
});

export const socraticRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  // POST /:projectId/socratic/generate
  .post(
    "/:projectId/socratic/generate",
    zValidator("json", generateSchema),
    async (c) => {
      const userId = c.get("userId");
      const { projectId } = c.req.param();
      if (!isUuid(projectId)) return c.json({ error: "not_found" }, 404);

      const allowed = await canRead(userId, { type: "project", id: projectId });
      if (!allowed) return c.json({ error: "forbidden" }, 403);

      const body = c.req.valid("json");
      const client = await getTemporalClient();
      const handle = await client.workflow.start("SocraticGenerateWorkflow", {
        workflowId: `socratic-gen-${userId}-${Date.now()}`,
        taskQueue: taskQueue(),
        args: [{ conceptName: body.conceptName, noteContext: body.noteContext }],
      });
      const result = await handle.result();
      return c.json(result);
    },
  )

  // POST /:projectId/socratic/evaluate
  .post(
    "/:projectId/socratic/evaluate",
    zValidator("json", evaluateSchema),
    async (c) => {
      const userId = c.get("userId");
      const { projectId } = c.req.param();
      if (!isUuid(projectId)) return c.json({ error: "not_found" }, 404);

      const allowed = await canRead(userId, { type: "project", id: projectId });
      if (!allowed) return c.json({ error: "forbidden" }, 403);

      const body = c.req.valid("json");
      const client = await getTemporalClient();
      const handle = await client.workflow.start("SocraticEvaluateWorkflow", {
        workflowId: `socratic-eval-${userId}-${Date.now()}`,
        taskQueue: taskQueue(),
        args: [
          {
            conceptName: body.conceptName,
            question: body.question,
            userAnswer: body.userAnswer,
            noteContext: body.noteContext,
          },
        ],
      });
      const result = await handle.result();
      return c.json(result);
    },
  );
