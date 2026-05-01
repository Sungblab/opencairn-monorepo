import { describe, expect, it } from "vitest";
import { resolveAgentRetrievalOptions } from "../src/lib/agent-pipeline.js";

describe("agent-pipeline retrieval scope", () => {
  it("normalizes concrete page/project/workspace chips", () => {
    const resolved = resolveAgentRetrievalOptions({
      workspaceId: "w1",
      rawScope: {
        strict: "strict",
        chips: [
          { type: "page", id: "n1" },
          { type: "project", id: "p1" },
          { type: "workspace", id: "w1" },
        ],
      },
    });

    expect(resolved).toEqual({
      scope: { type: "workspace", workspaceId: "w1" },
      ragMode: "strict",
      chips: [
        { type: "page", id: "n1" },
        { type: "project", id: "p1" },
        { type: "workspace", id: "w1" },
      ],
    });
  });

  it("maps loose mode to expanded retrieval and drops unsupported chips", () => {
    const resolved = resolveAgentRetrievalOptions({
      workspaceId: "w1",
      rawScope: {
        strict: "loose",
        chips: [
          { type: "workspace", id: "other" },
          { type: "memory", id: "m1" },
          { type: "page", id: 123 },
        ],
      },
    });

    expect(resolved).toEqual({
      scope: { type: "workspace", workspaceId: "w1" },
      ragMode: "expand",
      chips: [],
    });
  });

  it("lets explicit ragMode override the UI strictness flag", () => {
    const resolved = resolveAgentRetrievalOptions({
      workspaceId: "w1",
      rawScope: { strict: "loose", chips: [{ type: "page", id: "n1" }] },
      ragMode: "off",
    });

    expect(resolved.ragMode).toBe("off");
    expect(resolved.chips).toEqual([{ type: "page", id: "n1" }]);
  });
});
