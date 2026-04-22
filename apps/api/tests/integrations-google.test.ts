import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { db, user, eq } from "@opencairn/db";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64");

describe("GET /api/integrations/google/connect", () => {
  let userId: string;
  let savedEnv: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    encKey: string | undefined;
    apiUrl: string | undefined;
  };

  beforeEach(async () => {
    savedEnv = {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      encKey: process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
      apiUrl: process.env.PUBLIC_API_URL,
    };
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    process.env.PUBLIC_API_URL = "http://api.test";
    const u = await createUser();
    userId = u.id;
  });

  afterEach(async () => {
    await db.delete(user).where(eq(user.id, userId));
    if (savedEnv.clientId !== undefined) {
      process.env.GOOGLE_OAUTH_CLIENT_ID = savedEnv.clientId;
    } else {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    }
    if (savedEnv.clientSecret !== undefined) {
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = savedEnv.clientSecret;
    } else {
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    }
    if (savedEnv.encKey !== undefined) {
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = savedEnv.encKey;
    } else {
      delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    }
    if (savedEnv.apiUrl !== undefined) {
      process.env.PUBLIC_API_URL = savedEnv.apiUrl;
    } else {
      delete process.env.PUBLIC_API_URL;
    }
  });

  it("redirects to Google OAuth when configured", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/integrations/google/connect?workspaceId=550e8400-e29b-41d4-a716-446655440000",
      { headers: { cookie: await signSessionCookie(userId) } },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(location!).toContain("accounts.google.com");
    expect(location!).toContain("scope=");
    expect(location!).toContain(encodeURIComponent("drive.file"));
    expect(location!).toContain("state=");
    expect(location!).toContain(
      encodeURIComponent("http://api.test/api/integrations/google/callback"),
    );
  });

  it("returns 503 when Google OAuth is not configured", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const app = createApp();
    const res = await app.request(
      "/api/integrations/google/connect?workspaceId=550e8400-e29b-41d4-a716-446655440000",
      { headers: { cookie: await signSessionCookie(userId) } },
    );
    expect(res.status).toBe(503);
  });

  it("returns 400 without workspaceId", async () => {
    const app = createApp();
    const res = await app.request("/api/integrations/google/connect", {
      headers: { cookie: await signSessionCookie(userId) } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 without a session", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/integrations/google/connect?workspaceId=550e8400-e29b-41d4-a716-446655440000",
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/integrations/google/callback", () => {
  beforeEach(() => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });

  it("returns 400 when code or state missing", async () => {
    const app = createApp();
    const res = await app.request("/api/integrations/google/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid state", async () => {
    const app = createApp();
    const res = await app.request(
      "/api/integrations/google/callback?code=abc&state=not-signed",
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/integrations/google (status)", () => {
  let userId: string;

  beforeEach(async () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const u = await createUser();
    userId = u.id;
  });

  afterEach(async () => {
    await db.delete(user).where(eq(user.id, userId));
  });

  it("returns disconnected for a user with no integration", async () => {
    const app = createApp();
    const res = await app.request("/api/integrations/google", {
      headers: { cookie: await signSessionCookie(userId) },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      connected: false,
      accountEmail: null,
      scopes: null,
    });
  });

  it("returns 401 without a session", async () => {
    const app = createApp();
    const res = await app.request("/api/integrations/google");
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/integrations/google", () => {
  let userId: string;

  beforeEach(async () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const u = await createUser();
    userId = u.id;
  });

  afterEach(async () => {
    await db.delete(user).where(eq(user.id, userId));
  });

  it("is a no-op and returns ok when no integration exists", async () => {
    const app = createApp();
    const res = await app.request("/api/integrations/google", {
      method: "DELETE",
      headers: { cookie: await signSessionCookie(userId) },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  it("returns 401 without a session", async () => {
    const app = createApp();
    const res = await app.request("/api/integrations/google", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});
