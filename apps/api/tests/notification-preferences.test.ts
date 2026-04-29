import { afterEach, describe, expect, it } from "vitest";
import { db, eq, user, userNotificationPreferences } from "@opencairn/db";

import { createApp } from "../src/app";
import { createUser } from "./helpers/seed";
import { signSessionCookie } from "./helpers/session";

const app = createApp();

const createdUserIds = new Set<string>();
afterEach(async () => {
  for (const id of createdUserIds) {
    await db
      .delete(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, id));
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
});

async function authedFetch(
  path: string,
  userId: string,
  init: RequestInit = {},
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  return app.request(path, { ...init, headers });
}

describe("/api/notification-preferences", () => {
  it("GET / returns 5 effective rows for a fresh user", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);

    const res = await authedFetch("/api/notification-preferences", u.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preferences).toHaveLength(5);
    const kinds = body.preferences.map((p: { kind: string }) => p.kind);
    expect(new Set(kinds)).toEqual(
      new Set([
        "mention",
        "comment_reply",
        "research_complete",
        "share_invite",
        "system",
      ]),
    );
  });

  it("PUT /:kind upserts and is reflected by GET /", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);

    const put = await authedFetch(
      "/api/notification-preferences/mention",
      u.id,
      {
        method: "PUT",
        body: JSON.stringify({
          emailEnabled: false,
          frequency: "digest_daily",
        }),
      },
    );
    expect(put.status).toBe(200);
    const written = await put.json();
    expect(written.frequency).toBe("digest_daily");

    const get = await authedFetch("/api/notification-preferences", u.id);
    const body = await get.json();
    const mention = body.preferences.find(
      (p: { kind: string }) => p.kind === "mention",
    );
    expect(mention).toEqual({
      kind: "mention",
      emailEnabled: false,
      frequency: "digest_daily",
    });
  });

  it("PUT /:kind rejects unknown kind with 400", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedFetch(
      "/api/notification-preferences/not_a_kind",
      u.id,
      {
        method: "PUT",
        body: JSON.stringify({ emailEnabled: true, frequency: "instant" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("PUT /:kind rejects invalid frequency with 400", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedFetch(
      "/api/notification-preferences/mention",
      u.id,
      {
        method: "PUT",
        body: JSON.stringify({ emailEnabled: true, frequency: "weekly" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("GET /profile returns column defaults", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedFetch(
      "/api/notification-preferences/profile",
      u.id,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ locale: "ko", timezone: "Asia/Seoul" });
  });

  it("PUT /profile updates timezone partially", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedFetch(
      "/api/notification-preferences/profile",
      u.id,
      {
        method: "PUT",
        body: JSON.stringify({ timezone: "America/Los_Angeles" }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      locale: "ko",
      timezone: "America/Los_Angeles",
    });
  });

  it("PUT /profile rejects invalid locale", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedFetch(
      "/api/notification-preferences/profile",
      u.id,
      {
        method: "PUT",
        body: JSON.stringify({ locale: "fr" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("requires auth (401 without cookie)", async () => {
    const res = await app.request("/api/notification-preferences");
    expect(res.status).toBe(401);
  });
});
