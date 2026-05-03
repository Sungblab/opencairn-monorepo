import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import {
  createAgentFilesSchema,
  createAgentFileVersionSchema,
  updateAgentFileSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { isUuid } from "../lib/validators";
import { emitTreeEvent } from "../lib/tree-events";
import type { AppEnv } from "../lib/types";
import {
  AgentFileError,
  compileAgentFile,
  createAgentFile,
  createAgentFileVersion,
  createCanvasFromAgentFile,
  deleteAgentFile,
  getAgentFileForRead,
  startAgentFileIngest,
  streamAgentFile,
  streamCompiledAgentFile,
  toSummary,
  updateAgentFile,
} from "../lib/agent-files";

const MAX_JSON_BODY = 7 * 1024 * 1024;

export const agentFileRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .post(
    "/",
    bodyLimit({
      maxSize: MAX_JSON_BODY,
      onError: (c) => c.json({ error: "request_too_large" }, 413),
    }),
    zValidator("json", createAgentFilesSchema),
    async (c) => {
      const userId = c.get("userId");
      const body = c.req.valid("json");
      try {
        const files = [];
        for (const file of body.files) {
          const summary = await createAgentFile({
            userId,
            projectId: body.projectId,
            source: body.source ?? "manual",
            chatThreadId: body.threadId ?? null,
            chatMessageId: body.messageId ?? null,
            file,
          });
          emitTreeEvent({
            kind: "tree.agent_file_created",
            projectId: summary.projectId,
            id: summary.id,
            parentId: summary.folderId,
            label: summary.title,
            at: new Date().toISOString(),
          });
          files.push(summary);
        }
        return c.json({ files }, 201);
      } catch (err) {
        return agentFileError(c, err);
      }
    },
  )

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    try {
      const row = await getAgentFileForRead(id, c.get("userId"));
      return c.json({ file: toSummary(row) });
    } catch (err) {
      return agentFileError(c, err);
    }
  })

  .get("/:id/file", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    try {
      return await streamAgentFile(id, c.get("userId"));
    } catch (err) {
      return agentFileError(c, err);
    }
  })

  .get("/:id/compiled", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    try {
      return await streamCompiledAgentFile(id, c.get("userId"));
    } catch (err) {
      return agentFileError(c, err);
    }
  })

  .patch("/:id", zValidator("json", updateAgentFileSchema), async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    const body = c.req.valid("json");
    try {
      const file = await updateAgentFile({
        id,
        userId: c.get("userId"),
        filename: body.filename,
        title: body.title,
        folderId: body.folderId,
      });
      emitTreeEvent({
        kind: body.folderId !== undefined ? "tree.agent_file_moved" : "tree.agent_file_renamed",
        projectId: file.projectId,
        id: file.id,
        parentId: file.folderId,
        label: file.title,
        at: new Date().toISOString(),
      });
      return c.json({ file });
    } catch (err) {
      return agentFileError(c, err);
    }
  })

  .post(
    "/:id/versions",
    bodyLimit({
      maxSize: MAX_JSON_BODY,
      onError: (c) => c.json({ error: "request_too_large" }, 413),
    }),
    zValidator("json", createAgentFileVersionSchema),
    async (c) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
      try {
        const file = await createAgentFileVersion({
          id,
          userId: c.get("userId"),
          file: c.req.valid("json"),
        });
        emitTreeEvent({
          kind: "tree.agent_file_created",
          projectId: file.projectId,
          id: file.id,
          parentId: file.folderId,
          label: file.title,
          at: new Date().toISOString(),
        });
        return c.json({ file }, 201);
      } catch (err) {
        return agentFileError(c, err);
      }
    },
  )

  .post("/:id/ingest", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    try {
      return c.json({ file: await startAgentFileIngest(id, c.get("userId")) }, 202);
    } catch (err) {
      return agentFileError(c, err);
    }
  })

  .post("/:id/compile", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    try {
      return c.json({ file: await compileAgentFile(id, c.get("userId")) }, 202);
    } catch (err) {
      return agentFileError(c, err);
    }
  })

  .post("/:id/canvas", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    try {
      return c.json(await createCanvasFromAgentFile(id, c.get("userId")), 201);
    } catch (err) {
      return agentFileError(c, err);
    }
  })

  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
    try {
      const file = await deleteAgentFile(id, c.get("userId"));
      emitTreeEvent({
        kind: "tree.agent_file_deleted",
        projectId: file.projectId,
        id: file.id,
        parentId: file.folderId,
        at: new Date().toISOString(),
      });
      return c.json({ success: true });
    } catch (err) {
      return agentFileError(c, err);
    }
  });

function agentFileError(c: import("hono").Context<AppEnv>, err: unknown): Response {
  if (err instanceof AgentFileError) {
    return c.json({ error: err.code, message: err.message }, err.status as 400 | 403 | 404 | 409 | 415);
  }
  console.error("[agent-files] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
}
