import { describe, expect, it } from "vitest";
import { runChat } from "./chat-llm";
import type { LLMProvider } from "./llm/provider";

describe("runChat agent action fences", () => {
  it("emits typed agent actions proposed by the model", async () => {
    const provider = providerWithText(
      [
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
      ].join("\n"),
    );

    const chunks = [];
    for await (const chunk of runChat({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      scope: {
        type: "workspace",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
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

  it("emits generated-note actions with markdown content", async () => {
    const provider = providerWithText(
      [
        "새 노트로 만들겠습니다.",
        "```agent-actions",
        JSON.stringify({
          actions: [
            {
              kind: "note.create_from_markdown",
              risk: "write",
              input: {
                title: "PDF 요약 노트",
                folderId: null,
                bodyMarkdown: "# PDF 요약\n\n- 운영체제 종류",
              },
            },
          ],
        }),
        "```",
      ].join("\n"),
    );

    const chunks = [];
    for await (const chunk of runChat({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      scope: {
        type: "workspace",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "이 PDF를 요약해서 새 노트로 만들어줘",
      provider,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: "agent_action",
      payload: {
        actions: [
          {
            kind: "note.create_from_markdown",
            risk: "write",
            approvalMode: "auto_safe",
            input: {
              title: "PDF 요약 노트",
              folderId: null,
              bodyMarkdown: "# PDF 요약\n\n- 운영체제 종류",
            },
          },
        ],
      },
    });
    expect(provider.calls?.[0]?.maxOutputTokens).toBeGreaterThanOrEqual(4096);
  });

  it("uses the quality profile and artifact-sized output budget for lecture material organization", async () => {
    const provider = providerWithText("강의자료를 구조화해 정리했습니다.");

    for await (const chunk of runChat({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      scope: {
        type: "workspace",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "이 PDF 강의자료 정리해줘 자료",
      provider,
    })) {
      void chunk;
    }

    expect(provider.calls?.[0]).toMatchObject({
      maxOutputTokens: 20000,
      modelProfile: "quality",
      thinkingLevel: "high",
    });
    expect(provider.calls?.[0]?.messages[0]?.content).toContain(
      "## Study Note Output Contract",
    );
  });

  it("emits generated-note actions when the model omits the final top-level brace", async () => {
    const provider = providerWithText(
      [
        "새 노트로 만들겠습니다.",
        "```agent-actions",
        [
          "{\"actions\":[{\"kind\":\"note.create_from_markdown\",",
          "\"risk\":\"write\",",
          "\"input\":{\"title\":\"PDF 요약 노트\",\"folderId\":null,",
          "\"bodyMarkdown\":\"# PDF 요약\\n\\n- 운영체제 종류\"}}]",
        ].join(""),
        "```",
      ].join("\n"),
    );

    const chunks = [];
    for await (const chunk of runChat({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      scope: {
        type: "workspace",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "이 PDF를 요약해서 새 노트로 만들어줘",
      provider,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: "agent_action",
      payload: {
        actions: [
          {
            kind: "note.create_from_markdown",
            risk: "write",
            approvalMode: "auto_safe",
            input: {
              title: "PDF 요약 노트",
              folderId: null,
              bodyMarkdown: "# PDF 요약\n\n- 운영체제 종류",
            },
          },
        ],
      },
    });
    expect(chunks).not.toContainEqual(
      expect.objectContaining({
        type: "error",
        payload: expect.objectContaining({ code: "artifact_action_required" }),
      }),
    );
  });

  it("fails closed when a creation request has no executable artifact fence", async () => {
    const provider = providerWithText("새 노트를 생성했습니다.");

    const chunks = [];
    for await (const chunk of runChat({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      scope: {
        type: "workspace",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "이 PDF를 요약해서 새 노트로 만들어줘",
      provider,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: "error",
      payload: {
        code: "artifact_action_required",
        messageKey: "chat.errors.artifactActionRequired",
        message:
          "요청한 생성 작업을 실행 가능한 액션으로 만들지 못했습니다. 다시 시도해 주세요.",
      },
    });
  });

  it("emits typed file actions for project file creation", async () => {
    const provider = providerWithText(
      [
        "파일로 저장하겠습니다.",
        "```agent-actions",
        JSON.stringify({
          actions: [
            {
              kind: "file.create",
              risk: "write",
              input: {
                filename: "summary.md",
                title: "Summary",
                content: "# Summary",
              },
            },
          ],
        }),
        "```",
      ].join("\n"),
    );

    const chunks = [];
    for await (const chunk of runChat({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      scope: {
        type: "workspace",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "요약을 markdown 파일로 만들어줘",
      provider,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: "agent_action",
      payload: {
        actions: [
          {
            kind: "file.create",
            risk: "write",
            approvalMode: "auto_safe",
            input: {
              filename: "summary.md",
              title: "Summary",
              content: "# Summary",
            },
          },
        ],
      },
    });
  });

  it("injects structured workflow intent into the model prompt", async () => {
    const provider = providerWithText("확인했습니다.");

    for await (const chunk of runChat({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      scope: {
        type: "project",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
      },
      ragMode: "off",
      chips: [],
      history: [],
      userMessage: "보고서 만들어줘",
      rawScope: {
        workflowIntent: {
          kind: "document_generation",
          toolId: "pdf_report",
          prompt: "보고서 만들어줘",
          payload: {
            action: "generate_project_object",
            generation: { format: "pdf" },
          },
        },
      },
      provider,
    })) {
      void chunk;
    }

    expect(provider.calls?.[0]?.messages[0]?.content).toContain(
      "## Requested Agentic Workflow",
    );
    expect(provider.calls?.[0]?.messages[0]?.content).toContain(
      "\"toolId\": \"pdf_report\"",
    );
    expect(provider.calls?.[0]?.messages[0]?.content).toContain(
      "\"action\": \"generate_project_object\"",
    );
  });
});

function providerWithText(text: string): LLMProvider & {
  calls?: Array<{
    maxOutputTokens?: number;
    modelProfile?: string;
    thinkingLevel?: string;
    messages: Array<{ content: string }>;
  }>;
} {
  const calls: Array<{
    maxOutputTokens?: number;
    modelProfile?: string;
    thinkingLevel?: string;
    messages: Array<{ content: string }>;
  }> = [];
  return {
    calls,
    async embed() {
      return [0.1, 0.2, 0.3];
    },
    async *streamGenerate(opts) {
      calls.push({
        maxOutputTokens: opts.maxOutputTokens,
        modelProfile: opts.modelProfile,
        thinkingLevel: opts.thinkingLevel,
        messages: opts.messages,
      });
      yield { delta: text };
      yield { usage: { tokensIn: 1, tokensOut: 1, model: "test" } };
    },
  };
}
