import { describe, expect, it } from "vitest";

import {
  McpServerCreateSchema,
  McpServerSummarySchema,
  McpServerTestResultSchema,
  McpServerUpdateSchema,
} from "../src/mcp";

describe("McpServerCreateSchema", () => {
  it("accepts a minimal HTTPS URL", () => {
    const parsed = McpServerCreateSchema.parse({
      displayName: "My Linear",
      serverUrl: "https://mcp.linear.app/mcp",
    });
    expect(parsed.authHeaderName).toBe("Authorization");
  });

  it("rejects non-HTTPS URLs", () => {
    expect(
      McpServerCreateSchema.safeParse({
        displayName: "Plain HTTP",
        serverUrl: "http://example.com/mcp",
      }).success,
    ).toBe(false);
  });
});

describe("McpServerUpdateSchema", () => {
  it("does not allow serverUrl updates", () => {
    expect(
      McpServerUpdateSchema.safeParse({
        displayName: "Renamed",
        serverUrl: "https://changed.example/mcp",
      }).success,
    ).toBe(false);
  });
});

describe("McpServerSummarySchema", () => {
  it("never carries a plaintext authHeaderValue", () => {
    expect(Object.keys(McpServerSummarySchema.shape)).not.toContain(
      "authHeaderValue",
    );
    expect(Object.keys(McpServerSummarySchema.shape)).toContain("hasAuth");
  });
});

describe("McpServerTestResultSchema", () => {
  it("accepts success and auth-failed results", () => {
    expect(
      McpServerTestResultSchema.parse({
        status: "ok",
        toolCount: 2,
        sampleNames: ["add"],
        durationMs: 12,
      }).status,
    ).toBe("ok");
    expect(
      McpServerTestResultSchema.parse({
        status: "auth_failed",
        toolCount: 0,
        sampleNames: [],
        durationMs: 12,
      }).status,
    ).toBe("auth_failed");
  });
});
