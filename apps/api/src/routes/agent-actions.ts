import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  createAgentActionRequestSchema,
  listAgentActionsQuerySchema,
  transitionAgentActionStatusRequestSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import {
  AgentActionError,
  createAgentAction,
  getAgentAction,
  listAgentActions,
  transitionAgentActionStatus,
  type AgentActionServiceOptions,
} from "../lib/agent-actions";
import type { AppEnv } from "../lib/types";

const idParamSchema = z.object({ id: z.string().uuid() });
const projectParamSchema = z.object({ projectId: z.string().uuid() });

export interface AgentActionRouteOptions extends AgentActionServiceOptions {
  auth?: MiddlewareHandler<AppEnv>;
}

export function createAgentActionRoutes(options?: AgentActionRouteOptions) {
  const auth = options?.auth ?? requireAuth;
  const serviceOptions: AgentActionServiceOptions = {
    ...(options?.repo ? { repo: options.repo } : {}),
    ...(options?.canWriteProject ? { canWriteProject: options.canWriteProject } : {}),
  };

  return new Hono<AppEnv>()
    .post(
      "/projects/:projectId/agent-actions",
      auth,
      zValidator("param", projectParamSchema),
      zValidator("json", createAgentActionRequestSchema),
      async (c) => {
        try {
          const { action, idempotent } = await createAgentAction(
            c.req.valid("param").projectId,
            c.get("userId"),
            c.req.valid("json"),
            serviceOptions,
          );
          return c.json({ action, idempotent }, idempotent ? 200 : 201);
        } catch (err) {
          return agentActionError(c, err);
        }
      },
    )
    .get(
      "/projects/:projectId/agent-actions",
      auth,
      zValidator("param", projectParamSchema),
      zValidator("query", listAgentActionsQuerySchema),
      async (c) => {
        try {
          const actions = await listAgentActions(
            c.req.valid("param").projectId,
            c.get("userId"),
            c.req.valid("query"),
            serviceOptions,
          );
          return c.json({ actions });
        } catch (err) {
          return agentActionError(c, err);
        }
      },
    )
    .get(
      "/agent-actions/:id",
      auth,
      zValidator("param", idParamSchema),
      async (c) => {
        try {
          const action = await getAgentAction(
            c.req.valid("param").id,
            c.get("userId"),
            serviceOptions,
          );
          return c.json({ action });
        } catch (err) {
          return agentActionError(c, err);
        }
      },
    )
    .patch(
      "/agent-actions/:id/status",
      auth,
      zValidator("param", idParamSchema),
      zValidator("json", transitionAgentActionStatusRequestSchema),
      async (c) => {
        try {
          const action = await transitionAgentActionStatus(
            c.req.valid("param").id,
            c.get("userId"),
            c.req.valid("json"),
            serviceOptions,
          );
          return c.json({ action });
        } catch (err) {
          return agentActionError(c, err);
        }
      },
    );
}

export const agentActionRoutes = createAgentActionRoutes();

function agentActionError(c: import("hono").Context<AppEnv>, err: unknown): Response {
  if (err instanceof AgentActionError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  console.error("[agent-actions] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
}
