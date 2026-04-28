import { describe, expect, it } from "vitest";

import { mcpServerStatusEnum, userMcpServers } from "../src/index";

describe("userMcpServers schema", () => {
  it("declares the Phase 1 columns", () => {
    expect(Object.keys(userMcpServers)).toEqual(
      expect.arrayContaining([
        "id",
        "userId",
        "serverSlug",
        "displayName",
        "serverUrl",
        "authHeaderName",
        "authHeaderValueEncrypted",
        "status",
        "lastSeenToolCount",
        "lastSeenAt",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("exports the status enum values", () => {
    expect(mcpServerStatusEnum.enumValues).toEqual([
      "active",
      "disabled",
      "auth_expired",
    ]);
  });
});
