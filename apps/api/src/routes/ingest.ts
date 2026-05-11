import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { uploadObject } from "../lib/s3";
import { streamObject } from "../lib/s3-get";
import { getTemporalClient } from "../lib/temporal-client";
import { getRedis } from "../lib/redis";
import type { AppEnv } from "../lib/types";
import { db, ingestJobs, projects, eq } from "@opencairn/db";
import { createSourceBundleForUpload } from "../lib/project-tree-service";
import { emitTreeEvent } from "../lib/tree-events";

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "ingest";

function isContentEnrichmentEnabled() {
  return (process.env.FEATURE_CONTENT_ENRICHMENT ?? "false").toLowerCase() === "true";
}

function parseBytes(envVal: string | undefined, defaultVal: number): number {
  if (envVal === undefined) return defaultVal;
  const n = Number(envVal);
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

const MAX_UPLOAD = parseBytes(process.env.MAX_UPLOAD_BYTES, 200 * 1024 * 1024);
const MAX_IMAGE = parseBytes(process.env.MAX_IMAGE_BYTES, 20 * 1024 * 1024);
const MAX_AV = parseBytes(process.env.MAX_AUDIO_VIDEO_BYTES, 500 * 1024 * 1024);

// Universal request-body ceiling: the largest allowed per-type limit.
// Per-type checks after parseBody still run to reject e.g. a 100MB image.
const MAX_BODY = Math.max(MAX_UPLOAD, MAX_IMAGE, MAX_AV);

function maxBytesFor(mimeType: string): number {
  if (mimeType.startsWith("image/")) return MAX_IMAGE;
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) return MAX_AV;
  return MAX_UPLOAD;
}

// Allowlist — only the MIME types the ingest pipeline actually handles.
// Anything else is rejected with 415 BEFORE we touch storage, so untrusted
// client Content-Type can't be persisted as object metadata (stored-XSS vector).
const ALLOWED_MIME_PREFIXES = ["audio/", "video/", "image/"] as const;
const ALLOWED_MIME_EXACT = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/msword", // doc
  "application/vnd.ms-powerpoint", // ppt
  "application/vnd.ms-excel", // xls
  "application/x-hwp", // hwp
  "application/haansofthwp", // hwp alt
  "application/vnd.hancom.hwp", // hwp alt
  "application/vnd.hancom.hwpx", // hwpx
  "text/plain",
  "text/markdown",
]);

function isAllowedMime(m: string): boolean {
  if (ALLOWED_MIME_EXACT.has(m)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p));
}

function isYoutubeUrl(raw: string): boolean {
  try {
    const hostname = new URL(raw).hostname.toLowerCase();
    return (
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}

// Resolves the workspace that owns a project so we can stamp
// `ingest_jobs` with both the user and the workspace. Returns null if
// the project has been deleted between the `canWrite` check and the
// dispatch (vanishingly rare; we treat it as a terminal "forbidden").
// [Tier 1 item 1-5]
async function findProjectWorkspace(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId));
  return row?.workspaceId ?? null;
}

const urlSchema = z.object({
  url: z.string().url(),
  projectId: z.string().uuid(),
  noteId: z.string().uuid().optional(),
});

