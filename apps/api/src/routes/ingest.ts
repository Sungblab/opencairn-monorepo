import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { uploadObject } from "../lib/s3";
import { getTemporalClient } from "../lib/temporal-client";
import type { AppEnv } from "../lib/types";

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "ingest";

const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);
const MAX_IMAGE = Number(process.env.MAX_IMAGE_BYTES ?? 20 * 1024 * 1024);
const MAX_AV = Number(process.env.MAX_AUDIO_VIDEO_BYTES ?? 500 * 1024 * 1024);

function maxBytesFor(mimeType: string): number {
  if (mimeType.startsWith("image/")) return MAX_IMAGE;
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return MAX_AV;
  return MAX_UPLOAD;
}

const urlSchema = z.object({
  url: z.string().url(),
  projectId: z.string().uuid(),
  noteId: z.string().uuid().optional(),
});

export const ingestRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  // POST /ingest/upload — multipart 파일 → MinIO → Temporal IngestWorkflow
  .post("/upload", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body["file"];
    const noteId = typeof body["noteId"] === "string" ? (body["noteId"] as string) : undefined;
    const projectId = typeof body["projectId"] === "string" ? (body["projectId"] as string) : "";

    if (!(file instanceof File)) {
      return c.json({ error: "file is required" }, 400);
    }
    if (!projectId || !isUuid(projectId)) {
      return c.json({ error: "projectId is required (uuid)" }, 400);
    }
    if (noteId !== undefined && !isUuid(noteId)) {
      return c.json({ error: "noteId must be a uuid" }, 400);
    }

    // 권한: 프로젝트에 write 가능해야 업로드 허용 (note 지정 시 해당 note에도 write 필요)
    if (!(await canWrite(user.id, { type: "project", id: projectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (noteId && !(await canWrite(user.id, { type: "note", id: noteId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const maxAllowed = maxBytesFor(file.type);
    if (file.size > maxAllowed) {
      return c.json(
        { error: `File exceeds ${maxAllowed} bytes for type ${file.type}` },
        413,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "bin") : "bin";
    const objectKey = `uploads/${user.id}/${randomUUID()}.${ext}`;

    await uploadObject(objectKey, buffer, file.type || "application/octet-stream");

    const workflowId = `ingest-${randomUUID()}`;
    const client = await getTemporalClient();

    await client.workflow.start("IngestWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [
        {
          objectKey,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          userId: user.id,
          projectId,
          noteId: noteId ?? null,
        },
      ],
    });

    return c.json({ workflowId, objectKey }, 202);
  })

  // POST /ingest/url — JSON { url, projectId, noteId? } → Temporal IngestWorkflow
  .post("/url", zValidator("json", urlSchema), async (c) => {
    const user = c.get("user");
    const { url, projectId, noteId } = c.req.valid("json");

    if (!(await canWrite(user.id, { type: "project", id: projectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (noteId && !(await canWrite(user.id, { type: "note", id: noteId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const isYoutube = /(?:youtube\.com|youtu\.be)/i.test(url);
    const mimeType = isYoutube ? "x-opencairn/youtube" : "x-opencairn/web-url";

    const workflowId = `ingest-url-${randomUUID()}`;
    const client = await getTemporalClient();

    await client.workflow.start("IngestWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [
        {
          url,
          objectKey: null,
          fileName: null,
          mimeType,
          userId: user.id,
          projectId,
          noteId: noteId ?? null,
        },
      ],
    });

    return c.json({ workflowId }, 202);
  });
