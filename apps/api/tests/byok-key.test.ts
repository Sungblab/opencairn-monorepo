import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, userPreferences, eq } from "@opencairn/db";
import { encryptToken, decryptToken } from "../src/lib/integration-tokens.js";
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

describe("PUT /api/users/me/byok-key", () => {
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

  it("returns 400 with code=too_short when key is too short", async () => {
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({ apiKey: "AIza1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "invalid_input", code: "too_short" });
  });

  it("returns 400 with code=wrong_prefix when prefix is wrong", async () => {
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({
        apiKey: "WRONG_PREFIX_TestKeyForPhaseEUnitTestXYZ",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "invalid_input",
      code: "wrong_prefix",
    });
  });

  it("inserts a new row, returns lastFour", async () => {
    const apiKey = "AIzaSyTestPhaseEUnitInsertCase1234wxyz";
    const res = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({ apiKey }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.lastFour).toBe("wxyz");
    expect(typeof body.updatedAt).toBe("string");

    const [row] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
    expect(row).toBeDefined();
    expect(row!.byokApiKeyEncrypted).toBeInstanceOf(Buffer);
    expect(decryptToken(row!.byokApiKeyEncrypted!)).toBe(apiKey);
  });

  it("upserts when called twice (no second row, updatedAt advances)", async () => {
    const k1 = "AIzaSyTestPhaseEUpsertFirstRoundXYZkey1";
    const k2 = "AIzaSyTestPhaseEUpsertSecondRoundXYZkey2";
    const res1 = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({ apiKey: k1 }),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // ensure clock advances at least 1ms before the second call
    await new Promise((r) => setTimeout(r, 5));

    const res2 = await authedFetch("/api/users/me/byok-key", {
      method: "PUT",
      userId: ctx.userId,
      body: JSON.stringify({ apiKey: k2 }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.lastFour).toBe("key2");
    expect(new Date(body2.updatedAt).getTime()).toBeGreaterThan(
      new Date(body1.updatedAt).getTime(),
    );

    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.userId));
    expect(rows).toHaveLength(1);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/users/me/byok-key", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "AIzaSy_anything" }),
    });
    expect(res.status).toBe(401);
  });
});
