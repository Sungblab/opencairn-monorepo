import { Hono } from "hono";
import crypto from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { db, notes, and, eq, isNull } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { uploadObject } from "../lib/s3";
import { statObject, streamObject } from "../lib/s3-get";
import type { AppEnv } from "../lib/types";

// Viewer-mode asset routes for App Shell Phase 3-B. Kept in a separate router
// so they can be mounted BEFORE `noteRoutes` — Hono's matcher walks route
// registrations in order, and `noteRoutes` declares a catch-all `GET /:id`
// that would otherwise swallow `/:id/file` and `/:id/data`.
//
// Order of checks mirrors `GET /api/notes/:id` (notes.ts): 400 uuid → 403
// canRead → 404 note missing → content-specific 404.
export const noteAssetRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .post(
    "/:id/images",
    bodyLimit({
      maxSize: 10 * 1024 * 1024,
      onError: (c) => c.json({ error: "image_too_large" }, 413),
    }),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
      if (!(await canWrite(user.id, { type: "note", id }))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const [note] = await db
        .select({ workspaceId: notes.workspaceId })
        .from(notes)
        .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
      if (!note) return c.json({ error: "Not Found" }, 404);

      const form = await c.req.parseBody();
      const file = form["file"];
      if (!(file instanceof File)) {
        return c.json({ error: "image_required" }, 400);
      }
      if (!file.type.startsWith("image/")) {
        return c.json({ error: "unsupported_image_type" }, 415);
      }
      if (file.size > 10 * 1024 * 1024) {
        return c.json({ error: "image_too_large" }, 413);
      }

      const ext = imageExtension(file.type);
      const assetId = crypto.randomUUID();
      const key = `note-assets/${note.workspaceId}/${id}/${assetId}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadObject(key, buffer, file.type);
      return c.json(
        {
          id: assetId,
          url: `/api/notes/${id}/images/${assetId}.${ext}`,
        },
        201,
      );
    },
  )

  .get("/:id/images/:asset", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const asset = c.req.param("asset");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!/^[0-9a-f-]+\.(png|jpg|jpeg|gif|webp|avif)$/i.test(asset)) {
      return c.json({ error: "Bad Request" }, 400);
    }
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [note] = await db
      .select({ workspaceId: notes.workspaceId })
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Not Found" }, 404);

    const obj = await streamObject(`note-assets/${note.workspaceId}/${id}/${asset}`);
    return c.body(obj.stream, 200, {
      "Content-Type": obj.contentType,
      "Content-Length": String(obj.contentLength),
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  })

  // Streams the MinIO object bound to notes.source_file_key. Used by the
  // source-mode viewer (PDF). Content-Type / Length come from statObject so
  // we don't have to duplicate them in Postgres. Content-Disposition uses
  // RFC 6266 dual form so Korean / non-ASCII titles don't garble in Safari
  // or older Chromium.
  .get("/:id/file", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    // Narrow the SELECT to only what we need. `notes.content` (jsonb),
    // `contentText` (text), `embedding` (vector768), `contentTsv` (tsvector)
    // are potentially large and unused by this handler — fetching them
    // inflates API memory per request for no benefit.
    const [note] = await db
      .select({
        title: notes.title,
        sourceFileKey: notes.sourceFileKey,
      })
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Not Found" }, 404);
    if (!note.sourceFileKey) return c.json({ error: "Not Found" }, 404);

    const stat = await statObject(note.sourceFileKey);
    const range = parseByteRange(c.req.header("range"), stat.contentLength);
    if (range === "unsatisfiable") {
      return c.body(null, 416, {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${stat.contentLength}`,
      });
    }
    const obj = await streamObject(note.sourceFileKey, range ?? undefined);
    // RFC 6266 dual form: `filename=` stays ASCII for legacy clients (Safari,
    // IE), `filename*=UTF-8''` carries the real UTF-8 name for modern browsers.
    // Strip header-breaking chars (\r\n") AND the backslash escape char before
    // building either form.
    const safeName = note.title.replace(/[\r\n"\\]/g, "_");
    const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
    // RFC 5987 attr-char excludes !'()* — `encodeURIComponent` leaves them
    // literal. The single quote especially: `filename*=UTF-8''value` uses
    // `'` as delimiter, so a title like "it's.pdf" would split the header.
    // Percent-encode the RFC 3986 "mark" leftovers so strict parsers don't
    // choke. See tools.ietf.org/html/rfc5987 §3.2.1 (attr-char).
    const starName = encodeURIComponent(safeName).replace(
      /[!'()*]/g,
      (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase(),
    );
    const headers: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Content-Type": obj.contentType,
      "Content-Length": String(obj.contentLength),
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${starName}`,
    };
    if (range) {
      headers["Content-Range"] =
        `bytes ${range.start}-${range.end}/${obj.totalLength}`;
    }
    return c.body(obj.stream, range ? 206 : 200, headers);
  })

  // Returns `{ data: <parsed JSON> | null }` from notes.content_text. Used by
  // the data-mode viewer (JSON tree). Non-JSON content yields `null` rather
  // than a 500 — the viewer renders an "empty" state in that case.
  .get("/:id/data", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [note] = await db
      .select({ id: notes.id, contentText: notes.contentText })
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Not Found" }, 404);

    let data: unknown = null;
    if (note.contentText && note.contentText.trim()) {
      try {
        data = JSON.parse(note.contentText);
      } catch {
        data = null;
      }
    }
    return c.json({ data });
  });

function imageExtension(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "png";
  }
}

function parseByteRange(
  header: string | undefined,
  totalLength: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "unsatisfiable";

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "unsatisfiable";
    }
    start = Math.max(totalLength - suffixLength, 0);
    end = totalLength - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : totalLength - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= totalLength
  ) {
    return "unsatisfiable";
  }

  return { start, end: Math.min(end, totalLength - 1) };
}
