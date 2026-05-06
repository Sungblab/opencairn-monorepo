import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "node:crypto";
import {
  and,
  db,
  desc,
  eq,
  importJobs,
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
import { getTemporalClient } from "../lib/temporal-client";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";
import {
  cancelWorkflowAgentActionsBySourceRunId,
} from "../lib/agent-actions";
import {
  ImportRetryError,
  MAX_CONCURRENT_IMPORTS,
  retryImportJob,
  runningImportCount,
  safeSourceMetadata,
  startImportJobWithAction,
} from "../lib/import-retry";

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

async function ensureImportTargetProjectWrite(args: {
  userId: string;
  targetProjectId: string | null;
}): Promise<boolean> {
  if (!args.targetProjectId) return true;
  return canWrite(args.userId, { type: "project", id: args.targetProjectId });
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
    const targetProjectId =
      body.target.kind === "existing" ? body.target.projectId : null;
    if (!(await ensureImportTargetProjectWrite({ userId, targetProjectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [job] = await db
      .insert(importJobs)
      .values({
        workspaceId: body.workspaceId,
        userId,
        source: "google_drive",
        targetProjectId,
        targetParentNoteId:
          body.target.kind === "existing" ? body.target.parentNoteId : null,
        workflowId,
        status: "queued",
        sourceMetadata,
      })
      .returning({ id: importJobs.id });

    const action = await startImportJobWithAction({
      workspaceId: body.workspaceId,
      userId,
      source: "google_drive",
      targetProjectId,
      jobId: job.id,
      workflowId,
      sourceMetadata,
    });
    return c.json({ jobId: job.id, action: action?.action ?? null }, 201);
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
    const targetProjectId =
      body.target.kind === "existing" ? body.target.projectId : null;
    if (!(await ensureImportTargetProjectWrite({ userId, targetProjectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [job] = await db
      .insert(importJobs)
      .values({
        workspaceId: body.workspaceId,
        userId,
        source: "notion_zip",
        targetProjectId,
        targetParentNoteId:
          body.target.kind === "existing" ? body.target.parentNoteId : null,
        workflowId,
        status: "queued",
        sourceMetadata,
      })
      .returning({ id: importJobs.id });

    const action = await startImportJobWithAction({
      workspaceId: body.workspaceId,
      userId,
      source: "notion_zip",
      targetProjectId,
      jobId: job.id,
      workflowId,
      sourceMetadata,
    });
    return c.json({ jobId: job.id, action: action?.action ?? null }, 201);
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
    const targetProjectId =
      body.target.kind === "existing" ? body.target.projectId : null;
    if (!(await ensureImportTargetProjectWrite({ userId, targetProjectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [job] = await db
      .insert(importJobs)
      .values({
        workspaceId: body.workspaceId,
        userId,
        source: "markdown_zip",
        targetProjectId,
        targetParentNoteId:
          body.target.kind === "existing" ? body.target.parentNoteId : null,
        workflowId,
        status: "queued",
        sourceMetadata,
      })
      .returning({ id: importJobs.id });

    const action = await startImportJobWithAction({
      workspaceId: body.workspaceId,
      userId,
      source: "markdown_zip",
      targetProjectId,
      jobId: job.id,
      workflowId,
      sourceMetadata,
    });
    return c.json({ jobId: job.id, action: action?.action ?? null }, 201);
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// List / detail / SSE / cancel — consumed by the /import page (Task 14+)
// ─────────────────────────────────────────────────────────────────────────────

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
  await cancelWorkflowAgentActionsBySourceRunId({
    projectId: job.targetProjectId,
    sourceRunId: job.id,
    result: {
      ok: false,
      jobId: job.id,
      errorCode: "cancelled",
      retryable: false,
    },
  });
  return c.json({ ok: true });
});

importRouter.post("/jobs/:id/retry", requireAuth, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "bad_request" }, 400);
  try {
    const result = await retryImportJob(id, userId);
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof ImportRetryError) {
      return c.json(
        { error: err.code, ...(err.details ?? {}) },
        err.status,
      );
    }
    throw err;
  }
});
