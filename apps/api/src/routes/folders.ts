import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, folders, eq, asc } from "@opencairn/db";
import { createFolderSchema, updateFolderSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { labelFromId } from "../lib/tree-queries";
import { emitTreeEvent } from "../lib/tree-events";
import type { AppEnv } from "../lib/types";

export const folderRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/by-project/:projectId", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId }))) return c.json({ error: "Forbidden" }, 403);
    const result = await db
      .select()
      .from(folders)
      .where(eq(folders.projectId, projectId))
      .orderBy(asc(folders.position));
    return c.json(result);
  })

  .post("/", zValidator("json", createFolderSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    if (!(await canWrite(user.id, { type: "project", id: body.projectId }))) return c.json({ error: "Forbidden" }, 403);

    // Compute the ltree path before insert so the NOT NULL constraint is met.
    // A new folder's path is `parent.path || label(id)`, or just `label(id)`
    // when it's a project-root folder.
    const id = randomUUID();
    const label = labelFromId(id);

    let path: string;
    if (body.parentId) {
      const [parent] = await db
        .select({ path: folders.path, projectId: folders.projectId })
        .from(folders)
        .where(eq(folders.id, body.parentId));
      if (!parent) return c.json({ error: "Parent folder not found" }, 400);
      if (parent.projectId !== body.projectId) {
        return c.json({ error: "Parent folder in different project" }, 400);
      }
      path = `${parent.path}.${label}`;
    } else {
      path = label;
    }

    const [folder] = await db
      .insert(folders)
      .values({ ...body, id, path })
      .returning();

    emitTreeEvent({
      kind: "tree.folder_created",
      projectId: folder.projectId,
      id: folder.id,
      parentId: folder.parentId,
      label: folder.name,
      at: new Date().toISOString(),
    });

    return c.json(folder, 201);
  })

  .patch("/:id", zValidator("json", updateFolderSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    // NOTE: parent_id changes here do NOT yet rewrite the ltree subtree —
    // that path rewrite moves in via `moveFolder` during Task 11 (drag-drop).
    // For now, PATCH only changes the scalar and emits tree.folder_moved;
    // callers who change parent_id via this endpoint without Task 11 in
    // place will leave the ltree path stale and must be aware of that.
    const [existing] = await db
      .select({
        projectId: folders.projectId,
        parentId: folders.parentId,
        name: folders.name,
      })
      .from(folders)
      .where(eq(folders.id, id));
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (!(await canWrite(user.id, { type: "project", id: existing.projectId }))) return c.json({ error: "Forbidden" }, 403);
    const body = c.req.valid("json");
    const [folder] = await db
      .update(folders)
      .set(body)
      .where(eq(folders.id, id))
      .returning();

    const at = new Date().toISOString();
    const renamed = body.name !== undefined && body.name !== existing.name;
    const moved =
      body.parentId !== undefined && body.parentId !== existing.parentId;
    if (renamed) {
      emitTreeEvent({
        kind: "tree.folder_renamed",
        projectId: folder.projectId,
        id: folder.id,
        parentId: folder.parentId,
        label: folder.name,
        at,
      });
    }
    if (moved) {
      emitTreeEvent({
        kind: "tree.folder_moved",
        projectId: folder.projectId,
        id: folder.id,
        parentId: folder.parentId,
        label: folder.name,
        at,
      });
    }

    return c.json(folder);
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const [existing] = await db
      .select({ projectId: folders.projectId, parentId: folders.parentId })
      .from(folders)
      .where(eq(folders.id, id));
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (!(await canWrite(user.id, { type: "project", id: existing.projectId }))) return c.json({ error: "Forbidden" }, 403);
    await db.delete(folders).where(eq(folders.id, id));

    emitTreeEvent({
      kind: "tree.folder_deleted",
      projectId: existing.projectId,
      id,
      parentId: existing.parentId,
      at: new Date().toISOString(),
    });

    return c.json({ success: true });
  });