export const ingestRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  // POST /ingest/upload — multipart 파일 → MinIO → Temporal IngestWorkflow
  .post(
    "/upload",
    // Pre-parse body-size guard: rejects at Content-Length or aborts the
    // stream once it exceeds MAX_BODY, so we never buffer a 10GB upload.
    bodyLimit({
      maxSize: MAX_BODY,
      onError: (c) =>
        c.json({ error: "Request body exceeds maximum size" }, 413),
    }),
    async (c) => {
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

      // MIME allowlist — must come BEFORE maxBytesFor / uploadObject so the
      // client-supplied Content-Type can never be persisted as S3 metadata
      // if it falls outside the ingest pipeline's known-safe types.
      const clientMime = file.type || "";
      if (!isAllowedMime(clientMime)) {
        return c.json(
          { error: `Unsupported media type: ${clientMime || "<empty>"}` },
          415,
        );
      }

      const maxAllowed = maxBytesFor(clientMime);
      if (file.size > maxAllowed) {
        return c.json(
          { error: `File exceeds ${maxAllowed} bytes for type ${clientMime}` },
          413,
        );
      }

      // TODO Plan 3 follow-up: stream via file.stream() to MinIO instead of
      // buffering the full file in memory. bodyLimit() above caps the worst case.
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "bin") : "bin";
      const objectKey = `uploads/${user.id}/${randomUUID()}.${ext}`;

      await uploadObject(objectKey, buffer, clientMime);

      const workflowId = `ingest-${randomUUID()}`;
      const workspaceId = await findProjectWorkspace(projectId);
      if (!workspaceId) {
        return c.json({ error: "Project not found" }, 404);
      }
      const sourceBundle =
        clientMime === "application/pdf"
          ? await createSourceBundleForUpload({
              workspaceId,
              projectId,
              userId: user.id,
              workflowId,
              objectKey,
              fileName: file.name,
              mimeType: clientMime,
              bytes: buffer,
            })
          : null;
      if (sourceBundle) {
        const at = new Date().toISOString();
        emitTreeEvent({
          kind: "tree.node_created",
          projectId,
          id: sourceBundle.bundleNodeId,
          parentId: null,
          label: file.name,
          at,
        });
      }
      const client = await getTemporalClient();

      // Persist dispatch metadata BEFORE starting the workflow so the
      // status handler can enforce an owner check the moment the
      // workflow becomes queryable. If the subsequent Temporal call
      // fails, the row is harmless (no workflow actually runs against
      // it, and the workflow_id unique constraint blocks accidental
      // reuse). [Tier 1 item 1-5]
      await db.insert(ingestJobs).values({
        workflowId,
        userId: user.id,
        workspaceId,
        projectId,
        source: "upload",
      });

      await client.workflow.start("IngestWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [
          {
            object_key: objectKey,
            file_name: file.name,
            mime_type: clientMime,
            user_id: user.id,
            project_id: projectId,
            note_id: noteId ?? null,
            workspace_id: workspaceId,
            content_enrichment_enabled: isContentEnrichmentEnabled(),
            source_bundle_node_id: sourceBundle?.bundleNodeId ?? null,
            original_file_node_id: sourceBundle?.originalFileNodeId ?? null,
            parsed_group_node_id: sourceBundle?.parsedGroupNodeId ?? null,
            figures_group_node_id: sourceBundle?.figuresGroupNodeId ?? null,
            analysis_group_node_id: sourceBundle?.analysisGroupNodeId ?? null,
          },
        ],
      });

      return c.json(
        {
          workflowId,
          objectKey,
          sourceBundleNodeId: sourceBundle?.bundleNodeId ?? null,
          originalFileId: sourceBundle?.originalFileId ?? null,
        },
        202,
      );
    },
  )

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

    const isYoutube = isYoutubeUrl(url);
    const mimeType = isYoutube ? "x-opencairn/youtube" : "x-opencairn/web-url";

    const workflowId = `ingest-url-${randomUUID()}`;
    const workspaceId = await findProjectWorkspace(projectId);
    if (!workspaceId) {
      return c.json({ error: "Project not found" }, 404);
    }
    const client = await getTemporalClient();

    // Same owner-tracking row as /upload so GET /status can enforce it. [Tier 1 1-5]
    await db.insert(ingestJobs).values({
      workflowId,
      userId: user.id,
      workspaceId,
      projectId,
      source: isYoutube ? "youtube" : "web-url",
    });

    await client.workflow.start("IngestWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [
        {
          url,
          object_key: null,
          file_name: null,
          mime_type: mimeType,
          user_id: user.id,
          project_id: projectId,
          note_id: noteId ?? null,
          workspace_id: workspaceId,
          content_enrichment_enabled: isContentEnrichmentEnabled(),
        },
      ],
    });

    return c.json({ workflowId }, 202);
  })

  // GET /ingest/status/:workflowId — poll Temporal for workflow status.
  // Auth: caller must be the user who dispatched the workflow. The
  // `ingest_jobs` table pins workflow ids to (userId, workspaceId,
  // projectId) so random / guessed workflow ids return 404 (no row) and
  // a different authenticated user hits 403 on someone else's job.
  // [Tier 1 item 1-5 / Plan 3 H-1]
  .get("/status/:workflowId", async (c) => {
    const user = c.get("user");
    const workflowId = c.req.param("workflowId");

    const [row] = await db
      .select({ userId: ingestJobs.userId })
      .from(ingestJobs)
      .where(eq(ingestJobs.workflowId, workflowId));
    if (!row) {
      return c.json({ error: "Not found" }, 404);
    }
    if (row.userId !== user.id) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    return c.json({
      workflowId,
      status: desc.status.name,
      startTime: desc.startTime,
      closeTime: desc.closeTime ?? null,
    });
  })

  // GET /ingest/stream/:workflowId — Server-Sent Events for live ingest
  // visibility (Plan: live-ingest-visualization Task 7).
  //
  // Auth model mirrors /status/:workflowId — caller must be the dispatcher.
  // The handler replays the Redis LIST backlog (events emitted before the
  // browser opened the stream) then SUBSCRIBEs to the live channel. Both
  // share a single seq counter so the client can dedupe via Last-Event-ID
  // on auto-reconnect.
  .get("/stream/:workflowId", async (c) => {
    const user = c.get("user");
    const workflowId = c.req.param("workflowId");

    const [row] = await db
      .select({ userId: ingestJobs.userId })
      .from(ingestJobs)
      .where(eq(ingestJobs.workflowId, workflowId));
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.userId !== user.id) return c.json({ error: "Forbidden" }, 403);

    const lastEventId = c.req.header("Last-Event-ID");
    const lastSeq = lastEventId ? Number(lastEventId) : 0;

    return streamSSE(c, async (stream) => {
      const r = getRedis();
      const subscriber = r.duplicate();
      let lastSent = Number.isFinite(lastSeq) ? lastSeq : 0;
      let closed = false;

      // Keepalive — proxies often close idle SSE connections after ~60s.
      const keepalive = setInterval(() => {
        void stream
          .writeSSE({ event: "keepalive", data: "" })
          .catch(() => {});
      }, 30_000);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        try {
          await subscriber.quit();
        } catch {
          // best-effort — already disconnected or never connected
        }
      };

      // Register abort handler BEFORE any await so a client that disconnects
      // during the backlog replay still triggers cleanup of the duplicate
      // Redis socket and the keepalive interval.
      stream.onAbort(() => {
        void cleanup();
      });

      try {
        // 1) Subscribe FIRST so messages published during the LRANGE window
        //    aren't lost. The dedup via lastSent handles the duplicate
        //    delivery (same event reachable via both channel and LIST).
        subscriber.on("message", async (_chan, raw) => {
          if (closed) return;
          try {
            const ev = JSON.parse(raw) as { seq: number; kind: string };
            if (ev.seq <= lastSent) return;
            await stream.writeSSE({ id: String(ev.seq), data: raw });
            lastSent = ev.seq;
            if (ev.kind === "completed" || ev.kind === "failed") {
              await cleanup();
              stream.close();
            }
          } catch {
            // ignore malformed
          }
        });
        await subscriber.subscribe(`ingest:events:${workflowId}`);

        // 2) Replay backlog. LPUSH stores newest first; reverse to chronological.
        //    Any event that landed between subscribe() and lrange() arrives
        //    via both paths; lastSent dedups.
        const backlog = await r.lrange(`ingest:replay:${workflowId}`, 0, -1);
        for (const raw of backlog.reverse()) {
          if (closed) break;
          try {
            const ev = JSON.parse(raw) as { seq: number; kind: string };
            if (ev.seq > lastSent) {
              await stream.writeSSE({ id: String(ev.seq), data: raw });
              lastSent = ev.seq;
            }
          } catch {
            // Malformed payload — skip; never break the stream over one bad row.
          }
        }
      } catch {
        // Any unhandled error during setup must not leak the subscriber.
        await cleanup();
      }
    });
  })

  // GET /ingest/figures/:wfid/:filename — stream proxy for extracted PDF
  // figures so the browser doesn't need a presigned MinIO URL. Auth gate is
  // identical to /stream — only the dispatcher of the workflow can read its
  // figures. Filename is constrained to a basename so traversal can't reach
  // sibling user prefixes.
  .get("/figures/:wfid/:filename", async (c) => {
    const user = c.get("user");
    const workflowId = c.req.param("wfid");
    const filename = c.req.param("filename");

    if (
      !filename ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("..")
    ) {
      return c.json({ error: "Invalid filename" }, 400);
    }

    const [row] = await db
      .select({ userId: ingestJobs.userId })
      .from(ingestJobs)
      .where(eq(ingestJobs.workflowId, workflowId));
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.userId !== user.id) return c.json({ error: "Forbidden" }, 403);

    const objectKey = `uploads/${user.id}/figures/${workflowId}/${filename}`;
    try {
      const obj = await streamObject(objectKey);
      return new Response(obj.stream, {
        headers: {
          "content-type": obj.contentType || "image/png",
          "content-length": String(obj.contentLength),
          "cache-control": "private, max-age=3600",
        },
      });
    } catch {
      return c.json({ error: "Figure not found" }, 404);
    }
  });
