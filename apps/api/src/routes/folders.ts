import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, folders, eq, asc } from "@opencairn/db";
import { createFolderSchema, updateFolderSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// ltree labels only accept [A-Za-z0-9_]. Encode UUIDs by replacing dashes.
// Kept inline here because Task 3 has not yet introduced tree-queries.ts;
// when it does, this helper moves there and folders.ts imports it.
const labelFromId = (id: string): string => id.replace(/-/g, "_");

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
    return c.json(folder, 201);
  })

  .patch("/:id", zValidator("json", updateFolderSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const [existing] = await db.select({ projectId: folders.projectId }).from(folders).where(eq(folders.id, id));
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (!(await canWrite(user.id, { type: "project", id: existing.projectId }))) return c.json({ error: "Forbidden" }, 403);
    const body = c.req.valid("json");
    const [folder] = await db
      .update(folders)
      .set(body)
      .where(eq(folders.id, id))
      .returning();
    return c.json(folder);
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const [existing] = await db.select({ projectId: folders.projectId }).from(folders).where(eq(folders.id, id));
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (!(await canWrite(user.id, { type: "project", id: existing.projectId }))) return c.json({ error: "Forbidden" }, 403);
    await db.delete(folders).where(eq(folders.id, id));
    return c.json({ success: true });
  });
