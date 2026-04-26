import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, userPreferences, eq } from "@opencairn/db";
import { encryptToken } from "../src/lib/integration-tokens.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64");

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

describe("GET /api/users/me/byok-key", () => {
  let ctx: SeedResult;
  let savedEncKey: string | undefined;

  beforeEach(async () => {
    savedEncKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    ctx = await seedWorkspace({ role: "editor" });
    await db
      .delete(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
  });
  afterEach(async () => {
    await ctx.cleanup();
    if (savedEncKey !== undefined) {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = savedEncKey;
    } else {
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    }
  });

  it("returns registered:false when no row exists", async () => {
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ registered: false });
  });

  it("returns registered:false when row exists with null ciphertext", async () => {
    await db
      .insert(userPreferences)
      .values({ userId: ctx.userId, byokApiKeyEncrypted: null });
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: false });
  });

  it("returns registered:true with lastFour + updatedAt when key exists", async () => {
    const apiKey = "AIzaSyTestFakeKeyForUnitTestXYZ1234abcd";
    await db.insert(userPreferences).values({
      userId: ctx.userId,
      byokApiKeyEncrypted: encryptToken(apiKey),
    });
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.lastFour).toBe("abcd");
    expect(typeof body.updatedAt).toBe("string");
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/users/me/byok-key", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("returns registered:false when ciphertext fails to decrypt (corrupt or key rotated)", async () => {
    // 30 deterministic bytes — guaranteed to fail AES-GCM auth tag verification
    const garbage = Buffer.alloc(30);
    for (let i = 0; i < garbage.length; i++) garbage[i] = i + 1;
    await db.insert(userPreferences).values({
      userId: ctx.userId,
      byokApiKeyEncrypted: garbage,
    });
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: false });
  });
});
