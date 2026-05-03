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
  markdownUploadUrlSchema,
  notionUploadUrlSchema,
  startDriveImportSchema,
  startMarkdownImportSchema,
  startNotionImportSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { getPresignedPutUrl } from "../lib/s3";
import { getTemporalClient, taskQueue } from "../lib/temporal-client";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// Hard ceiling on a single Notion export ZIP. Defaults to 5GB (matches the
// zod schema cap). Deployments can lower it via env — useful for local dev
// or free-tier plans. A separate 413 branch exists so the schema's own 400
// doesn't have to double as a "too big" signal.
function maxZipBytes(envName = "IMPORT_NOTION_ZIP_MAX_BYTES"): number {
  const raw = process.env[envName];
  if (!raw) return 5 * 1024 * 1024 * 1024;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024 * 1024;
}

function ownsIssuedZipObjectKey(args: {
  key: string;
  sourcePrefix: "notion" | "markdown";
  workspaceId: string;
  userId: string;
}): boolean {
  const expectedPrefix = `imports/${args.sourcePrefix}/${args.workspaceId}/${args.userId}/`;
  return (
    args.key.startsWith(expectedPrefix) &&
    !args.key.includes("..") &&
    !args.key.includes("//") &&
    !args.key.includes("\\")
  );
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

importRouter.post(
  "/markdown/upload-url",
  requireAuth,
  zValidator("json", markdownUploadUrlSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const ceiling = maxZipBytes("IMPORT_MARKDOWN_ZIP_MAX_BYTES");
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

    const objectKey = `imports/markdown/${body.workspaceId}/${userId}/${Date.now()}-${randomUUID()}.zip`;
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

async function startImportWorkflow(args: {
  jobId: string;
  workflowId: string;
  userId: string;
  workspaceId: string;
  source: "google_drive" | "notion_zip" | "markdown_zip";
  sourceMetadata: Record<string, unknown>;
}) {
  const client = await getTemporalClient();
  try {
    await client.workflow.start("ImportWorkflow", {
      workflowId: args.workflowId,
      taskQueue: taskQueue(),
      args: [
        {
          job_id: args.jobId,
          user_id: args.userId,
          workspace_id: args.workspaceId,
          source: args.source,
          source_metadata: args.sourceMetadata,
        },
      ],
    });
  } catch (err) {
    await db
      .update(importJobs)
      .set({
        status: "failed",
        errorSummary: "Import could not be started. Please try again.",
        finishedAt: new Date(),
      })
      .where(eq(importJobs.id, args.jobId));
    throw err;
  }
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

    // Drive integration must exist for THIS workspace before we queue a
    // discovery activity that will just 401 against Google anyway. The
    // workspace_id scope is the audit S3-022 isolation gate — connecting
    // Drive in workspace A no longer implicitly authorizes imports from
    // workspace B.
    const [integ] = await db
      .select({ id: userIntegrations.id })
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.workspaceId, body.workspaceId),
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

    await startImportWorkflow({
      jobId: job.id,
      workflowId,
      userId,
      workspaceId: body.workspaceId,
      source: "google_drive",
      sourceMetadata,
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

    // Bind the zip to its issuer. `/notion/upload-url` writes the object as
    // `imports/notion/<workspaceId>/<userId>/<ts>-<uuid>.zip`, so a key under
    // any other workspace OR any other user is necessarily a key the caller
    // didn't issue — accepting it would let a workspace member import another
    // user's uploaded zip into their own workspace (S3-024). Workspace-write
    // permission isn't enough; the user must own the upload too.
    //
    // `startsWith` alone is bypassable with `..` traversal segments: a key
    // like `imports/notion/<myWs>/<me>/../../../<victim>/x.zip` passes the
    // prefix but anchors elsewhere if anything in the chain normalizes the
    // path (a future presigned helper, a worker fs join, etc). MinIO itself
    // doesn't normalize so the bypass is latent today, but we reject it
    // anyway to harden against any layer that does.
    if (
      !ownsIssuedZipObjectKey({
        key: body.zipObjectKey,
        sourcePrefix: "notion",
        workspaceId: body.workspaceId,
        userId,
      })
    ) {
      return c.json({ error: "zip_object_key_not_owned" }, 403);
    }

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

    await startImportWorkflow({
      jobId: job.id,
      workflowId,
      userId,
      workspaceId: body.workspaceId,
      source: "notion_zip",
      sourceMetadata,
    });
    return c.json({ jobId: job.id }, 201);
  },
);

importRouter.post(
  "/markdown",
  requireAuth,
  zValidator("json", startMarkdownImportSchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const allowed = await canWrite(userId, {
      type: "workspace",
      id: body.workspaceId,
    });
    if (!allowed) return c.json({ error: "Forbidden" }, 403);

    if (
      !ownsIssuedZipObjectKey({
        key: body.zipObjectKey,
        sourcePrefix: "markdown",
        workspaceId: body.workspaceId,
        userId,
      })
    ) {
      return c.json({ error: "zip_object_key_not_owned" }, 403);
    }

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
        source: "markdown_zip",
        targetProjectId:
          body.target.kind === "existing" ? body.target.projectId : null,
        targetParentNoteId:
          body.target.kind === "existing" ? body.target.parentNoteId : null,
        workflowId,
        status: "queued",
        sourceMetadata,
      })
      .returning({ id: importJobs.id });

    await startImportWorkflow({
      jobId: job.id,
      workflowId,
      userId,
      workspaceId: body.workspaceId,
      source: "markdown_zip",
      sourceMetadata,
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
  if (source === "markdown_zip") {
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

importRouter.post("/jobs/:id/retry", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, id))
    .limit(1);
  if (!job) return c.json({ error: "not_found" }, 404);
  if (job.status !== "failed") {
    return c.json({ error: "retry_requires_failed_job" }, 409);
  }
  if (!(await canWrite(userId, { type: "workspace", id: job.workspaceId }))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (
    job.source !== "google_drive" &&
    job.source !== "notion_zip" &&
    job.source !== "markdown_zip"
  ) {
    return c.json({ error: "retry_not_supported" }, 409);
  }
  if ((await runningImportCount(userId)) >= MAX_CONCURRENT_IMPORTS) {
    return c.json(
      { error: "import_limit_exceeded", limit: MAX_CONCURRENT_IMPORTS },
      429,
    );
  }

  const workflowId = `import-${randomUUID()}`;
  const sourceMetadata = (job.sourceMetadata ?? {}) as Record<string, unknown>;
  const [retryJob] = await db
    .insert(importJobs)
    .values({
      workspaceId: job.workspaceId,
      userId,
      source: job.source,
      targetProjectId: job.targetProjectId,
      targetParentNoteId: job.targetParentNoteId,
      workflowId,
      status: "queued",
      sourceMetadata,
    })
    .returning({ id: importJobs.id });

  await startImportWorkflow({
    jobId: retryJob.id,
    workflowId,
    userId,
    workspaceId: job.workspaceId,
    source: job.source,
    sourceMetadata,
  });
  return c.json({ jobId: retryJob.id }, 201);
});
