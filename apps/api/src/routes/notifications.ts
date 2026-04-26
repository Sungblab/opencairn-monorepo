import { Hono } from "hono";
import {
  and,
  db,
  eq,
  desc,
  notifications,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// App Shell Phase 5 Task 9 — notifications drawer REST surface.
// SSE channel lives in stream-notifications.ts (mounted under /api/stream).

export const notificationRoutes = new Hono<AppEnv>().use("*", requireAuth);

// Drawer pulls last 50 by default; client filters / groups locally.
notificationRoutes.get("/", async (c) => {
  const me = c.get("user");
  const rows = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      kind: notifications.kind,
      payload: notifications.payload,
      createdAt: notifications.createdAt,
      seenAt: notifications.seenAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, me.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  return c.json({
    notifications: rows.map((r) => ({
      ...r,
      created_at: r.createdAt.toISOString(),
      seen_at: r.seenAt?.toISOString() ?? null,
      read_at: r.readAt?.toISOString() ?? null,
    })),
  });
});

// Idempotent — re-marking an already-read notification is a no-op.
notificationRoutes.patch("/:id/read", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.id, id), eq(notifications.userId, me.id)),
    )
    .returning({ id: notifications.id });
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
