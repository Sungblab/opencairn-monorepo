import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, eq, user, userMcpServers } from "@opencairn/db";
import { createApp } from "../../src/app";
import { decryptToken } from "../../src/lib/integration-tokens";
import { __setRunListToolsForTest } from "../../src/lib/mcp-runner";
import { createUser } from "../helpers/seed";
import { signSessionCookie } from "../helpers/session";

const app = createApp();
const TEST_KEY = Buffer.alloc(32, 0x35).toString("base64");
const createdUserIds = new Set<string>();

async function authedFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

beforeEach(() => {
  process.env.FEATURE_MCP_CLIENT = "true";
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  __setRunListToolsForTest(async () => ({
    status: "ok",
    toolCount: 2,
    sampleNames: ["add", "delete_thing"],
    durationMs: 7,
  }));
});

afterEach(async () => {
  __setRunListToolsForTest(null);
  delete process.env.FEATURE_MCP_CLIENT;
  delete process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
  await db.delete(userMcpServers);
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
});

async function testUser(): Promise<string> {
  const u = await createUser();
  createdUserIds.add(u.id);
  return u.id;
}

describe("MCP feature flag", () => {
  it("returns 404 when FEATURE_MCP_CLIENT is off", async () => {
    const userId = await testUser();
    process.env.FEATURE_MCP_CLIENT = "false";
    const res = await authedFetch(userId, "/api/mcp/servers");
    expect(res.status).toBe(404);
  });
});

describe("MCP servers API", () => {
  it("registers a server after auto-test and never returns plaintext auth", async () => {
    const userId = await testUser();
    const res = await authedFetch(userId, "/api/mcp/servers", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Smoke Echo",
        serverUrl: "https://echo.example/mcp",
        authHeaderValue: "Bearer secret-token",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      displayName: "Smoke Echo",
      serverSlug: "smoke_echo",
      hasAuth: true,
      lastSeenToolCount: 2,
      status: "active",
    });
    expect(body.authHeaderValue).toBeUndefined();

    const [row] = await db
      .select()
      .from(userMcpServers)
      .where(eq(userMcpServers.userId, userId));
    expect(decryptToken(row.authHeaderValueEncrypted!)).toBe(
      "Bearer secret-token",
    );
  });

  it("rejects servers with more than 50 tools", async () => {
    __setRunListToolsForTest(async () => ({
      status: "ok",
      toolCount: 51,
      sampleNames: [],
      durationMs: 3,
    }));
    const userId = await testUser();
    const res = await authedFetch(userId, "/api/mcp/servers", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Huge",
        serverUrl: "https://huge.example/mcp",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "mcp_too_many_tools" });
  });

  it("hides another user's server id behind 404", async () => {
    const ownerId = await testUser();
    const otherId = await testUser();
    const create = await authedFetch(ownerId, "/api/mcp/servers", {
      method: "POST",
      body: JSON.stringify({
        displayName: "Owner",
        serverUrl: "https://owner.example/mcp",
      }),
    });
    const server = (await create.json()) as { id: string };

    const test = await authedFetch(
      otherId,
      `/api/mcp/servers/${server.id}/test`,
      { method: "POST" },
    );
    expect(test.status).toBe(404);
  });
});
