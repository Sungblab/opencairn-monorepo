import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  createAgentActionRequestSchema,
  interactionChoiceRespondRequestSchema,
  listAgentActionsQuerySchema,
  transitionAgentActionStatusRequestSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import {
  AgentActionError,
  applyAgentAction,
  cancelCodeProjectRunAction,
  createCodeProjectRepairAction,
  createAgentAction,
  getAgentAction,
  listAgentActions,
  readCodeProjectPreviewAsset,
  readPublicCodeProjectPreviewAsset,
  respondToInteractionChoiceAction,
  transitionAgentActionStatus,
  type AgentActionServiceOptions,
} from "../lib/agent-actions";
import type { AppEnv } from "../lib/types";

const idParamSchema = z.object({ id: z.string().uuid() });
const publicPreviewParamSchema = z.object({
  id: z.string().uuid(),
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
});
const projectParamSchema = z.object({ projectId: z.string().uuid() });
const repairRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
}).strict();

export interface AgentActionRouteOptions extends AgentActionServiceOptions {
  auth?: MiddlewareHandler<AppEnv>;
}

export function createAgentActionRoutes(options?: AgentActionRouteOptions) {
  const auth = options?.auth ?? requireAuth;
  const serviceOptions: AgentActionServiceOptions = {
    ...(options?.repo ? { repo: options.repo } : {}),
    ...(options?.canWriteProject ? { canWriteProject: options.canWriteProject } : {}),
    ...(options?.codeWorkspaceRepo ? { codeWorkspaceRepo: options.codeWorkspaceRepo } : {}),
    ...(options?.codeCommandRunner ? { codeCommandRunner: options.codeCommandRunner } : {}),
    ...(options?.codeInstallRunner ? { codeInstallRunner: options.codeInstallRunner } : {}),
    ...(options?.codeCommandCanceller ? { codeCommandCanceller: options.codeCommandCanceller } : {}),
    ...(options?.codeRepairPlanner ? { codeRepairPlanner: options.codeRepairPlanner } : {}),
    ...(options?.noteExecutor ? { noteExecutor: options.noteExecutor } : {}),
    ...(options?.noteUpdatePreviewer ? { noteUpdatePreviewer: options.noteUpdatePreviewer } : {}),
    ...(options?.noteUpdateApplier ? { noteUpdateApplier: options.noteUpdateApplier } : {}),
    ...(options?.now ? { now: options.now } : {}),
    ...(options?.codePreviewTtlMs ? { codePreviewTtlMs: options.codePreviewTtlMs } : {}),
    ...(options?.codePreviewObjectReader ? { codePreviewObjectReader: options.codePreviewObjectReader } : {}),
    ...(options?.codePreviewPublicBaseUrl ? { codePreviewPublicBaseUrl: options.codePreviewPublicBaseUrl } : {}),
    ...(options?.codePreviewPublicUrlSecret ? { codePreviewPublicUrlSecret: options.codePreviewPublicUrlSecret } : {}),
  };

  return new Hono<AppEnv>()
    .get(
      "/public/agent-actions/:id/preview/:token/*",
      zValidator("param", publicPreviewParamSchema),
      async (c) => {
        try {
          const { id, token } = c.req.valid("param");
          const asset = await readPublicCodeProjectPreviewAsset(
            id,
            token,
            publicPreviewAssetPath(c.req.path, id, token),
            serviceOptions,
          );
          return previewAssetResponse(asset, "public, no-store");
        } catch (err) {
          return agentActionError(c, err);
        }
      },
    )
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
    )
    .post(
      "/agent-actions/:id/respond",
      auth,
      zValidator("param", idParamSchema),
      zValidator("json", interactionChoiceRespondRequestSchema),
      async (c) => {
        try {
          const action = await respondToInteractionChoiceAction(
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
    )
    .post(
      "/agent-actions/:id/apply",
      auth,
      zValidator("param", idParamSchema),
      zValidator("json", z.record(z.unknown()).default({})),
      async (c) => {
        try {
          const action = await applyAgentAction(
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
    )
    .get(
      "/agent-actions/:id/preview/*",
      auth,
      zValidator("param", idParamSchema),
      async (c) => {
        try {
          const id = c.req.valid("param").id;
          const asset = await readCodeProjectPreviewAsset(
            id,
            c.get("userId"),
            previewAssetPath(c.req.path, id),
            serviceOptions,
          );
          return previewAssetResponse(asset, "private, no-store");
        } catch (err) {
          return agentActionError(c, err);
        }
      },
    )
    .post(
      "/agent-actions/:id/cancel",
      auth,
      zValidator("param", idParamSchema),
      async (c) => {
        try {
          const { action, idempotent } = await cancelCodeProjectRunAction(
            c.req.valid("param").id,
            c.get("userId"),
            serviceOptions,
          );
          return c.json({ action, idempotent }, idempotent ? 200 : 202);
        } catch (err) {
          return agentActionError(c, err);
        }
      },
    )
    .post(
      "/agent-actions/:id/repair",
      auth,
      zValidator("param", idParamSchema),
      zValidator("json", repairRequestSchema.default({})),
      async (c) => {
        try {
          const { action, idempotent } = await createCodeProjectRepairAction(
            c.req.valid("param").id,
            c.get("userId"),
            c.req.valid("json"),
            serviceOptions,
          );
          return c.json({ action, idempotent }, idempotent ? 200 : 201);
        } catch (err) {
          return agentActionError(c, err);
        }
      },
    );
}

export const agentActionRoutes = createAgentActionRoutes();

function previewAssetPath(path: string, actionId: string): string {
  const marker = `/agent-actions/${actionId}/preview/`;
  const index = path.indexOf(marker);
  if (index < 0) return "index.html";
  return path.slice(index + marker.length) || "index.html";
}

function publicPreviewAssetPath(path: string, actionId: string, token: string): string {
  const marker = `/public/agent-actions/${actionId}/preview/${token}/`;
  const index = path.indexOf(marker);
  if (index < 0) return "index.html";
  return path.slice(index + marker.length) || "index.html";
}

function previewAssetResponse(
  asset: Awaited<ReturnType<typeof readCodeProjectPreviewAsset>>,
  cacheControl: string,
): Response {
  return new Response(asset.body, {
    headers: {
      "Content-Type": asset.contentType,
      ...(asset.contentLength != null ? { "Content-Length": String(asset.contentLength) } : {}),
      "Content-Security-Policy": [
        "sandbox allow-scripts",
        "default-src 'none'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self'",
      ].join("; "),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": cacheControl,
    },
  });
}

function agentActionError(c: import("hono").Context<AppEnv>, err: unknown): Response {
  if (err instanceof AgentActionError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  console.error("[agent-actions] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
}
