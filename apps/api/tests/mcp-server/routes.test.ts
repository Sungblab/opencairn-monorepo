import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, eq, mcpServerTokens } from "@opencairn/db";
import { createApp } from "../../src/app";
import { seedWorkspace, type SeedResult } from "../helpers/seed";
import { signSessionCookie } from "../helpers/session";

const app = createApp();

async function authed(userId: string, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
      cookie: await signSessionCookie(userId),
    },
  });
}

describe("MCP server token routes", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    process.env.FEATURE_MCP_SERVER = "true";
    seed = await seedWorkspace({ role: "admin" });
  });

  afterEach(async () => {
    delete process.env.FEATURE_MCP_SERVER;
    await seed.cleanup();
  });

  it("returns 404 when feature flag is off", async () => {
    delete process.env.FEATURE_MCP_SERVER;
    const res = await authed(seed.userId, `/api/mcp/tokens?workspaceId=${seed.workspaceId}`);
    expect(res.status).toBe(404);
  });

  it("creates and lists a workspace read token without storing plaintext", async () => {
    const created = await authed(seed.userId, "/api/mcp/tokens", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        label: "Claude Code",
        expiresAt: null,
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.token).toMatch(/^ocmcp_/);
    expect(body.scopes).toEqual(["workspace:read"]);

    const [row] = await db
      .select()
      .from(mcpServerTokens)
      .where(eq(mcpServerTokens.id, body.id));
    expect(row.tokenHash).not.toContain(body.token);

    const listed = await authed(seed.userId, `/api/mcp/tokens?workspaceId=${seed.workspaceId}`);
    expect(listed.status).toBe(200);
    const json = await listed.json();
    expect(json.tokens[0]).not.toHaveProperty("token");
    expect(json.tokens[0]).toMatchObject({ label: "Claude Code" });
  });

  it("requires admin access", async () => {
    const viewer = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authed(viewer.userId, "/api/mcp/tokens", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: seed.workspaceId,
          label: "bad",
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      await viewer.cleanup();
    }
  });

  it("hides token ids from users without workspace admin access", async () => {
    const created = await authed(seed.userId, "/api/mcp/tokens", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        label: "Claude Code",
      }),
    });
    const body = await created.json();
    const viewer = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authed(viewer.userId, `/api/mcp/tokens/${body.id}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    } finally {
      await viewer.cleanup();
    }
  });

  it("serves OAuth protected resource metadata", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource/api/mcp");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: "http://localhost:4000/api/mcp",
      scopes_supported: ["workspace:read"],
      bearer_methods_supported: ["header"],
    });
  });
});
