import { describe, expect, it } from "vitest";
import { classifyChatIntent } from "../../src/lib/chat-intent-router.js";

describe("classifyChatIntent", () => {
  it("detects freshness-required Korean and English requests", () => {
    expect(classifyChatIntent("오늘 Gemini 3 최신 변경점 알려줘")).toMatchObject({
      freshnessRequired: true,
    });
    expect(classifyChatIntent("Who is the current CEO of OpenAI?")).toMatchObject({
      freshnessRequired: true,
    });
  });

  it("detects workspace-grounded requests", () => {
    expect(classifyChatIntent("내 문서에서 Plan 11B가 뭐였는지 찾아줘")).toMatchObject({
      workspaceGrounded: true,
    });
    expect(classifyChatIntent("Summarize this workspace project")).toMatchObject({
      workspaceGrounded: true,
    });
  });

  it("detects tool action requests", () => {
    expect(classifyChatIntent("이 내용을 새 노트로 저장해줘")).toMatchObject({
      toolAction: true,
    });
    expect(classifyChatIntent("Import this GitHub repo")).toMatchObject({
      toolAction: true,
    });
  });

  it("detects research-depth requests", () => {
    expect(classifyChatIntent("Gemini 3와 Claude 최신 모델을 근거 기반으로 비교 조사해줘")).toMatchObject({
      researchDepth: true,
      freshnessRequired: true,
    });
  });

  it("detects ambiguous short requests", () => {
    expect(classifyChatIntent("해줘")).toMatchObject({
      ambiguous: true,
    });
  });
});
