import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "node:crypto";
import { notionUploadUrlSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canWrite } from "../lib/permissions";
import { getPresignedPutUrl } from "../lib/s3";
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
