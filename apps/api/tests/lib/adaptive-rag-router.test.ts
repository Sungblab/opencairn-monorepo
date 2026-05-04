import { describe, expect, it } from "vitest";
import {
  summarizeAdaptiveRagPolicy,
  planAdaptiveRagPolicy,
} from "../../src/lib/adaptive-rag-router.js";

const workspaceScope = { type: "workspace" as const, workspaceId: "ws-1" };
const projectScope = {
  type: "project" as const,
  workspaceId: "ws-1",
  projectId: "p-1",
};

describe("planAdaptiveRagPolicy", () => {
  it("turns ragMode=off into a zero-cost retrieval policy", () => {
    const policy = planAdaptiveRagPolicy({
      query: "anything",
      ragMode: "off",
      scope: workspaceScope,
      chips: [],
    });

    expect(policy).toMatchObject({
      resultTopK: 0,
      seedTopK: 0,
      graphDepth: 0,
      graphLimit: 0,
      verifierRequired: false,
      reasons: ["rag_off"],
    });
  });

  it("keeps strict mode bounded even for relationship questions", () => {
    const policy = planAdaptiveRagPolicy({
      query: "이 결정이 다른 문서와 어떻게 연결되는지 추적해줘",
      ragMode: "strict",
      scope: projectScope,
      chips: [],
    });

    expect(policy.graphDepth).toBe(0);
    expect(policy.resultTopK).toBe(5);
    expect(policy.reasons).toEqual(
      expect.arrayContaining(["strict_mode", "explicit_scope", "relationship"]),
    );
  });

  it("skips graph expansion for simple expand-mode lookups", () => {
    const policy = planAdaptiveRagPolicy({
      query: "alpha 정의",
      ragMode: "expand",
      scope: projectScope,
      chips: [],
    });

    expect(policy.graphDepth).toBe(0);
    expect(policy.seedTopK).toBe(policy.resultTopK);
    expect(policy.reasons).toContain("simple_query");
  });

  it("uses deep graph expansion for multi-hop relationship queries", () => {
    const policy = planAdaptiveRagPolicy({
      query: "이 설계가 관련 문서들과 어떻게 연결되는지 흐름을 따라가줘",
      ragMode: "expand",
      scope: workspaceScope,
      chips: [],
      projectCount: 3,
    });

    expect(policy.graphDepth).toBe(2);
    expect(policy.seedTopK).toBeGreaterThanOrEqual(policy.resultTopK);
    expect(policy.graphLimit).toBeGreaterThanOrEqual(policy.seedTopK);
    expect(policy.verifierRequired).toBe(true);
    expect(policy.maxChunksPerNote).toBe(3);
    expect(policy.reasons).toEqual(
      expect.arrayContaining(["relationship", "multi_hop", "workspace_fanout"]),
    );
  });

  it("uses one-hop expansion for comparison or research questions", () => {
    const policy = planAdaptiveRagPolicy({
      query: "두 옵션의 차이와 근거를 비교해줘",
      ragMode: "expand",
      scope: workspaceScope,
      chips: [],
    });

    expect(policy.graphDepth).toBe(1);
    expect(policy.verifierRequired).toBe(true);
    expect(policy.reasons).toEqual(
      expect.arrayContaining(["comparison", "research_depth"]),
    );
  });

  it.each([
    {
      name: "simple",
      query: "alpha 정의",
      expectedRoute: "simple",
      expectedDepth: 0,
      expectedReasons: ["simple_query"],
    },
    {
      name: "comparison",
      query: "alpha와 beta의 차이와 장단점을 비교해줘",
      expectedRoute: "comparison",
      expectedDepth: 1,
      expectedReasons: ["comparison"],
    },
    {
      name: "research",
      query: "alpha 정책의 근거와 출처를 분석해줘",
      expectedRoute: "research",
      expectedDepth: 1,
      expectedReasons: ["research_depth"],
    },
    {
      name: "relationship",
      query: "alpha가 beta와 어떤 관계로 연결되는지 알려줘",
      expectedRoute: "relationship",
      expectedDepth: 2,
      expectedReasons: ["relationship"],
    },
    {
      name: "multi-hop",
      query: "alpha 결정의 원인과 결과 흐름을 여러 문서에서 추적해줘",
      expectedRoute: "multi_hop",
      expectedDepth: 2,
      expectedReasons: ["multi_hop"],
    },
    {
      name: "workspace fanout",
      query: "workspace 전체에서 alpha 근거를 정리해줘",
      expectedRoute: "workspace_fanout",
      expectedDepth: 1,
      expectedReasons: ["research_depth", "workspace_fanout"],
      projectCount: 3,
    },
  ])(
    "summarizes the $name retrieval shape for eval traces",
    ({
      query,
      expectedRoute,
      expectedDepth,
      expectedReasons,
      projectCount,
    }) => {
      const policy = planAdaptiveRagPolicy({
        query,
        ragMode: "expand",
        scope: workspaceScope,
        chips: [],
        projectCount,
      });

      const summary = summarizeAdaptiveRagPolicy(policy);

      expect(summary.route).toBe(expectedRoute);
      expect(summary.retrievalShape.graphDepth).toBe(expectedDepth);
      expect(summary.retrievalShape.resultTopK).toBe(policy.resultTopK);
      expect(summary.retrievalShape.seedTopK).toBe(policy.seedTopK);
      expect(summary.retrievalShape.graphLimit).toBe(policy.graphLimit);
      expect(summary.retrievalShape.contextMaxTokens).toBe(
        policy.contextMaxTokens,
      );
      expect(summary.retrievalShape.maxChunksPerNote).toBe(
        policy.maxChunksPerNote,
      );
      expect(summary.reasons).toEqual(expect.arrayContaining(expectedReasons));
    },
  );
});
