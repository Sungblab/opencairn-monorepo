import { afterEach, describe, expect, it } from "vitest";
import { db, notifications, eq, user } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import {
  persistAndPublish,
  subscribeNotifications,
  _listenerCountForTest,
  type NotificationEvent,
} from "../src/lib/notification-events.js";

// App Shell Phase 5 Task 9 — drawer REST + SSE channel + persistAndPublish
// fan-out semantics. SSE socket lifecycle isn't exercised here (the runtime
// would tie us to a real HTTP server) — we cover the bus directly via
// subscribe/unsubscribe and treat the route handler's plumbing as an
// integration concern for the e2e spec.

const app = createApp();
const createdUserIds = new Set<string>();

afterEach(async () => {
  // notifications cascade on user delete via FK — no explicit cleanup needed
  // beyond removing the seeded users.
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
});

async function authedGet(path: string, userId: string): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { cookie } });
}
async function authedPatch(path: string, userId: string): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { method: "PATCH", headers: { cookie } });
}

describe("notification-events bus", () => {
  it("persists a row and fans out to subscribers", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const received: NotificationEvent[] = [];
    const unsub = subscribeNotifications(u.id, (n) => received.push(n));
    try {
      const event = await persistAndPublish({
        userId: u.id,
        kind: "mention",
        payload: { summary: "@u hi" },
      });
      expect(received).toHaveLength(1);
      expect(received[0].id).toBe(event.id);
      expect(received[0].kind).toBe("mention");
      // DB row exists
      const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, event.id));
      expect(row).toBeDefined();
      expect(row.userId).toBe(u.id);
    } finally {
      unsub();
    }
  });

  it("unsubscribe removes the listener", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const unsub = subscribeNotifications(u.id, () => {});
    expect(_listenerCountForTest(u.id)).toBe(1);
    unsub();
    expect(_listenerCountForTest(u.id)).toBe(0);
  });

  it("does not deliver across users", async () => {
    const a = await createUser();
    const b = await createUser();
    createdUserIds.add(a.id);
    createdUserIds.add(b.id);
    const received: NotificationEvent[] = [];
    const unsub = subscribeNotifications(a.id, (n) => received.push(n));
    try {
      await persistAndPublish({
        userId: b.id,
        kind: "system",
        payload: { summary: "for b" },
      });
      expect(received).toHaveLength(0);
    } finally {
      unsub();
    }
  });
});

