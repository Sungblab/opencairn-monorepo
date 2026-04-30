import { describe, expect, it } from "vitest";

import {
  McpSearchNotesInputSchema,
  McpTokenCreateSchema,
  McpTokenCreatedSchema,
} from "../src/mcp-server";

describe("MCP server shared schemas", () => {
  it("defaults search_notes limit and validates project scope", () => {
    const parsed = McpSearchNotesInputSchema.parse({
      query: "agent memory",
      projectId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.limit).toBe(10);
    expect(McpSearchNotesInputSchema.safeParse({ query: "", limit: 1 }).success).toBe(false);
    expect(McpSearchNotesInputSchema.safeParse({ query: "x", limit: 26 }).success).toBe(false);
  });

  it("accepts nullable token expiry and rejects non-workspace scopes", () => {
    expect(
      McpTokenCreateSchema.parse({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        label: "Claude Code",
        expiresAt: null,
      }).expiresAt,
    ).toBeNull();
    expect(
      McpTokenCreatedSchema.safeParse({
        id: "22222222-2222-4222-8222-222222222222",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        label: "Claude Code",
        token: "ocmcp_" + "a".repeat(43),
        tokenPrefix: "ocmcp_aaaa",
        scopes: ["workspace:write"],
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: "2026-04-30T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
