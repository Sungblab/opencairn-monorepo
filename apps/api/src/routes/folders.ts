import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, folders, eq, asc } from "@opencairn/db";
import { createFolderSchema, updateFolderSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import { labelFromId, moveFolder } from "../lib/tree-queries";
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
    const [existing] = await db
      .select({
        projectId: folders.projectId,
        parentId: folders.parentId,
        name: folders.name,
        position: folders.position,
      })
      .from(folders)
      .where(eq(folders.id, id));
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (!(await canWrite(user.id, { type: "project", id: existing.projectId }))) return c.json({ error: "Forbidden" }, 403);
    const body = c.req.valid("json");

    const moving =
      body.parentId !== undefined && body.parentId !== existing.parentId;
    // Reorder = position changed within the SAME parent. When both parent
    // and position change we only emit `tree.folder_moved` (project-scoped
    // invalidate already covers the reorder); re-emitting would just
    // double-fetch. A PATCH that resends the existing position is a no-op
    // and must NOT broadcast — otherwise every idempotent retry wakes up
    // every connected sidebar.
    const reordering =
      !moving &&
      body.position !== undefined &&
      body.position !== existing.position;

    // Path rewrite goes through moveFolder so the ltree subtree stays
    // consistent. We run it first because a failed move should leave the
    // scalar fields (name/position) untouched — callers then see the error
    // without a half-applied rename.
    if (moving) {
      try {
        await moveFolder({
          projectId: existing.projectId,
          folderId: id,
          newParentId: body.parentId ?? null,
        });
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    }

    const scalarSet: Partial<typeof folders.$inferInsert> = {};
    if (body.name !== undefined) scalarSet.name = body.name;
    if (body.position !== undefined) scalarSet.position = body.position;
    if (Object.keys(scalarSet).length > 0) {
      await db.update(folders).set(scalarSet).where(eq(folders.id, id));
    }

    const [folder] = await db
      .select()
      .from(folders)
      .where(eq(folders.id, id));

    const at = new Date().toISOString();
    const renamed = body.name !== undefined && body.name !== existing.name;
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
    if (moving) {
      emitTreeEvent({
        kind: "tree.folder_moved",
        projectId: folder.projectId,
        id: folder.id,
        parentId: folder.parentId,
        label: folder.name,
        at,
      });
    } else if (reordering) {
      emitTreeEvent({
        kind: "tree.folder_reordered",
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
