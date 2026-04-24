import { Hono } from "hono";
import { db, notes, and, eq, isNull } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { streamObject } from "../lib/s3-get";
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

  // Streams the MinIO object bound to notes.source_file_key. Used by the
  // source-mode viewer (PDF). Content-Type / Length come from statObject so
  // we don't have to duplicate them in Postgres. Content-Disposition uses
  // the note title with a minimal sanitizer (strips \r\n" only) — enough to
  // prevent header injection without the RFC 5987 ceremony a UI string
  // rarely needs.
  .get("/:id/file", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Not Found" }, 404);
    if (!note.sourceFileKey) return c.json({ error: "Not Found" }, 404);

    const obj = await streamObject(note.sourceFileKey);
    const safeName = note.title.replace(/[\r\n"]/g, "_");
    c.header("Content-Type", obj.contentType);
    c.header("Content-Length", String(obj.contentLength));
    c.header("Content-Disposition", `inline; filename="${safeName}"`);
    return c.body(obj.stream);
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
