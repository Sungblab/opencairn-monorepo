import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "node:crypto";
import {
  and,
  db,
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
import { canWrite } from "../lib/permissions";
import { getPresignedPutUrl } from "../lib/s3";
import { getTemporalClient } from "../lib/temporal-client";
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
