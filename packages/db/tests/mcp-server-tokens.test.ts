import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { mcpServerTokens } from "../src/index";

describe("mcp_server_tokens schema", () => {
  it("stores only token hash and redacted prefix", () => {
    const columns = Object.keys(getTableColumns(mcpServerTokens));
    expect(columns).toEqual(
      expect.arrayContaining([
        "workspaceId",
        "createdByUserId",
        "label",
        "tokenHash",
        "tokenPrefix",
        "scopes",
        "expiresAt",
        "lastUsedAt",
        "revokedAt",
      ]),
    );
    expect(columns).not.toContain("token");
    expect(columns).not.toContain("plaintext");
  });
});
