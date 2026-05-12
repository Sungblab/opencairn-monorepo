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

  it("does not show stale thinking metadata on completed messages", () => {
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

    expect(screen.getByText('음, "테스트"라고 말씀하셨는데요.')).toBeInTheDocument();
    expect(screen.queryByText(/\[\^1\]/)).not.toBeInTheDocument();
    expect(screen.getByText("출처 1")).toBeInTheDocument();
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

    expect(screen.getByText(/qualitySignal.unsupported_source/)).toBeInTheDocument();
    expect(screen.getByText(/qualitySignal.metadata_fallback/)).toBeInTheDocument();
    expect(screen.getByText(/qualitySourceSummary/)).toHaveTextContent("Project report");
    expect(screen.getByText(/document_generation_failed/)).toBeInTheDocument();
  });
});