describe("GET /api/notifications", () => {
  it("returns the caller's rows desc + snake_case timestamps", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    await persistAndPublish({
      userId: u.id,
      kind: "mention",
      payload: { summary: "first" },
    });
    await new Promise((r) => setTimeout(r, 5));
    await persistAndPublish({
      userId: u.id,
      kind: "system",
      payload: { summary: "second" },
    });

    const res = await authedGet("/api/notifications", u.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notifications: Array<{
        kind: string;
        payload: { summary: string };
        created_at: string;
        read_at: string | null;
      }>;
      nextCursor: string | null;
    };
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0].payload.summary).toBe("second");
    expect(body.notifications[0].created_at).toMatch(/Z$/);
    expect(body.nextCursor).toBeNull();
  });

  it("excludes other users' notifications", async () => {
    const me = await createUser();
    const other = await createUser();
    createdUserIds.add(me.id);
    createdUserIds.add(other.id);
    await persistAndPublish({
      userId: other.id,
      kind: "mention",
      payload: { summary: "not mine" },
    });
    const res = await authedGet("/api/notifications", me.id);
    const body = (await res.json()) as { notifications: unknown[] };
    expect(body.notifications).toEqual([]);
  });

  it("401 without a session", async () => {
    const res = await app.request("/api/notifications");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/notifications pagination", () => {
  it("returns nextCursor when more rows exist and continues from it", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    // Seed 5 rows; spaced so createdAt strictly increases.
    for (let i = 0; i < 5; i++) {
      await persistAndPublish({
        userId: u.id,
        kind: "mention",
        payload: { summary: `n${i}` },
      });
      await new Promise((r) => setTimeout(r, 5));
    }

    type Body = {
      notifications: Array<{ payload: { summary: string } }>;
      nextCursor: string | null;
    };

    // limit=2 → page 1 should hold the 2 newest (n4, n3) and a cursor.
    const r1 = await authedGet("/api/notifications?limit=2", u.id);
    const b1 = (await r1.json()) as Body;
    expect(r1.status).toBe(200);
    expect(b1.notifications.map((n) => n.payload.summary)).toEqual([
      "n4",
      "n3",
    ]);
    expect(b1.nextCursor).toBeTruthy();

    // Page 2 with cursor — next 2 rows.
    const r2 = await authedGet(
      `/api/notifications?limit=2&cursor=${encodeURIComponent(b1.nextCursor!)}`,
      u.id,
    );
    const b2 = (await r2.json()) as Body;
    expect(b2.notifications.map((n) => n.payload.summary)).toEqual([
      "n2",
      "n1",
    ]);
    expect(b2.nextCursor).toBeTruthy();

    // Page 3 — last row, exhausted.
    const r3 = await authedGet(
      `/api/notifications?limit=2&cursor=${encodeURIComponent(b2.nextCursor!)}`,
      u.id,
    );
    const b3 = (await r3.json()) as Body;
    expect(b3.notifications.map((n) => n.payload.summary)).toEqual(["n0"]);
    expect(b3.nextCursor).toBeNull();
  });

  it("rejects out-of-range limit with 400", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const tooSmall = await authedGet("/api/notifications?limit=0", u.id);
    expect(tooSmall.status).toBe(400);
    const tooBig = await authedGet("/api/notifications?limit=101", u.id);
    expect(tooBig.status).toBe(400);
    const nonNumeric = await authedGet(
      "/api/notifications?limit=abc",
      u.id,
    );
    expect(nonNumeric.status).toBe(400);
  });

  it("rejects malformed cursor with 400", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedGet("/api/notifications?cursor=not-base64", u.id);
    expect(res.status).toBe(400);
  });

  it("breaks createdAt ties using id desc to avoid skip/duplicate rows", async () => {
    // If two rows share createdAt to the millisecond and the cursor only
    // discriminates by createdAt, the second page can either skip a row or
    // double-emit one. The composite (createdAt, id) cursor protects against
    // both.
    const u = await createUser();
    createdUserIds.add(u.id);
    const sameTs = new Date();
    // Insert 3 rows with literally identical createdAt by writing the column
    // explicitly. Drizzle's `.values` accepts createdAt overrides.
    const rows = await db
      .insert(notifications)
      .values([
        { userId: u.id, kind: "mention", payload: { summary: "a" }, createdAt: sameTs },
        { userId: u.id, kind: "mention", payload: { summary: "b" }, createdAt: sameTs },
        { userId: u.id, kind: "mention", payload: { summary: "c" }, createdAt: sameTs },
      ])
      .returning();
    expect(rows).toHaveLength(3);

    type Body = {
      notifications: Array<{ id: string; payload: { summary: string } }>;
      nextCursor: string | null;
    };
    const r1 = await authedGet("/api/notifications?limit=2", u.id);
    const b1 = (await r1.json()) as Body;
    expect(b1.notifications).toHaveLength(2);
    expect(b1.nextCursor).toBeTruthy();
    const r2 = await authedGet(
      `/api/notifications?limit=2&cursor=${encodeURIComponent(b1.nextCursor!)}`,
      u.id,
    );
    const b2 = (await r2.json()) as Body;
    expect(b2.notifications).toHaveLength(1);
    // No row appears in both pages (no duplication) and all 3 rows are seen.
    const seenIds = new Set([
      ...b1.notifications.map((n) => n.id),
      ...b2.notifications.map((n) => n.id),
    ]);
    expect(seenIds.size).toBe(3);
    expect(b2.nextCursor).toBeNull();
  });
});

describe("PATCH /api/notifications/:id/read", () => {
  it("marks the row read_at and is idempotent", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const event = await persistAndPublish({
      userId: u.id,
      kind: "mention",
      payload: { summary: "x" },
    });
    const res = await authedPatch(
      `/api/notifications/${event.id}/read`,
      u.id,
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, event.id));
    expect(row.readAt).not.toBeNull();
    // Second call still 200
    const again = await authedPatch(
      `/api/notifications/${event.id}/read`,
      u.id,
    );
    expect(again.status).toBe(200);
  });

  it("preserves the original read_at across repeated calls", async () => {
    // Regression: the prior implementation set readAt = NOW() unconditionally,
    // overwriting the first-read timestamp on every retry. COALESCE in the
    // UPDATE should keep the analytics-truthy "first time the user opened the
    // notification" value stable.
    const u = await createUser();
    createdUserIds.add(u.id);
    const event = await persistAndPublish({
      userId: u.id,
      kind: "mention",
      payload: { summary: "x" },
    });
    await authedPatch(`/api/notifications/${event.id}/read`, u.id);
    const [first] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, event.id));
    expect(first.readAt).not.toBeNull();
    const firstStamp = first.readAt!.getTime();

    // NOW() resolution in Postgres is microseconds — wait long enough that a
    // second UPDATE without COALESCE would produce a strictly greater value.
    await new Promise((r) => setTimeout(r, 25));
    await authedPatch(`/api/notifications/${event.id}/read`, u.id);
    const [second] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, event.id));
    expect(second.readAt!.getTime()).toBe(firstStamp);
  });

  it("404 when caller does not own the notification", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    createdUserIds.add(owner.id);
    createdUserIds.add(intruder.id);
    const event = await persistAndPublish({
      userId: owner.id,
      kind: "mention",
      payload: { summary: "x" },
    });
    const res = await authedPatch(
      `/api/notifications/${event.id}/read`,
      intruder.id,
    );
    expect(res.status).toBe(404);
  });

  it("400 on non-uuid id", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedPatch(
      "/api/notifications/not-a-uuid/read",
      u.id,
    );
    expect(res.status).toBe(400);
  });
});
