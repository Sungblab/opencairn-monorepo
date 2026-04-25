import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, notes, projects, eq, and, desc, isNull, sql } from "@opencairn/db";
import { createNoteSchema, updateNoteSchema } from "@opencairn/shared";

// PATCH body ignores `content` — Yjs (via Hocuspocus) is canonical (Plan 2B).
// `folderId` is also stripped here: moves must go through /:id/move, which
// enforces cross-project scope via moveNote(). Allowing folderId on this
// route would let a caller re-parent a note into another project's folder,
// since the DB has no FK guarding `notes.folder_id → folders.project_id =
// notes.project_id`.
const patchNoteSchema = updateNoteSchema.omit({
  content: true,
  folderId: true,
});

// Move-only body. A dedicated endpoint keeps this orthogonal to the
// Yjs-coupled `/:id` PATCH that silently strips `content`.
const moveNoteSchema = z.object({
  folderId: z.string().uuid().nullable(),
});

import { requireAuth } from "../middleware/auth";
import { canRead, canWrite, resolveRole } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { plateValueToText } from "../lib/plate-text";
import { moveNote } from "../lib/tree-queries";
import { emitTreeEvent } from "../lib/tree-events";
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

  // Role lookup — server-rendered note page uses this to compute `readOnly`
  // before handing off to the Yjs-backed editor. Registered BEFORE the generic
  // `/:id` so Hono's router doesn't treat "role" as a UUID (which would 400).
  // Returns 403 for roles=none so UI can show "no access" without leaking
  // existence via the 200/404 split.
  .get("/:id/role", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const role = await resolveRole(user.id, { type: "note", id });
    if (role === "none") return c.json({ error: "Forbidden" }, 403);
    return c.json({ role });
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
    // For canvas notes, contentText holds raw source code (validated to ≤64KB by Zod).
    // For Plate-content notes, derive from the Plate value so FTS/embedding stays in sync.
    const contentText = body.contentText ?? (body.content ? plateValueToText(body.content) : "");
    const [note] = await db
      .insert(notes)
      .values({ ...body, workspaceId: proj.workspaceId, contentText })
      .returning();

    emitTreeEvent({
      kind: "tree.note_created",
      projectId: note.projectId,
      id: note.id,
      parentId: note.folderId,
      label: note.title,
      at: new Date().toISOString(),
    });

    return c.json(note, 201);
  })

  // Move endpoint. Registered BEFORE `/:id` so the literal `move` suffix
  // matches before Hono considers `/:id` a candidate. Uses moveNote which
  // enforces project scope; emits tree.note_moved after the write commits.
  .patch(
    "/:id/move",
    zValidator("json", moveNoteSchema),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
      if (!(await canWrite(user.id, { type: "note", id }))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      const [current] = await db
        .select({ projectId: notes.projectId, folderId: notes.folderId })
        .from(notes)
        .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
      if (!current) return c.json({ error: "Not found" }, 404);

      const { folderId: newFolderId } = c.req.valid("json");
      try {
        await moveNote({
          projectId: current.projectId,
          noteId: id,
          newFolderId,
        });
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }

      emitTreeEvent({
        kind: "tree.note_moved",
        projectId: current.projectId,
        id,
        parentId: newFolderId,
        at: new Date().toISOString(),
      });
      return c.json({ ok: true });
    },
  )

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
    // Capture prev title to detect rename deltas for SSE. folderId is
    // intentionally NOT fetched here — moves route through /:id/move.
    const [prev] = await db
      .select({ title: notes.title })
      .from(notes)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)));
    if (!prev) return c.json({ error: "Not found" }, 404);
    const [note] = await db
      .update(notes)
      .set(body)
      .where(and(eq(notes.id, id), isNull(notes.deletedAt)))
      .returning();
    if (!note) return c.json({ error: "Not found" }, 404);

    const renamed = body.title !== undefined && body.title !== prev.title;
    if (renamed) {
      emitTreeEvent({
        kind: "tree.note_renamed",
        projectId: note.projectId,
        id: note.id,
        parentId: note.folderId,
        label: note.title,
        at: new Date().toISOString(),
      });
    }

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

    emitTreeEvent({
      kind: "tree.note_deleted",
      projectId: note.projectId,
      id: note.id,
      parentId: note.folderId,
      at: new Date().toISOString(),
    });

    return c.json({ success: true });
  });
