import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  createAgenticPlanRequestSchema,
  listAgenticPlansQuerySchema,
  recoverAgenticPlanStepRequestSchema,
  startAgenticPlanRequestSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import {
  AgenticPlanError,
  createAgenticPlan,
  getAgenticPlan,
  listAgenticPlans,
  recoverAgenticPlanStep,
  startAgenticPlan,
  type AgenticPlanServiceOptions,
} from "../lib/agentic-plans";
import type { AppEnv } from "../lib/types";

const projectParamSchema = z.object({ projectId: z.string().uuid() });
const planParamSchema = projectParamSchema.extend({ planId: z.string().uuid() });

export interface AgenticPlanRouteOptions extends AgenticPlanServiceOptions {
  auth?: MiddlewareHandler<AppEnv>;
}

export function createAgenticPlanRoutes(options?: AgenticPlanRouteOptions) {
  const auth = options?.auth ?? requireAuth;
  const serviceOptions: AgenticPlanServiceOptions = {
    ...(options?.repo ? { repo: options.repo } : {}),
    ...(options?.canReadProject ? { canReadProject: options.canReadProject } : {}),
    ...(options?.canWriteProject ? { canWriteProject: options.canWriteProject } : {}),
    ...(options?.createAgentAction ? { createAgentAction: options.createAgentAction } : {}),
    ...(options?.createCodeProjectRepairAction
      ? { createCodeProjectRepairAction: options.createCodeProjectRepairAction }
      : {}),
    ...(options?.requestDocumentGeneration
      ? { requestDocumentGeneration: options.requestDocumentGeneration }
      : {}),
    ...(options?.requestGoogleWorkspaceExport
      ? { requestGoogleWorkspaceExport: options.requestGoogleWorkspaceExport }
      : {}),
  };

  return new Hono<AppEnv>()
    .get(
      "/projects/:projectId/agentic-plans",
      auth,
      zValidator("param", projectParamSchema),
      zValidator("query", listAgenticPlansQuerySchema),
      async (c) => {
        try {
          const plans = await listAgenticPlans(
            c.req.valid("param").projectId,
            c.get("userId"),
            c.req.valid("query"),
            serviceOptions,
          );
          return c.json({ plans });
        } catch (err) {
          return agenticPlanError(c, err);
        }
      },
    )
    .post(
      "/projects/:projectId/agentic-plans",
      auth,
      zValidator("param", projectParamSchema),
      zValidator("json", createAgenticPlanRequestSchema),
      async (c) => {
        try {
          const plan = await createAgenticPlan(
            c.req.valid("param").projectId,
            c.get("userId"),
            c.req.valid("json"),
            serviceOptions,
          );
          return c.json({ plan }, 201);
        } catch (err) {
          return agenticPlanError(c, err);
        }
      },
    )
    .get(
      "/projects/:projectId/agentic-plans/:planId",
      auth,
      zValidator("param", planParamSchema),
      async (c) => {
        try {
          const { projectId, planId } = c.req.valid("param");
          const plan = await getAgenticPlan(projectId, c.get("userId"), planId, serviceOptions);
          return c.json({ plan });
        } catch (err) {
          return agenticPlanError(c, err);
        }
      },
    )
    .post(
      "/projects/:projectId/agentic-plans/:planId/start",
      auth,
      zValidator("param", planParamSchema),
      zValidator("json", startAgenticPlanRequestSchema),
      async (c) => {
        try {
          const { projectId, planId } = c.req.valid("param");
          const plan = await startAgenticPlan(
            projectId,
            c.get("userId"),
            planId,
            c.req.valid("json"),
            serviceOptions,
          );
          return c.json({ plan });
        } catch (err) {
          return agenticPlanError(c, err);
        }
      },
    )
    .post(
      "/projects/:projectId/agentic-plans/:planId/recover",
      auth,
      zValidator("param", planParamSchema),
      zValidator("json", recoverAgenticPlanStepRequestSchema),
      async (c) => {
        try {
          const { projectId, planId } = c.req.valid("param");
          const plan = await recoverAgenticPlanStep(
            projectId,
            c.get("userId"),
            planId,
            c.req.valid("json"),
            serviceOptions,
          );
          return c.json({ plan });
        } catch (err) {
          return agenticPlanError(c, err);
        }
      },
    );
}

export const agenticPlanRoutes = createAgenticPlanRoutes();

function agenticPlanError(
  c: import("hono").Context<AppEnv>,
  err: unknown,
): Response {
  if (err instanceof AgenticPlanError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  console.error("[agentic-plans] unhandled error", err);
  return c.json({ error: "agentic_plan_failed" }, 503);
}
