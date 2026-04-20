import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, tags, noteTags, notes, eq, and, isNull } from "@opencairn/db";
import { createTagSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

export const tagRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/by-project/:projectId", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId }))) return c.json({ error: "Forbidden" }, 403);
    const result = await db.select().from(tags).where(eq(tags.projectId, projectId));
    return c.json(result);
  })

  .post("/", zValidator("json", createTagSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    if (!(await canWrite(user.id, { type: "project", id: body.projectId }))) return c.json({ error: "Forbidden" }, 403);
    const [tag] = await db.insert(tags).values(body).returning();
    return c.json(tag, 201);
  })

  // Attach tag to note — both must be in same project, user must have write access on the note
  .post("/:tagId/notes/:noteId", async (c) => {
    const user = c.get("user");
    const tagId = c.req.param("tagId");
    const noteId = c.req.param("noteId");
    if (!isUuid(tagId) || !isUuid(noteId)) return c.json({ error: "Bad Request" }, 400);
    const [tag] = await db.select({ projectId: tags.projectId }).from(tags).where(eq(tags.id, tagId));
    if (!tag) return c.json({ error: "Tag not found" }, 404);
    const [note] = await db
      .select({ projectId: notes.projectId })
      .from(notes)
      .where(and(eq(notes.id, noteId), isNull(notes.deletedAt)));
    if (!note) return c.json({ error: "Note not found" }, 404);
    if (tag.projectId !== note.projectId) return c.json({ error: "Tag and note must be in same project" }, 400);
    if (!(await canWrite(user.id, { type: "note", id: noteId }))) return c.json({ error: "Forbidden" }, 403);
    await db.insert(noteTags).values({ tagId, noteId }).onConflictDoNothing();
    return c.json({ success: true }, 201);
  })

  .delete("/:tagId/notes/:noteId", async (c) => {
    const user = c.get("user");
    const tagId = c.req.param("tagId");
    const noteId = c.req.param("noteId");
    if (!isUuid(tagId) || !isUuid(noteId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "note", id: noteId }))) return c.json({ error: "Forbidden" }, 403);
    await db.delete(noteTags).where(and(eq(noteTags.tagId, tagId), eq(noteTags.noteId, noteId)));
    return c.json({ success: true });
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const [existing] = await db.select({ projectId: tags.projectId }).from(tags).where(eq(tags.id, id));
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (!(await canWrite(user.id, { type: "project", id: existing.projectId }))) return c.json({ error: "Forbidden" }, 403);
    await db.delete(tags).where(eq(tags.id, id));
    return c.json({ success: true });
  });
