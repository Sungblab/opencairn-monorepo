import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabsStore } from "@/stores/tabs-store";

import {
  DocumentGenerationCards,
  MessageBubble,
  asDocumentGenerationCards,
} from "./message-bubble";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "citation_fallback" && typeof values?.index === "number") {
      return `출처 ${values.index}`;
    }
    if (!values) return key;
    return `${key}:${JSON.stringify(values)}`;
  },
  useLocale: () => "ko",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "ws-test" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../chat/chat-message-renderer-loader", () => ({
  ChatMessageRendererLoader: ({
    body,
  }: {
    body: string;
    streaming: boolean;
  }) => <div>{body}</div>,
}));

const requestId = "00000000-0000-4000-8000-000000000020";
const objectId = "00000000-0000-4000-8000-000000000010";
const projectId = "00000000-0000-4000-8000-000000000003";

const baseAgentMessage = {
  id: "msg-agent",
  role: "agent" as const,
  status: "complete" as const,
  run_id: "run-agent",
  run_status: "complete" as const,
  content: {
    body: "완료된 답변입니다.",
  },
  mode: null,
  provider: null,
  created_at: "2026-05-11T00:00:00.000Z",
};

describe("message bubble status", () => {
  it("does not show a stale status line on completed messages", () => {
    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: "완료된 답변입니다.",
            status: { phrase: "관련 문서 훑는 중..." },
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );

    expect(screen.getByText("완료된 답변입니다.")).toBeInTheDocument();
    expect(screen.queryByText("관련 문서 훑는 중...")).not.toBeInTheDocument();
  });

  it("hides generic transient thinking summaries on completed messages", () => {
    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: "완료된 답변입니다.",
            thought: { summary: "사용자의 질문 분석 중" },
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );

    expect(screen.getByText("완료된 답변입니다.")).toBeInTheDocument();
    expect(screen.queryByText("thought_label")).not.toBeInTheDocument();
    expect(screen.queryByText("사용자의 질문 분석 중")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "thought_label" }),
    ).not.toBeInTheDocument();
  });

  it("shows a status line while a run is still active", () => {
    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          status: "streaming",
          run_status: "running",
          content: {
            body: "",
            status: { phrase: "관련 문서 훑는 중..." },
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );

    expect(screen.getByText("관련 문서 훑는 중...")).toBeInTheDocument();
  });
});

describe("message bubble citations", () => {
  it("hides rendered footnote markers when citation chips carry the source", () => {
    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: '음, "테스트"라고 말씀하셨는데요.[^1]',
            citations: [
              {
                index: 1,
                title: "Untitled",
                noteId: "00000000-0000-4000-8000-000000000001",
              },
            ],
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );

    expect(
      screen.getByText('음, "테스트"라고 말씀하셨는데요.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\[\^1\]/)).not.toBeInTheDocument();
    expect(screen.getByText("출처 1")).toBeInTheDocument();
  });
});

describe("message bubble save suggestions", () => {
  it("renders the save card without exposing internal directive fences", () => {
    const onSaveSuggestion = vi.fn();
    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: '노트로 정리했습니다.\n\n```save-suggestion\n{"title":"요약 노트","body_markdown":"# 요약"}\n```\n\n```agent-actions\n{"actions":[{"kind":"note.create","risk":"write","input":{"title":"요약 노트"}}]}\n```\n\n```agent-file\n{"files":[{"filename":"summary.md","content":"# 요약"}]}\n```',
            save_suggestion: {
              title: "요약 노트",
              body_markdown: "# 요약",
            },
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={onSaveSuggestion}
        onFeedback={vi.fn()}
      />,
    );

    expect(screen.getByText("노트로 정리했습니다.")).toBeInTheDocument();
    expect(screen.getByText(/요약 노트/)).toBeInTheDocument();
    expect(screen.queryByText(/save-suggestion/)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent-actions/)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent-file/)).not.toBeInTheDocument();
    expect(screen.queryByText(/body_markdown/)).not.toBeInTheDocument();
  });
});

