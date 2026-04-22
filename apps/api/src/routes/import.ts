import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "node:crypto";
import {
  and,
  db,
  desc,
  eq,
  importJobs,
  inArray,
  userIntegrations,
} from "@opencairn/db";
import {
  notionUploadUrlSchema,
  startDriveImportSchema,
  startNotionImportSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { getPresignedPutUrl } from "../lib/s3";
import { getTemporalClient } from "../lib/temporal-client";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// Hard ceiling on a single Notion export ZIP. Defaults to 5GB (matches the
// zod schema cap). Deployments can lower it via env — useful for local dev
// or free-tier plans. A separate 413 branch exists so the schema's own 400
// doesn't have to double as a "too big" signal.
function maxZipBytes(): number {
  const raw = process.env.IMPORT_NOTION_ZIP_MAX_BYTES;
  if (!raw) return 5 * 1024 * 1024 * 1024;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024 * 1024;
}

export const importRouter = new Hono<AppEnv>();

importRouter.post(
  "/notion/upload-url",
  requireAuth,
  zValidator("json", notionUploadUrlSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const ceiling = maxZipBytes();
    if (body.size > ceiling) {
      return c.json({ error: "zip_too_large", maxBytes: ceiling }, 413);
    }

    const allowed = await canWrite(userId, {
      type: "workspace",
      id: body.workspaceId,
    });
    if (!allowed) {
      return c.json({ error: "Forbidden" }, 403);
    }

    // Object key layout: imports/notion/<ws>/<user>/<ts>-<uuid>.zip.
    // The workspace + user prefix lets us garbage-collect stale uploads
    // by prefix scan and keeps per-user traffic separated for auditing.
    const objectKey = `imports/notion/${body.workspaceId}/${userId}/${Date.now()}-${randomUUID()}.zip`;
    const uploadUrl = await getPresignedPutUrl(objectKey, {
      expiresSeconds: 30 * 60,
      contentType: "application/zip",
      maxSize: body.size,
    });
    return c.json({ objectKey, uploadUrl });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Start import — /api/import/drive and /api/import/notion
// ─────────────────────────────────────────────────────────────────────────────

// Per-user concurrency ceiling. Two simultaneous one-shot imports is enough
// for normal usage (one big Notion export + one folder batch) and caps the
// blast radius of a runaway retry storm. The check is a racy pre-check — two
// requests landing inside the same event loop tick can both pass — but since
// over-commit is bounded and self-correcting we prefer this to a full row lock.
const MAX_CONCURRENT_IMPORTS = 2;

async function runningImportCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(
      and(
        eq(importJobs.userId, userId),
        inArray(importJobs.status, ["queued", "running"]),
      ),
    );
  return rows.length;
}

function taskQueue(): string {
  return process.env.TEMPORAL_TASK_QUEUE ?? "ingest";
}

importRouter.post(
  "/drive",
  requireAuth,
  zValidator("json", startDriveImportSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const allowed = await canWrite(userId, {
      type: "workspace",
      id: body.workspaceId,
    });
    if (!allowed) return c.json({ error: "Forbidden" }, 403);

    // Drive integration must exist before we queue a discovery activity
    // that will just 401 against Google anyway.
    const [integ] = await db
      .select({ id: userIntegrations.id })
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.provider, "google_drive"),
        ),
      )
      .limit(1);
    if (!integ) return c.json({ error: "drive_not_connected" }, 400);

    if ((await runningImportCount(userId)) >= MAX_CONCURRENT_IMPORTS) {
      return c.json(
        { error: "import_limit_exceeded", limit: MAX_CONCURRENT_IMPORTS },
        429,
      );
    }

    const workflowId = `import-${randomUUID()}`;
    const sourceMetadata = {
      file_ids: body.fileIds,
      folder_ids: [] as string[],
    };
    const [job] = await db
      .insert(importJobs)
      .values({
        workspaceId: body.workspaceId,
        userId,
        source: "google_drive",
        targetProjectId:
          body.target.kind === "existing" ? body.target.projectId : null,
        targetParentNoteId:
          body.target.kind === "existing" ? body.target.parentNoteId : null,
        workflowId,
        status: "queued",
        sourceMetadata,
      })
      .returning({ id: importJobs.id });

    const client = await getTemporalClient();
    await client.workflow.start("ImportWorkflow", {
      workflowId,
      taskQueue: taskQueue(),
      args: [
        {
          job_id: job.id,
          user_id: userId,
          workspace_id: body.workspaceId,
          source: "google_drive",
          source_metadata: sourceMetadata,
        },
      ],
    });
    return c.json({ jobId: job.id }, 201);
  },
);

