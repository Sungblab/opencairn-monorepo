import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, notes, projects, eq, and, desc, isNull, sql } from "@opencairn/db";
import { createNoteSchema, updateNoteSchema } from "@opencairn/shared";

// PATCH body ignores `content` — Yjs (via Hocuspocus) is canonical (Plan 2B).
const patchNoteSchema = updateNoteSchema.omit({ content: true });
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { plateValueToText } from "../lib/plate-text";
import type { AppEnv } from "../lib/types";

export const noteRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/by-project/:projectId", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId }))) return c.json({ error: "Forbidden" }, 403);
    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.projectId, projectId), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt));

    // Filter notes with inheritParent=false: per-user pagePermission required
    const maybePrivate = rows.filter(n => n.inheritParent === false);
    if (maybePrivate.length === 0) return c.json(rows);

    const privateChecks = await Promise.all(
      maybePrivate.map(async n => ({ id: n.id, ok: await canRead(user.id, { type: "note", id: n.id }) }))
    );
    const blockedIds = new Set(privateChecks.filter(x => !x.ok).map(x => x.id));
    return c.json(rows.filter(n => !blockedIds.has(n.id)));
  })

  .get("/search", async (c) => {
    const user = c.get("user");
    const q = c.req.query("q")?.trim() ?? "";
    const projectId = c.req.query("projectId") ?? "";
    if (q.length < 1 || !isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId }))) return c.json({ error: "Forbidden" }, 403);
    const rows = await db
      .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
      .from(notes)
      .where(
        and(
          eq(notes.projectId, projectId),
          isNull(notes.deletedAt),
          // ilike for case-insensitive substring
          sql`${notes.title} ILIKE ${"%" + q + "%"}`,
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(10);
    return c.json(rows);
  })

  .get("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Not found" }, 404);
    return c.json(note);
  })

  .post("/", zValidator("json", createNoteSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    // write-access on project required
    if (!(await canWrite(user.id, { type: "project", id: body.projectId }))) return c.json({ error: "Forbidden" }, 403);
    // derive workspaceId from project (notes.workspaceId is NOT NULL, denormalized for query speed)
    const [proj] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, body.projectId));
    if (!proj) return c.json({ error: "Project not found" }, 404);
    // Derive content_text from Plate Value so FTS/embedding stays in sync with content.
    const contentText = body.content ? plateValueToText(body.content) : "";
    const [note] = await db
      .insert(notes)
      .values({ ...body, workspaceId: proj.workspaceId, contentText })
      .returning();
    return c.json(note, 201);
  })

  // Plan 2B: content/content_text are now Yjs-canonical — persisted only by
  // Hocuspocus `onStoreDocument`. PATCH accepts meta fields only; any
  // `content` key in the request body is stripped by the Zod schema (.omit)
  // so stale clients don't silently clobber the collaborative state.
  .patch("/:id", zValidator("json", patchNoteSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const body = c.req.valid("json");
    const [note] = await db
      .update(notes)
      .set(body)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
      .returning();
    if (!note) return c.json({ error: "Not found" }, 404);
    return c.json(note);
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id }))) return c.json({ error: "Forbidden" }, 403);
    const [note] = await db
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
      .returning();
    if (!note) return c.json({ error: "Not found" }, 404);
    return c.json({ success: true });
  });