describe("message bubble agent actions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-test");
  });

  it("renders completed generated-note actions and opens the created note", async () => {
    const user = userEvent.setup();

    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: "노트를 만들었습니다.",
            agent_actions: [
              {
                id: "00000000-0000-4000-8000-000000000040",
                requestId: "00000000-0000-4000-8000-000000000041",
                workspaceId: "00000000-0000-4000-8000-000000000042",
                projectId,
                actorUserId: "user-1",
                sourceRunId: null,
                kind: "note.create_from_markdown",
                status: "completed",
                risk: "write",
                input: {
                  title: "PDF 요약 노트",
                  folderId: null,
                  bodyMarkdown: "# PDF 요약",
                },
                preview: null,
                result: {
                  ok: true,
                  note: {
                    id: "00000000-0000-4000-8000-000000000043",
                    title: "PDF 요약 노트",
                  },
                },
                errorCode: null,
                createdAt: "2026-05-11T00:00:00.000Z",
                updatedAt: "2026-05-11T00:00:00.000Z",
              },
            ],
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );

    expect(screen.getByText("noteCreateCompleted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "openNote" }));

    expect(useTabsStore.getState().tabs).toEqual([
      expect.objectContaining({
        kind: "note",
        targetId: "00000000-0000-4000-8000-000000000043",
        title: "PDF 요약 노트",
        mode: "plate",
        preview: false,
      }),
    ]);
  });

  it("refreshes stale persisted action snapshots before rendering controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          action: {
            id: "00000000-0000-4000-8000-000000000052",
            requestId: "00000000-0000-4000-8000-000000000053",
            workspaceId: "00000000-0000-4000-8000-000000000054",
            projectId,
            actorUserId: "user-1",
            sourceRunId: null,
            kind: "note.create_from_markdown",
            status: "completed",
            risk: "write",
            input: {
              title: "PDF 요약 노트",
              folderId: null,
              bodyMarkdown: "# PDF 요약",
            },
            preview: null,
            result: {
              ok: true,
              note: {
                id: "00000000-0000-4000-8000-000000000055",
                title: "PDF 요약 노트",
              },
            },
            errorCode: null,
            createdAt: "2026-05-11T00:00:00.000Z",
            updatedAt: "2026-05-11T00:00:00.000Z",
          },
        }),
      ),
    );

    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: "노트 생성 작업을 만들었습니다.",
            agent_actions: [
              {
                id: "00000000-0000-4000-8000-000000000052",
                requestId: "00000000-0000-4000-8000-000000000053",
                workspaceId: "00000000-0000-4000-8000-000000000054",
                projectId,
                actorUserId: "user-1",
                sourceRunId: null,
                kind: "note.create_from_markdown",
                status: "approval_required",
                risk: "write",
                input: {
                  title: "PDF 요약 노트",
                  folderId: null,
                  bodyMarkdown: "# PDF 요약",
                },
                preview: null,
                result: null,
                errorCode: null,
                createdAt: "2026-05-11T00:00:00.000Z",
                updatedAt: "2026-05-11T00:00:00.000Z",
              },
            ],
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );

    expect(await screen.findByText("noteCreateCompleted")).toBeInTheDocument();
    expect(screen.queryByText("noteCreateApproval")).not.toBeInTheDocument();
  });

  it("renders completed file actions and opens the generated file", async () => {
    const user = userEvent.setup();

    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: "파일을 만들었습니다.",
            agent_actions: [
              {
                id: "00000000-0000-4000-8000-000000000044",
                requestId: "00000000-0000-4000-8000-000000000045",
                workspaceId: "00000000-0000-4000-8000-000000000046",
                projectId,
                actorUserId: "user-1",
                sourceRunId: null,
                kind: "file.create",
                status: "completed",
                risk: "write",
                input: {
                  filename: "summary.md",
                  title: "Summary",
                  content: "# Summary",
                },
                preview: null,
                result: {
                  ok: true,
                  file: {
                    id: "00000000-0000-4000-8000-000000000047",
                    title: "Summary",
                    filename: "summary.md",
                  },
                },
                errorCode: null,
                createdAt: "2026-05-11T00:00:00.000Z",
                updatedAt: "2026-05-11T00:00:00.000Z",
              },
            ],
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );

    expect(screen.getByText("completed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "openFile" }));

    expect(useTabsStore.getState().tabs).toEqual([
      expect.objectContaining({
        kind: "agent_file",
        targetId: "00000000-0000-4000-8000-000000000047",
        title: "Summary",
        mode: "agent-file",
        preview: false,
      }),
    ]);
  });

  it("renders generated image file actions with an inline preview", () => {
    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: "이미지를 만들었습니다.",
            agent_actions: [
              {
                id: "00000000-0000-4000-8000-000000000048",
                requestId: "00000000-0000-4000-8000-000000000049",
                workspaceId: "00000000-0000-4000-8000-000000000050",
                projectId,
                actorUserId: "user-1",
                sourceRunId: null,
                kind: "file.create",
                status: "completed",
                risk: "write",
                input: {
                  filename: "figure.png",
                  title: "Generated figure",
                  base64: "iVBORw0KGgo=",
                },
                preview: null,
                result: {
                  ok: true,
                  file: {
                    id: "00000000-0000-4000-8000-000000000051",
                    title: "Generated figure",
                    filename: "figure.png",
                    kind: "image",
                    mimeType: "image/png",
                  },
                },
                errorCode: null,
                createdAt: "2026-05-11T00:00:00.000Z",
                updatedAt: "2026-05-11T00:00:00.000Z",
              },
            ],
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Generated figure" }),
    ).toHaveAttribute(
      "src",
      "/api/agent-files/00000000-0000-4000-8000-000000000051/file",
    );
  });
});

