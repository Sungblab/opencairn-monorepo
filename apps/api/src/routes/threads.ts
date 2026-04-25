import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, chatThreads, eq, and, desc, isNull } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

const listQuery = z.object({ workspace_id: z.string().uuid() });
const createBody = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().max(200).optional(),
});
const patchBody = z.object({
  title: z.string().max(200).optional(),
  archived: z.boolean().optional(),
});

export const threadRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/", zValidator("query", listQuery), async (c) => {
    const userId = c.get("userId");
    const { workspace_id } = c.req.valid("query");
    if (!(await canRead(userId, { type: "workspace", id: workspace_id }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    // Archived rows are excluded by default; an admin restore endpoint is a
    // future API and would scope the unarchive separately.
    const rows = await db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        updatedAt: chatThreads.updatedAt,
        createdAt: chatThreads.createdAt,
      })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.workspaceId, workspace_id),
          eq(chatThreads.userId, userId),
          isNull(chatThreads.archivedAt),
        ),
      )
      .orderBy(desc(chatThreads.updatedAt));
    return c.json({
      threads: rows.map((r) => ({
        id: r.id,
        title: r.title,
        updated_at: r.updatedAt.toISOString(),
        created_at: r.createdAt.toISOString(),
      })),
    });
  })

  .post("/", zValidator("json", createBody), async (c) => {
    const userId = c.get("userId");
    const { workspace_id, title } = c.req.valid("json");
    if (!(await canRead(userId, { type: "workspace", id: workspace_id }))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .insert(chatThreads)
      .values({
        workspaceId: workspace_id,
        userId,
        title: title ?? "",
      })
      .returning({ id: chatThreads.id, title: chatThreads.title });
    return c.json({ id: row.id, title: row.title }, 201);
  })

  .patch("/:id", zValidator("json", patchBody), async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const { title, archived } = c.req.valid("json");
    const [row] = await db
      .select({ userId: chatThreads.userId })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.userId !== userId) return c.json({ error: "forbidden" }, 403);
    await db
      .update(chatThreads)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(archived ? { archivedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chatThreads.id, id));
    return c.json({ ok: true });
  })

  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const [row] = await db
      .select({ userId: chatThreads.userId })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.userId !== userId) return c.json({ error: "forbidden" }, 403);
    await db
      .update(chatThreads)
      .set({ archivedAt: new Date() })
      .where(eq(chatThreads.id, id));
    return c.json({ ok: true });
  });
