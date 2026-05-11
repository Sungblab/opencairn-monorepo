import { describe, expect, it } from "vitest";
import { runChat } from "./chat-llm";
import type { LLMProvider } from "./llm/provider";

describe("runChat agent action fences", () => {
  it("emits typed agent actions proposed by the model", async () => {
    const provider = providerWithText([
      "I'll draft it.",
      "```agent-actions",
      JSON.stringify({
        actions: [
          {
            kind: "note.create",
            risk: "write",
            input: { title: "Project brief", folderId: null },
          },
        ],
      }),
      "```",
    ].join("\n"));

    const chunks = [];
    for await (const chunk of runChat({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      scope: { type: "workspace", workspaceId: "00000000-0000-4000-8000-000000000001" },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "프로젝트 브리프 노트 만들어줘",
      provider,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: "agent_action",
      payload: {
        actions: [
          {
            kind: "note.create",
            risk: "write",
            approvalMode: "auto_safe",
            input: { title: "Project brief", folderId: null },
          },
        ],
      },
    });
  });
});

function providerWithText(text: string): LLMProvider {
  return {
    async embed() {
      return [0.1, 0.2, 0.3];
    },
    async *streamGenerate() {
      yield { delta: text };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "test" } };
    },
  };
}
