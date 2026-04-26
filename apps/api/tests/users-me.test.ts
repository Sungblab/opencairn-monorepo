import { afterEach, describe, expect, it } from "vitest";
import { db, eq, user } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

// App Shell Phase 5 Task 7 — account profile view contract.

const app = createApp();
const createdUserIds = new Set<string>();

afterEach(async () => {
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
});

async function authedGet(userId: string): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request("/api/users/me", { headers: { cookie } });
}
async function authedPatch(
  userId: string,
  body: unknown,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request("/api/users/me", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/users/me", () => {
  it("returns profile fields with locale/timezone stubbed null", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedGet(u.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(u.id);
    expect(body.email).toBe(u.email);
    expect(body.name).toBe(u.name);
    expect(body.locale).toBeNull();
    expect(body.timezone).toBeNull();
    expect(body.plan).toBe("free");
  });

  it("returns 401 without a session", async () => {
    const res = await app.request("/api/users/me");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/users/me", () => {
  it("updates the name", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedPatch(u.id, { name: "Renamed" });
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, u.id));
    expect(row.name).toBe("Renamed");
  });

  it("rejects unknown fields (strict schema)", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedPatch(u.id, { name: "ok", role: "admin" });
    expect(res.status).toBe(400);
  });

  it("rejects empty name", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedPatch(u.id, { name: "" });
    expect(res.status).toBe(400);
  });

  it("no-op on empty body returns ok without touching the row", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const before = u.name;
    const res = await authedPatch(u.id, {});
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, u.id));
    expect(row.name).toBe(before);
  });
});
