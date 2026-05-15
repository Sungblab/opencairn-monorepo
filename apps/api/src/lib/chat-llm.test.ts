import { describe, expect, it } from "vitest";
import { runChat } from "./chat-llm";
import type { LLMProvider } from "./llm/provider";

const detailedStudyNoteMarkdown = [
  "# PDF 요약 노트",
  "## 1. 학습 목표",
  "컴퓨터 소프트웨어와 운영체제 자료를 처음 읽는 학생이 전체 흐름을 복습할 수 있도록 정리한다.",
  "## 2. 시스템 소프트웨어",
  "시스템 소프트웨어는 하드웨어와 응용 프로그램 사이에서 자원을 관리한다. 운영체제, 컴파일러, 유틸리티가 포함된다.",
  "## 3. 응용 소프트웨어",
  "응용 소프트웨어는 사용자의 목적을 직접 수행하는 프로그램이다. 문서 작성, 웹 탐색, 그래픽 작업처럼 구체적인 과업을 다룬다.",
  "## 4. 운영체제 역할",
  "운영체제는 프로세스, 메모리, 파일, 입출력 장치를 관리한다. 사용자와 하드웨어 사이의 일관된 인터페이스도 제공한다.",
  "## 5. 빌드와 실행 과정",
  "원시코드는 컴파일러, 어셈블러, 링커, 로더를 거치며 실행 가능한 형태가 된다. 각 단계는 코드 번역, 목적 코드 생성, 라이브러리 결합, 메모리 적재를 담당한다.",
  "## 6. 복습 질문",
  "1. 시스템 소프트웨어와 응용 소프트웨어의 차이는 무엇인가?",
  "2. 링커와 로더는 각각 어떤 단계에서 동작하는가?",
  "3. 운영체제가 자원 관리를 하지 않으면 어떤 문제가 발생하는가?",
  Array.from(
    { length: 36 },
    (_, index) =>
      `### 세부 정리 ${index + 1}\n자료의 핵심 개념을 예시와 함께 다시 설명한다. 운영체제는 자원을 추상화하고, 소프트웨어 계층은 사용자가 하드웨어 세부사항을 직접 다루지 않아도 작업을 수행하게 만든다.`,
  ).join("\n\n"),
].join("\n\n");

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
                bodyMarkdown: detailedStudyNoteMarkdown,
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
              bodyMarkdown: detailedStudyNoteMarkdown,
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
          '{"actions":[{"kind":"note.create_from_markdown",',
          '"risk":"write",',
          '"input":{"title":"PDF 요약 노트","folderId":null,',
          `"bodyMarkdown":${JSON.stringify(detailedStudyNoteMarkdown)}}}]`,
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
              bodyMarkdown: detailedStudyNoteMarkdown,
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

  it("fails closed when a generated study note is too shallow", async () => {
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
      userMessage: "이 PDF를 상세 정리 노트로 만들어줘",
      provider,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: "error",
      payload: {
        code: "generated_artifact_too_shallow",
        messageKey: "chat.errors.generatedArtifactTooShallow",
        message:
          "생성된 학습 노트가 너무 얕아서 저장하지 않았습니다. 상세 정리 노트로 다시 시도해 주세요.",
      },
    });
    expect(chunks).not.toContainEqual(
      expect.objectContaining({ type: "agent_action" }),
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
      '"toolId": "pdf_report"',
    );
    expect(provider.calls?.[0]?.messages[0]?.content).toContain(
      '"action": "generate_project_object"',
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
