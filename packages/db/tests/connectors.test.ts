import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  connectorAccounts,
  connectorAccountStatusEnum,
  connectorAuditEvents,
  connectorAuthTypeEnum,
  connectorJobs,
  connectorJobTypeEnum,
  connectorMcpTools,
  connectorProviderEnum,
  connectorRiskLevelEnum,
  connectorSources,
  externalObjectRefs,
} from "../src/index";

describe("connector foundation schema", () => {
  it("exports provider and risk enums", () => {
    expect(connectorProviderEnum.enumValues).toEqual([
      "google_drive",
      "github",
      "notion",
      "mcp_custom",
    ]);
    expect(connectorAuthTypeEnum.enumValues).toEqual([
      "oauth",
      "pat",
      "static_header",
      "none",
    ]);
    expect(connectorAccountStatusEnum.enumValues).toEqual([
      "active",
      "disabled",
      "auth_expired",
      "revoked",
    ]);
    expect(connectorRiskLevelEnum.enumValues).toEqual([
      "safe_read",
      "import",
      "write",
      "destructive",
      "external_send",
      "unknown",
    ]);
    expect(connectorJobTypeEnum.enumValues).toEqual([
      "import",
      "sync",
      "refresh_tools",
      "preview",
    ]);
  });

  it("declares connector account token columns without plaintext fields", () => {
    const cols = getTableColumns(connectorAccounts);
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "userId",
        "provider",
        "authType",
        "accountLabel",
        "accountEmail",
        "externalAccountId",
        "scopes",
        "accessTokenEncrypted",
        "refreshTokenEncrypted",
        "tokenExpiresAt",
        "status",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(Object.keys(cols)).not.toContain("accessToken");
    expect(Object.keys(cols)).not.toContain("refreshToken");
  });

  it("declares source, job, object ref, MCP catalog, and audit tables", () => {
    expect(Object.keys(getTableColumns(connectorSources))).toEqual(
      expect.arrayContaining([
        "workspaceId",
        "accountId",
        "sourceKind",
        "externalId",
        "permissions",
      ]),
    );
    expect(Object.keys(getTableColumns(connectorJobs))).toEqual(
      expect.arrayContaining([
        "workspaceId",
        "sourceId",
        "jobType",
        "workflowId",
        "status",
      ]),
    );
    expect(Object.keys(getTableColumns(externalObjectRefs))).toEqual(
      expect.arrayContaining([
        "workspaceId",
        "sourceId",
        "externalId",
        "objectType",
        "noteId",
        "conceptId",
      ]),
    );
    expect(Object.keys(getTableColumns(connectorMcpTools))).toEqual(
      expect.arrayContaining([
        "sourceId",
        "toolName",
        "inputSchema",
        "riskLevel",
        "enabled",
      ]),
    );
    expect(Object.keys(getTableColumns(connectorAuditEvents))).toEqual(
      expect.arrayContaining([
        "workspaceId",
        "userId",
        "action",
        "riskLevel",
        "metadata",
      ]),
    );
  });
});
