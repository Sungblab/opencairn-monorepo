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
    };
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0].payload.summary).toBe("second");
    expect(body.notifications[0].created_at).toMatch(/Z$/);
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
