import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  connectorAccounts,
  connectorMcpTools,
  connectorSources,
  db,
  eq,
} from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "../helpers/seed";
import { upsertMcpToolCatalog } from "../../src/lib/mcp-tool-catalog";
import { classifyMcpToolRisk } from "../../src/lib/mcp-tool-risk";

describe("MCP tool risk classifier", () => {
  it.each([
    ["search", "safe_read"],
    ["fetch_document", "safe_read"],
    ["listIssues", "safe_read"],
    ["import_repo_snapshot", "import"],
    ["create_issue", "write"],
    ["update_page", "write"],
    ["delete_file", "destructive"],
    ["archive_project", "destructive"],
    ["send_invite", "external_send"],
    ["publish_page", "external_send"],
    ["run_arbitrary", "unknown"],
  ] as const)("classifies %s as %s", (name, expected) => {
    expect(classifyMcpToolRisk({ name })).toBe(expected);
  });
});

describe("MCP tool catalog cache", () => {
  let seed: SeedResult;
  let sourceId: string;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "editor" });
    const [account] = await db
      .insert(connectorAccounts)
      .values({
        userId: seed.userId,
        provider: "mcp_custom",
        authType: "static_header",
        accountLabel: "Custom MCP",
        scopes: [],
      })
      .returning();
    const [source] = await db
      .insert(connectorSources)
      .values({
        workspaceId: seed.workspaceId,
        accountId: account.id,
        provider: "mcp_custom",
        sourceKind: "mcp_server",
        externalId: "https://mcp.example/mcp",
        displayName: "Custom MCP",
        permissions: { read: true },
        createdByUserId: seed.userId,
      })
      .returning();
    sourceId = source.id;
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("upserts tool rows with risk and safe-read enabled defaults", async () => {
    await upsertMcpToolCatalog(sourceId, [
      {
        name: "search",
        description: "Search docs",
        inputSchema: { type: "object" },
      },
      {
        name: "delete_file",
        description: "Delete",
        inputSchema: { type: "object" },
      },
    ]);

    const rows = await db
      .select()
      .from(connectorMcpTools)
      .where(eq(connectorMcpTools.sourceId, sourceId));

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.toolName === "search")).toMatchObject({
      riskLevel: "safe_read",
      enabled: true,
    });
    expect(rows.find((r) => r.toolName === "delete_file")).toMatchObject({
      riskLevel: "destructive",
      enabled: false,
    });
  });
});
