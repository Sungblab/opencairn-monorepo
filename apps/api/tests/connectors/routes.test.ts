import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  connectorAccounts,
  connectorAuditEvents,
  connectorSources,
  db,
  eq,
} from "@opencairn/db";
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

describe("connector foundation API", () => {
  let seed: SeedResult;
  let accountId: string;

  beforeEach(async () => {
    process.env.FEATURE_CONNECTOR_PLATFORM = "true";
    seed = await seedWorkspace({ role: "editor" });
    const [account] = await db
      .insert(connectorAccounts)
      .values({
        userId: seed.userId,
        provider: "github",
        authType: "oauth",
        accountLabel: "Sungblab",
        accountEmail: "sungbin@example.com",
        externalAccountId: "gh-user-1",
        scopes: ["repo:read"],
      })
      .returning();
    accountId = account.id;
  });

  afterEach(async () => {
    delete process.env.FEATURE_CONNECTOR_PLATFORM;
    await seed.cleanup();
  });

  it("returns 404 when feature flag is off", async () => {
    delete process.env.FEATURE_CONNECTOR_PLATFORM;
    const res = await authed(seed.userId, "/api/connectors/accounts");
    expect(res.status).toBe(404);
  });

  it("lists accounts without token fields", async () => {
    const res = await authed(seed.userId, "/api/connectors/accounts");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.accounts).toHaveLength(1);
    expect(json.accounts[0]).toMatchObject({
      id: accountId,
      provider: "github",
      accountLabel: "Sungblab",
      hasAccessToken: false,
      hasRefreshToken: false,
    });
    expect(json.accounts[0].accessTokenEncrypted).toBeUndefined();
  });

  it("creates a source grant and writes an audit event", async () => {
    const res = await authed(seed.userId, "/api/connectors/sources", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        accountId,
        provider: "github",
        sourceKind: "github_repo",
        externalId: "Sungblab/opencairn-monorepo",
        displayName: "Sungblab/opencairn-monorepo",
        permissions: { read: true, import: true, write: false },
      }),
    });
    expect(res.status).toBe(201);
    const source = await res.json();
    expect(source).toMatchObject({
      workspaceId: seed.workspaceId,
      accountId,
      provider: "github",
      sourceKind: "github_repo",
      status: "active",
    });

    const audit = await db
      .select()
      .from(connectorAuditEvents)
      .where(eq(connectorAuditEvents.sourceId, source.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("source.granted");
  });

  it("lists sources for a workspace", async () => {
    const [source] = await db
      .insert(connectorSources)
      .values({
        workspaceId: seed.workspaceId,
        projectId: seed.projectId,
        accountId,
        provider: "github",
        sourceKind: "github_repo",
        externalId: "Sungblab/opencairn-monorepo",
        displayName: "Sungblab/opencairn-monorepo",
        permissions: { read: true },
        createdByUserId: seed.userId,
      })
      .returning();

    const res = await authed(
      seed.userId,
      `/api/connectors/sources?workspaceId=${seed.workspaceId}`,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sources.map((s: { id: string }) => s.id)).toContain(
      source.id,
    );
  });

  it("returns 403 when granting a source to a workspace the user cannot write", async () => {
    const other = await seedWorkspace({ role: "viewer" });
    try {
      const res = await authed(other.userId, "/api/connectors/sources", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: seed.workspaceId,
          accountId,
          provider: "github",
          sourceKind: "github_repo",
          externalId: "Sungblab/opencairn-monorepo",
          displayName: "Sungblab/opencairn-monorepo",
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  it("rejects source provider mismatch with the owned account", async () => {
    const res = await authed(seed.userId, "/api/connectors/sources", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: seed.workspaceId,
        accountId,
        provider: "notion",
        sourceKind: "notion_workspace",
        externalId: "notion-workspace-1",
        displayName: "Notion Workspace",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "connector_provider_mismatch",
    });
  });
});
