import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  connectorAccounts,
  connectorAuditEvents,
  connectorSources,
  db,
  eq,
} from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "../helpers/seed";
import {
  redactConnectorMetadata,
  recordConnectorAuditEvent,
} from "../../src/lib/connector-audit";
import {
  assertConnectorAccountOwner,
  assertConnectorSourceWorkspace,
} from "../../src/lib/connector-permissions";

describe("connector helpers", () => {
  let seed: SeedResult;
  let accountId: string;
  let sourceId: string;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    const [account] = await db
      .insert(connectorAccounts)
      .values({
        userId: seed.userId,
        provider: "github",
        authType: "oauth",
        accountLabel: "Sungblab",
        scopes: ["repo:read"],
      })
      .returning();
    accountId = account.id;
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
        permissions: { read: true, import: true },
        createdByUserId: seed.userId,
      })
      .returning();
    sourceId = source.id;
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("redacts token-like metadata recursively", () => {
    expect(
      redactConnectorMetadata({
        token: "secret",
        nested: { authorization: "Bearer x", externalId: "ok" },
      }),
    ).toEqual({
      token: "[redacted]",
      nested: { authorization: "[redacted]", externalId: "ok" },
    });
  });

  it("records redacted audit events", async () => {
    await recordConnectorAuditEvent({
      workspaceId: seed.workspaceId,
      userId: seed.userId,
      accountId,
      sourceId,
      action: "source.granted",
      riskLevel: "import",
      provider: "github",
      metadata: { externalId: "repo", accessToken: "secret" },
    });
    const rows = await db
      .select()
      .from(connectorAuditEvents)
      .where(eq(connectorAuditEvents.sourceId, sourceId));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({
      externalId: "repo",
      accessToken: "[redacted]",
    });
  });

  it("asserts account ownership and source workspace", async () => {
    await expect(
      assertConnectorAccountOwner(seed.userId, accountId),
    ).resolves.toMatchObject({
      id: accountId,
    });
    await expect(
      assertConnectorSourceWorkspace(sourceId, seed.workspaceId),
    ).resolves.toMatchObject({ id: sourceId });
  });

  it("hides cross-owner and cross-workspace ids behind not_found", async () => {
    await expect(
      assertConnectorAccountOwner("other-user", accountId),
    ).rejects.toThrow("connector_account_not_found");
    await expect(
      assertConnectorSourceWorkspace(
        sourceId,
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).rejects.toThrow("connector_source_not_found");
  });
});