importRouter.post(
  "/notion",
  requireAuth,
  zValidator("json", startNotionImportSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const allowed = await canWrite(userId, {
      type: "workspace",
      id: body.workspaceId,
    });
    if (!allowed) return c.json({ error: "Forbidden" }, 403);

    if ((await runningImportCount(userId)) >= MAX_CONCURRENT_IMPORTS) {
      return c.json(
        { error: "import_limit_exceeded", limit: MAX_CONCURRENT_IMPORTS },
        429,
      );
    }

    const workflowId = `import-${randomUUID()}`;
    const sourceMetadata = {
      zip_object_key: body.zipObjectKey,
      original_name: body.originalName,
    };
    const [job] = await db
      .insert(importJobs)
      .values({
        workspaceId: body.workspaceId,
        userId,
        source: "notion_zip",
        targetProjectId:
          body.target.kind === "existing" ? body.target.projectId : null,
        targetParentNoteId:
          body.target.kind === "existing" ? body.target.parentNoteId : null,
        workflowId,
        status: "queued",
        sourceMetadata,
      })
      .returning({ id: importJobs.id });

    const client = await getTemporalClient();
    await client.workflow.start("ImportWorkflow", {
      workflowId,
      taskQueue: taskQueue(),
      args: [
        {
          job_id: job.id,
          user_id: userId,
          workspace_id: body.workspaceId,
          source: "notion_zip",
          source_metadata: sourceMetadata,
        },
      ],
    });
    return c.json({ jobId: job.id }, 201);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// List / detail / SSE / cancel — consumed by the /import page (Task 14+)
// ─────────────────────────────────────────────────────────────────────────────

type RawSourceMeta = Record<string, unknown>;

// Strip the raw ingest metadata down to UI-safe fields. Raw shape is
// source-specific and contains object keys + file ids we don't want to leak
// across workspaces — the list/detail endpoints both go through this.
function safeSourceMetadata(source: string, meta: unknown): RawSourceMeta {
  const m = (meta ?? {}) as RawSourceMeta;
  if (source === "notion_zip") {
    return {
      originalName: typeof m.original_name === "string" ? m.original_name : null,
    };
  }
  if (source === "google_drive") {
    const fileIds = Array.isArray(m.file_ids) ? m.file_ids : [];
    return { fileCount: fileIds.length };
  }
  return {};
}

importRouter.get("/jobs", requireAuth, async (c) => {
  const userId = c.get("userId");
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return c.json({ error: "workspaceId required" }, 400);
  const allowed = await canRead(userId, {
    type: "workspace",
    id: workspaceId,
  });
  if (!allowed) return c.json({ error: "Forbidden" }, 403);
  const rows = await db
    .select({
      id: importJobs.id,
      workspaceId: importJobs.workspaceId,
      source: importJobs.source,
      status: importJobs.status,
      totalItems: importJobs.totalItems,
      completedItems: importJobs.completedItems,
      failedItems: importJobs.failedItems,
      sourceMetadata: importJobs.sourceMetadata,
      errorSummary: importJobs.errorSummary,
      createdAt: importJobs.createdAt,
      finishedAt: importJobs.finishedAt,
    })
    .from(importJobs)
    .where(eq(importJobs.workspaceId, workspaceId))
    .orderBy(desc(importJobs.createdAt))
    .limit(50);
  return c.json(
    rows.map((r) => ({
      ...r,
      sourceMetadata: safeSourceMetadata(r.source, r.sourceMetadata),
    })),
  );
});

importRouter.get("/jobs/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
  const [row] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, id))
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  const allowed = await canRead(userId, {
    type: "workspace",
    id: row.workspaceId,
  });
  if (!allowed) return c.json({ error: "Forbidden" }, 403);
  return c.json({
    id: row.id,
    workspaceId: row.workspaceId,
    source: row.source,
    status: row.status,
    totalItems: row.totalItems,
    completedItems: row.completedItems,
    failedItems: row.failedItems,
    errorSummary: row.errorSummary,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    sourceMetadata: safeSourceMetadata(row.source, row.sourceMetadata),
  });
});

