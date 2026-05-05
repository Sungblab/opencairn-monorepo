import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../lib/types";
import {
  getWorkflowConsoleRun,
  listWorkflowConsoleRuns,
  WorkflowConsoleError,
  type WorkflowConsoleServiceOptions,
} from "../lib/workflow-console";

const projectParamSchema = z.object({ projectId: z.string().uuid() });
const runParamSchema = projectParamSchema.extend({ runId: z.string().min(1) });
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface WorkflowConsoleRouteOptions extends WorkflowConsoleServiceOptions {
  auth?: MiddlewareHandler<AppEnv>;
}

export function createWorkflowConsoleRoutes(options?: WorkflowConsoleRouteOptions) {
  const auth = options?.auth ?? requireAuth;
  return new Hono<AppEnv>()
    .get(
      "/projects/:projectId/workflow-console/runs",
      auth,
      zValidator("param", projectParamSchema),
      zValidator("query", listQuerySchema),
      async (c) => {
        try {
          const projectId = c.req.valid("param").projectId;
          const userId = c.get("userId");
          const { limit } = c.req.valid("query");
          const runs = await listWorkflowConsoleRuns(projectId, userId, {
            ...options,
            limit,
          });
          return c.json({ runs });
        } catch (err) {
          return workflowConsoleError(c, err);
        }
      },
    )
    .get(
      "/projects/:projectId/workflow-console/runs/:runId",
      auth,
      zValidator("param", runParamSchema),
      async (c) => {
        try {
          const { projectId, runId } = c.req.valid("param");
          const userId = c.get("userId");
          const run = await getWorkflowConsoleRun(projectId, userId, runId, options);
          return c.json({ run });
        } catch (err) {
          return workflowConsoleError(c, err);
        }
      },
    );
}

export const workflowConsoleRoutes = createWorkflowConsoleRoutes();

function workflowConsoleError(
  c: import("hono").Context<AppEnv>,
  err: unknown,
): Response {
  if (err instanceof WorkflowConsoleError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  console.error("[workflow-console] unhandled error", err);
  return c.json({ error: "workflow_console_failed" }, 503);
}
