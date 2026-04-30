import { describe, expect, it } from "vitest";

import {
  bearerToken,
  generateMcpServerToken,
  hashMcpServerToken,
  looksLikeMcpServerToken,
  tokenPrefix,
} from "../../src/lib/mcp-server/token";

describe("MCP server token helpers", () => {
  it("generates redacted hashable tokens", () => {
    const token = generateMcpServerToken();
    expect(looksLikeMcpServerToken(token)).toBe(true);
    expect(tokenPrefix(token)).toMatch(/^ocmcp_[A-Za-z0-9_-]{4}$/);
    expect(hashMcpServerToken(token)).toHaveLength(64);
    expect(hashMcpServerToken(token)).not.toContain(token);
  });

  it("parses bearer headers", () => {
    expect(bearerToken("Bearer ocmcp_abc")).toBe("ocmcp_abc");
    expect(bearerToken("Basic nope")).toBeNull();
  });
});
