import { describe, expect, it } from "vitest";

import {
  ConnectorAccountCreateSchema,
  ConnectorAuditEventSchema,
  ConnectorMcpToolSchema,
  ConnectorProviderSchema,
  ConnectorRiskLevelSchema,
  ConnectorSourceCreateSchema,
  ExternalObjectRefSchema,
} from "../src/connectors";

describe("connector shared schemas", () => {
  it("defines the hosted connector provider set", () => {
    expect(ConnectorProviderSchema.options).toEqual([
      "google_drive",
      "github",
      "notion",
      "mcp_custom",
    ]);
  });

  it("parses a redacted connector account create payload", () => {
    const parsed = ConnectorAccountCreateSchema.parse({
      provider: "github",
      authType: "oauth",
      accountLabel: "Sungblab",
      accountEmail: "sungbin@example.com",
      externalAccountId: "github-user-1",
      scopes: ["repo:read"],
    });
    expect(parsed.status).toBe("active");
  });

  it("requires a workspace-scoped connector source", () => {
    const parsed = ConnectorSourceCreateSchema.parse({
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      accountId: "550e8400-e29b-41d4-a716-446655440001",
      provider: "github",
      sourceKind: "github_repo",
      externalId: "Sungblab/opencairn-monorepo",
      displayName: "Sungblab/opencairn-monorepo",
      permissions: { read: true, import: true, write: false },
    });
    expect(parsed.syncMode).toBe("one_shot");
  });

  it("classifies write-capable MCP tools separately from safe reads", () => {
    expect(ConnectorRiskLevelSchema.options).toContain("safe_read");
    expect(ConnectorRiskLevelSchema.options).toContain("write");
    expect(ConnectorRiskLevelSchema.options).toContain("destructive");
    expect(
      ConnectorMcpToolSchema.parse({
        sourceId: "550e8400-e29b-41d4-a716-446655440000",
        toolName: "search",
        riskLevel: "safe_read",
        inputSchema: { type: "object" },
      }).riskLevel,
    ).toBe("safe_read");
  });

  it("accepts provenance refs for notes and concepts", () => {
    const parsed = ExternalObjectRefSchema.parse({
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      provider: "notion",
      sourceId: "550e8400-e29b-41d4-a716-446655440001",
      externalId: "notion-page-1",
      objectType: "page",
      noteId: "550e8400-e29b-41d4-a716-446655440002",
      externalVersion: "2026-04-29T00:00:00Z",
    });
    expect(parsed.objectType).toBe("page");
  });

  it("redacts audit metadata through schema shape", () => {
    const parsed = ConnectorAuditEventSchema.parse({
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      userId: "user_123",
      action: "source.granted",
      riskLevel: "import",
      provider: "google_drive",
      metadata: { externalId: "drive-folder-1" },
    });
    expect(parsed.metadata).toEqual({ externalId: "drive-folder-1" });
  });
});
