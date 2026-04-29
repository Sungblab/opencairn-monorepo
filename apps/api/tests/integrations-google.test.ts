import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  createUser,
  seedWorkspace,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import {
  db,
  user,
  userIntegrations,
  workspaces,
  workspaceMembers,
  eq,
} from "@opencairn/db";
import { encryptToken } from "../src/lib/integration-tokens.js";

// Lightweight wrapper so the GET/DELETE describe blocks can reuse a member
// of a real workspace (canRead/canWrite need it now after the review fix).
type SeedResultLocal = Pick<SeedResult, "userId" | "workspaceId" | "cleanup">;
async function seedWorkspaceLocal(): Promise<SeedResultLocal> {
  const seed = await seedWorkspace({ role: "owner" });
  return {
    userId: seed.userId,
    workspaceId: seed.workspaceId,
    cleanup: seed.cleanup,
  };
}

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
  let seed: SeedResultLocal;
  const wsId = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(async () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    seed = await seedWorkspaceLocal();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("returns disconnected for a member with no integration in this workspace", async () => {
    const app = createApp();
    const res = await app.request(
      `/api/integrations/google?workspaceId=${seed.workspaceId}`,
      { headers: { cookie: await signSessionCookie(seed.userId) } },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      connected: false,
      accountEmail: null,
      scopes: null,
    });
  });

  it("returns 400 without workspaceId — connections are per-workspace (S3-022)", async () => {
    const app = createApp();
    const res = await app.request("/api/integrations/google", {
      headers: { cookie: await signSessionCookie(seed.userId) },
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-member probing a foreign workspace's integration status", async () => {
    // Audit S3-022 review fix: even though the query is userId-scoped,
    // the route enforces canRead so a former/never-member can't
    // distinguish "workspace doesn't exist" from "you're connected".
    const app = createApp();
    const res = await app.request(
      `/api/integrations/google?workspaceId=${wsId}`,
      { headers: { cookie: await signSessionCookie(seed.userId) } },
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    const app = createApp();
    const res = await app.request(
      `/api/integrations/google?workspaceId=${seed.workspaceId}`,
    );
    expect(res.status).toBe(401);
  });
});

describe("S3-022 cross-workspace isolation", () => {
  // One user that belongs to two separate workspaces — the canonical setup
  // for the audit's "member of A is also member of B" leak path.
  let userId: string;
  let wsA: string;
  let wsB: string;

  beforeEach(async () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    const u = await createUser();
    userId = u.id;
    wsA = randomUUID();
    wsB = randomUUID();
    await db.insert(workspaces).values([
      {
        id: wsA,
        slug: `ws-a-${wsA.slice(0, 8)}`,
        name: "Workspace A",
        ownerId: userId,
        planType: "free",
      },
      {
        id: wsB,
        slug: `ws-b-${wsB.slice(0, 8)}`,
        name: "Workspace B",
        ownerId: userId,
        planType: "free",
      },
    ]);
    await db.insert(workspaceMembers).values([
      { workspaceId: wsA, userId, role: "owner" },
      { workspaceId: wsB, userId, role: "owner" },
    ]);
  });

  afterEach(async () => {
    await db
      .delete(userIntegrations)
      .where(eq(userIntegrations.userId, userId));
    await db.delete(workspaces).where(eq(workspaces.id, wsA));
    await db.delete(workspaces).where(eq(workspaces.id, wsB));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("an integration in workspace A is invisible from workspace B", async () => {
    await db.insert(userIntegrations).values({
      userId,
      workspaceId: wsA,
      provider: "google_drive",
      accessTokenEncrypted: encryptToken("token-a"),
      refreshTokenEncrypted: encryptToken("refresh-a"),
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      accountEmail: "user@example.com",
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    const app = createApp();
    const cookie = await signSessionCookie(userId);

    const aRes = await app.request(
      `/api/integrations/google?workspaceId=${wsA}`,
      { headers: { cookie } },
    );
    expect(aRes.status).toBe(200);
    expect(((await aRes.json()) as { connected: boolean }).connected).toBe(
      true,
    );

    const bRes = await app.request(
      `/api/integrations/google?workspaceId=${wsB}`,
      { headers: { cookie } },
    );
    expect(bRes.status).toBe(200);
    expect(((await bRes.json()) as { connected: boolean }).connected).toBe(
      false,
    );
  });

  it("DELETE in workspace A leaves workspace B's connection intact", async () => {
    await db.insert(userIntegrations).values([
      {
        userId,
        workspaceId: wsA,
        provider: "google_drive",
        accessTokenEncrypted: encryptToken("token-a"),
        refreshTokenEncrypted: null,
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        accountEmail: "a@example.com",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      },
      {
        userId,
        workspaceId: wsB,
        provider: "google_drive",
        accessTokenEncrypted: encryptToken("token-b"),
        refreshTokenEncrypted: null,
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        accountEmail: "b@example.com",
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      },
    ]);

    const app = createApp();
    const cookie = await signSessionCookie(userId);

    const delRes = await app.request(
      `/api/integrations/google?workspaceId=${wsA}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(delRes.status).toBe(200);

    const bRes = await app.request(
      `/api/integrations/google?workspaceId=${wsB}`,
      { headers: { cookie } },
    );
    expect(((await bRes.json()) as { connected: boolean }).connected).toBe(
      true,
    );
  });
});

describe("DELETE /api/integrations/google", () => {
  let seed: SeedResultLocal;
  const wsId = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(async () => {
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
    seed = await seedWorkspaceLocal();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("is a no-op and returns ok when no integration exists in this workspace", async () => {
    const app = createApp();
    const res = await app.request(
      `/api/integrations/google?workspaceId=${seed.workspaceId}`,
      {
        method: "DELETE",
        headers: { cookie: await signSessionCookie(seed.userId) },
      },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  it("returns 400 without workspaceId (S3-022)", async () => {
    const app = createApp();
    const res = await app.request("/api/integrations/google", {
      method: "DELETE",
      headers: { cookie: await signSessionCookie(seed.userId) },
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when the caller is not a member of the workspace", async () => {
    // Review fix: DELETE requires canWrite, not just userId scope.
    const app = createApp();
    const res = await app.request(
      `/api/integrations/google?workspaceId=${wsId}`,
      {
        method: "DELETE",
        headers: { cookie: await signSessionCookie(seed.userId) },
      },
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    const app = createApp();
    const res = await app.request(
      `/api/integrations/google?workspaceId=${seed.workspaceId}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(401);
  });
});
