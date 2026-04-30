import { describe, expect, it } from "vitest";
import { selectChatRuntimePolicy } from "../../src/lib/chat-runtime-policy.js";

describe("selectChatRuntimePolicy", () => {
  it("maps explicit modes to Gemini 3 thinking levels", () => {
    expect(selectChatRuntimePolicy({ mode: "fast", userMessage: "hi" }).thinkingLevel).toBe("low");
    expect(selectChatRuntimePolicy({ mode: "balanced", userMessage: "hi" }).thinkingLevel).toBe("medium");
    expect(selectChatRuntimePolicy({ mode: "accurate", userMessage: "hi" }).thinkingLevel).toBe("high");
    expect(selectChatRuntimePolicy({ mode: "research", userMessage: "hi" }).thinkingLevel).toBe("high");
  });

  it("auto escalates latest questions to high thinking and external grounding", () => {
    expect(
      selectChatRuntimePolicy({
        mode: "auto",
        userMessage: "오늘 Gemini 3 최신 뉴스 알려줘",
      }),
    ).toMatchObject({
      thinkingLevel: "high",
      externalGroundingRequired: true,
      verifierRequired: true,
    });
  });

  it("balanced workspace question requires workspace evidence", () => {
    expect(
      selectChatRuntimePolicy({
        mode: "balanced",
        userMessage: "내 문서에서 Plan 11B 요약해줘",
      }),
    ).toMatchObject({
      thinkingLevel: "medium",
      workspaceEvidenceRequired: true,
    });
  });
});
