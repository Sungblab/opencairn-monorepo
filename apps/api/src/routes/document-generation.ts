import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { generateProjectObjectActionSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { AgentActionError } from "../lib/agent-actions";
import {
  requestDocumentGenerationProjectObject,
  type DocumentGenerationActionServiceOptions,
} from "../lib/document-generation-actions";
import type { AppEnv } from "../lib/types";

const projectParamSchema = z.object({ projectId: z.string().uuid() });

export interface DocumentGenerationRouteOptions extends DocumentGenerationActionServiceOptions {
  auth?: MiddlewareHandler<AppEnv>;
}

export function createDocumentGenerationRoutes(options?: DocumentGenerationRouteOptions) {
  const auth = options?.auth ?? requireAuth;
  const serviceOptions: DocumentGenerationActionServiceOptions = {
    ...(options?.repo ? { repo: options.repo } : {}),
    ...(options?.canWriteProject ? { canWriteProject: options.canWriteProject } : {}),
    ...(options?.startDocumentGeneration ? { startDocumentGeneration: options.startDocumentGeneration } : {}),
  };

  return new Hono<AppEnv>().post(
    "/projects/:projectId/project-object-actions/generate",
    auth,
    zValidator("param", projectParamSchema),
    zValidator("json", generateProjectObjectActionSchema),
    async (c) => {
      try {
        const result = await requestDocumentGenerationProjectObject(
          c.req.valid("param").projectId,
          c.get("userId"),
          c.req.valid("json"),
          serviceOptions,
        );
        return c.json(result, result.idempotent ? 200 : 202);
      } catch (err) {
        return documentGenerationError(c, err);
      }
    },
  );
}

export const documentGenerationRoutes = createDocumentGenerationRoutes();

function documentGenerationError(c: import("hono").Context<AppEnv>, err: unknown): Response {
  if (err instanceof AgentActionError) {
    return c.json({ error: err.code, message: err.message }, err.status);
  }
  console.error("[document-generation] unhandled error", err);
  return c.json({ error: "document_generation_start_failed" }, 503);
}
