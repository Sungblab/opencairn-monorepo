import { Hono } from "hono";
import {
  and,
  db,
  eq,
  desc,
  lt,
  notifications,
  or,
  sql,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// App Shell Phase 5 Task 9 — notifications drawer REST surface.
// SSE channel lives in stream-notifications.ts (mounted under /api/stream).

export const notificationRoutes = new Hono<AppEnv>().use("*", requireAuth);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// Cursor encodes the (createdAt, id) of the last row of the previous page so
// the next page can resume after it under a stable composite ordering.
// `__` separator is unused inside ISO timestamps and UUIDs, so split is safe.
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}__${id}`, "utf8").toString(
    "base64url",
  );
}

interface DecodedCursor {
  createdAt: Date;
  id: string;
}

function decodeCursor(raw: string): DecodedCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf("__");
  if (sep === -1) return null;
  const tsPart = decoded.slice(0, sep);
  const idPart = decoded.slice(sep + 2);
  const createdAt = new Date(tsPart);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (!isUuid(idPart)) return null;
  return { createdAt, id: idPart };
}

// Drawer pulls 50 rows per page (default). `?cursor=<opaque>` continues the
// caller's previous page; `?limit=N` (1..100) overrides the page size.
// Composite ordering `(createdAt DESC, id DESC)` keeps pagination stable when
// two rows share `createdAt` (concurrent fan-out from the same actor).
notificationRoutes.get("/", async (c) => {
  const me = c.get("user");

  const limitParam = c.req.query("limit");
  let limit = DEFAULT_PAGE_SIZE;
  if (limitParam !== undefined) {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
      return c.json({ error: "Bad Request" }, 400);
    }
    limit = parsed;
  }

  const cursorParam = c.req.query("cursor");
  let cursor: DecodedCursor | null = null;
  if (cursorParam !== undefined && cursorParam !== "") {
    cursor = decodeCursor(cursorParam);
    if (!cursor) return c.json({ error: "Bad Request" }, 400);
  }

  // Fetch limit + 1 to detect whether another page exists without a separate
  // count query.
  const where = cursor
    ? and(
        eq(notifications.userId, me.id),
        or(
          lt(notifications.createdAt, cursor.createdAt),
          and(
            eq(notifications.createdAt, cursor.createdAt),
            lt(notifications.id, cursor.id),
          ),
        ),
      )
    : eq(notifications.userId, me.id);

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
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  return c.json({
    notifications: page.map((r) => ({
      ...r,
      created_at: r.createdAt.toISOString(),
      seen_at: r.seenAt?.toISOString() ?? null,
      read_at: r.readAt?.toISOString() ?? null,
    })),
    nextCursor,
  });
});

// Idempotent — re-marking an already-read notification is a no-op.
// COALESCE preserves the original read_at so analytics keep "first read"
// truth, and the second call still returns 200 (the row exists, ownership
// matches) instead of 404.
notificationRoutes.patch("/:id/read", async (c) => {
  const me = c.get("user");
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
  const result = await db
    .update(notifications)
    .set({ readAt: sql`COALESCE(${notifications.readAt}, NOW())` })
    .where(
      and(eq(notifications.id, id), eq(notifications.userId, me.id)),
    )
    .returning({ id: notifications.id });
  if (result.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