// Polling-based SSE. Not as snappy as DB LISTEN/NOTIFY or a Temporal query
// but dead simple and the progress bar updates every 2s which is fine UX.
// Upgrade candidate if we see the /jobs row under heavy concurrent polling.
importRouter.get("/jobs/:id/events", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
  const [job] = await db
    .select({
      id: importJobs.id,
      workspaceId: importJobs.workspaceId,
    })
    .from(importJobs)
    .where(eq(importJobs.id, id))
    .limit(1);
  if (!job) return c.json({ error: "not_found" }, 404);
  const allowed = await canRead(userId, {
    type: "workspace",
    id: job.workspaceId,
  });
  if (!allowed) return c.json({ error: "Forbidden" }, 403);

  const POLL_MS = 2_000;
  const MAX_TICKS = 15 * 60 / 2; // ~15 minutes cap then client reconnects

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      let tick = 0;
      while (tick < MAX_TICKS) {
        const [row] = await db
          .select({
            status: importJobs.status,
            totalItems: importJobs.totalItems,
            completedItems: importJobs.completedItems,
            failedItems: importJobs.failedItems,
          })
          .from(importJobs)
          .where(eq(importJobs.id, id))
          .limit(1);
        if (!row) break;
        send({
          type: "job.updated",
          status: row.status,
          total: row.totalItems,
          completed: row.completedItems,
          failed: row.failedItems,
        });
        if (row.status === "completed" || row.status === "failed") {
          send({ type: "job.finished", status: row.status });
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        tick += 1;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // nginx would otherwise buffer the whole stream before flushing.
      "X-Accel-Buffering": "no",
    },
  });
});

importRouter.delete("/jobs/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, id))
    .limit(1);
  if (!job) return c.json({ error: "not_found" }, 404);
  const allowed = await canWrite(userId, {
    type: "workspace",
    id: job.workspaceId,
  });
  if (!allowed) return c.json({ error: "Forbidden" }, 403);

  if (job.status === "queued" || job.status === "running") {
    try {
      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(job.workflowId);
      await handle.cancel();
    } catch (err) {
      // Temporal may already have reaped the workflow if it finished between
      // our SELECT and the cancel RPC. Swallow — we still mark the row failed
      // below so the UI reflects the user's intent.
      console.warn(
        `[import] cancel RPC failed for ${job.workflowId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  await db
    .update(importJobs)
    .set({ status: "failed", errorSummary: "Cancelled by user" })
    .where(eq(importJobs.id, id));
  return c.json({ ok: true });
});

// Retry is deferred — the plan marks it as follow-up work and the MVP UX
// asks the user to re-upload the ZIP / re-pick the Drive files instead.
// Keeping a stub route so the UI can surface a clear 501 rather than a 404
// and client code doesn't need to feature-detect.
importRouter.post("/jobs/:id/retry", requireAuth, async (c) => {
  return c.json(
    {
      error: "retry_not_implemented",
      hint: "Re-submit via /api/import/drive or /api/import/notion with the same inputs",
    },
    501,
  );
});