describe("message bubble interaction cards", () => {
  it("renders a structured choice card and forwards the selected answer", async () => {
    const user = userEvent.setup();
    const onInteractionCardSubmit = vi.fn();
    const card = {
      type: "choice" as const,
      id: "card-1",
      prompt: "어떤 형태로 만들까요?",
      allowCustom: true,
      options: [
        {
          id: "summary",
          label: "요약 노트",
          value: "요약 노트로 정리해줘.",
          action: { type: "create_note_draft" as const },
        },
      ],
    };

    render(
      <MessageBubble
        msg={{
          ...baseAgentMessage,
          content: {
            body: "어떤 형태로 만들까요?",
            interaction_card: card,
          },
        }}
        onRegenerate={vi.fn()}
        onSaveSuggestion={vi.fn()}
        onFeedback={vi.fn()}
        onInteractionCardSubmit={onInteractionCardSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: "요약 노트" }));

    expect(onInteractionCardSubmit).toHaveBeenCalledWith({
      card,
      option: card.options[0],
      value: "요약 노트로 정리해줘.",
      label: "요약 노트",
    });
  });
});

describe("document generation cards", () => {
  beforeEach(() => {
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-test");
  });

  it("normalizes requested, running, completed, and failed generation events", () => {
    const cards = asDocumentGenerationCards([
      {
        type: "project_object_generation_requested",
        requestId,
        workflowHint: "document_generation",
        generation: {
          format: "pdf",
          prompt: "Generate a report",
          locale: "ko",
          template: "report",
          sources: [
            { type: "note", noteId: "00000000-0000-4000-8000-000000000030" },
            {
              type: "agent_file",
              objectId: "00000000-0000-4000-8000-000000000031",
            },
            {
              type: "chat_thread",
              threadId: "00000000-0000-4000-8000-000000000032",
            },
            {
              type: "research_run",
              runId: "00000000-0000-4000-8000-000000000033",
            },
            {
              type: "synthesis_run",
              runId: "00000000-0000-4000-8000-000000000034",
            },
          ],
          destination: {
            filename: "project-report.pdf",
            title: "Project report",
            publishAs: "agent_file",
            startIngest: false,
          },
          artifactMode: "object_storage",
        },
      },
      {
        type: "project_object_generation_status",
        requestId,
        status: "running",
      },
      {
        type: "project_object_generation_completed",
        result: {
          ok: true,
          requestId,
          workflowId: `document-generation/${requestId}`,
          format: "pdf",
          object: {
            id: objectId,
            objectType: "agent_file",
            title: "Project report",
            filename: "project-report.pdf",
            kind: "pdf",
            mimeType: "application/pdf",
            projectId,
          },
          artifact: {
            objectKey: "agent-files/project/project-report.pdf",
            mimeType: "application/pdf",
            bytes: 12345,
          },
          sourceQuality: {
            signals: ["metadata_fallback", "no_extracted_text"],
            sources: [
              {
                id: "00000000-0000-4000-8000-000000000031",
                kind: "agent_file",
                title: "Scanned PDF",
                signals: ["no_extracted_text"],
              },
            ],
          },
        },
      },
      {
        type: "project_object_generation_failed",
        result: {
          ok: false,
          requestId: "00000000-0000-4000-8000-000000000021",
          workflowId: "document-generation/failed",
          format: "docx",
          errorCode: "document_generation_failed",
          retryable: true,
        },
      },
    ]);

    expect(cards).toEqual([
      expect.objectContaining({
        requestId,
        status: "completed",
        format: "pdf",
        title: "Project report",
        filename: "project-report.pdf",
        file: expect.objectContaining({ id: objectId, kind: "pdf" }),
        qualitySignals: ["metadata_fallback", "no_extracted_text"],
        qualitySources: [
          expect.objectContaining({
            id: "00000000-0000-4000-8000-000000000031",
            kind: "agent_file",
            title: "Scanned PDF",
            signals: ["no_extracted_text"],
          }),
        ],
        sourceKinds: [
          "note",
          "agent_file",
          "chat_thread",
          "research_run",
          "synthesis_run",
        ],
      }),
      expect.objectContaining({
        requestId: "00000000-0000-4000-8000-000000000021",
        status: "failed",
        format: "docx",
        errorCode: "document_generation_failed",
      }),
    ]);
  });

  it("opens a completed generation result in the agent_file tab viewer", async () => {
    const user = userEvent.setup();
    const cards = asDocumentGenerationCards([
      {
        type: "project_object_generation_completed",
        result: {
          ok: true,
          requestId,
          workflowId: `document-generation/${requestId}`,
          format: "pdf",
          object: {
            id: objectId,
            objectType: "agent_file",
            title: "Project report",
            filename: "project-report.pdf",
            kind: "pdf",
            mimeType: "application/pdf",
            projectId,
          },
          artifact: {
            objectKey: "agent-files/project/project-report.pdf",
            mimeType: "application/pdf",
            bytes: 12345,
          },
        },
      },
    ]);

    render(<DocumentGenerationCards items={cards} />);
    await user.click(screen.getByRole("button", { name: /open/ }));

    expect(useTabsStore.getState().tabs).toEqual([
      expect.objectContaining({
        kind: "agent_file",
        targetId: objectId,
        title: "Project report",
        mode: "agent-file",
      }),
    ]);
    expect(screen.getByRole("link", { name: /download/ })).toHaveAttribute(
      "href",
      `/api/agent-files/${objectId}/file`,
    );
  });

  it("shows an inline preview for completed image generation results", () => {
    const imageId = "00000000-0000-4000-8000-000000000052";
    const cards = asDocumentGenerationCards([
      {
        type: "project_object_generation_completed",
        result: {
          ok: true,
          requestId,
          workflowId: `document-generation/${requestId}`,
          format: "image",
          object: {
            id: imageId,
            objectType: "agent_file",
            title: "Generated diagram",
            filename: "generated-diagram.png",
            kind: "image",
            mimeType: "image/png",
            projectId,
          },
          artifact: {
            objectKey: "agent-files/project/generated-diagram.png",
            mimeType: "image/png",
            bytes: 12345,
          },
        },
      },
    ]);

    render(<DocumentGenerationCards items={cards} />);

    expect(
      screen.getByRole("img", { name: "Generated diagram" }),
    ).toHaveAttribute("src", `/api/agent-files/${imageId}/file`);
  });

  it("shows compact source quality signals without hiding the worker error code", () => {
    const cards = asDocumentGenerationCards([
      {
        type: "project_object_generation_completed",
        result: {
          ok: true,
          requestId,
          workflowId: `document-generation/${requestId}`,
          format: "pdf",
          object: {
            id: objectId,
            objectType: "agent_file",
            title: "Project report",
            filename: "project-report.pdf",
            kind: "pdf",
            mimeType: "application/pdf",
            projectId,
          },
          artifact: {
            objectKey: "agent-files/project/project-report.pdf",
            mimeType: "application/pdf",
            bytes: 12345,
          },
          sourceQuality: {
            signals: ["unsupported_source", "metadata_fallback"],
            sources: [
              {
                id: "00000000-0000-4000-8000-000000000031",
                kind: "agent_file",
                title: "Project report",
                signals: ["unsupported_source", "metadata_fallback"],
              },
            ],
          },
        },
      },
      {
        type: "project_object_generation_failed",
        result: {
          ok: false,
          requestId: "00000000-0000-4000-8000-000000000021",
          workflowId: "document-generation/failed",
          format: "docx",
          errorCode: "document_generation_failed",
          retryable: true,
          sourceQuality: {
            signals: ["source_corrupt"],
            sources: [],
          },
        },
      },
    ]);

    render(<DocumentGenerationCards items={cards} />);

    expect(
      screen.getByText(/qualitySignal.unsupported_source/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/qualitySignal.metadata_fallback/),
    ).toBeInTheDocument();
    expect(screen.getByText(/qualitySourceSummary/)).toHaveTextContent(
      "Project report",
    );
    expect(screen.getByText(/document_generation_failed/)).toBeInTheDocument();
  });
});
