import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ApiError, type ChatMessage } from "@/lib/api-client";

import { Conversation } from "./conversation";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "ko",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "ws-test" }),
}));

let messages: ChatMessage[] = [];
let messagesError: unknown = null;
let scrollIntoView: ReturnType<typeof vi.fn>;

vi.mock("@/hooks/use-chat-messages", () => ({
  useChatMessages: () => ({
    data: messages,
    isPending: false,
    error: messagesError,
  }),
}));

vi.mock("./message-bubble-loader", () => ({
  MessageBubbleLoader: ({ msg }: { msg: ChatMessage }) => (
    <div data-testid={`message-${msg.id}`}>{msg.id}</div>
  ),
}));

vi.mock("@/components/chat/chat-message-renderer-loader", () => ({
  ChatMessageRendererLoader: ({
    body,
    compact,
  }: {
    body: string;
    compact?: boolean;
  }) => (
    <div data-testid="live-body" data-compact={compact ? "true" : "false"}>
      {body}
    </div>
  ),
}));

vi.mock("./message-attachments", () => ({
  AgentFileCards: () => null,
  DocumentGenerationCards: () => null,
  asAgentFileCards: () => [],
  asDocumentGenerationCards: () => [],
}));

vi.mock("./status-line", () => ({
  StatusLine: () => null,
}));

vi.mock("./thought-bubble", () => ({
  ThoughtBubble: () => null,
}));

function message(
  input: Partial<ChatMessage> & Pick<ChatMessage, "id">,
): ChatMessage {
  return {
    id: input.id,
    role: input.role ?? "agent",
    status: input.status ?? "complete",
    run_id: input.run_id ?? null,
    run_status: input.run_status ?? null,
    content: input.content ?? { body: "" },
    mode: input.mode ?? "auto",
    provider: input.provider ?? null,
    created_at: input.created_at ?? new Date(0).toISOString(),
  };
}

describe("Conversation durable run resume", () => {
  beforeEach(() => {
    messages = [];
    messagesError = null;
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView =
      scrollIntoView as Element["scrollIntoView"];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it("resumes the newest persisted running agent message", async () => {
    const onResumeRun = vi.fn();
    messages = [
      message({ id: "user-1", role: "user", status: "complete" }),
      message({
        id: "agent-1",
        status: "streaming",
        run_id: "run-1",
        run_status: "running",
      }),
    ];

    render(<Conversation threadId="thread-1" onResumeRun={onResumeRun} />);

    await waitFor(() =>
      expect(onResumeRun).toHaveBeenCalledWith("run-1", "agent-1"),
    );
  });

  it("does not resume while a live stream is already attached", async () => {
    const onResumeRun = vi.fn();
    messages = [
      message({
        id: "agent-1",
        status: "streaming",
        run_id: "run-1",
        run_status: "queued",
      }),
    ];

    render(
      <Conversation
        threadId="thread-1"
        live={{
          id: "agent-1",
          body: "",
          status: null,
          thought: null,
          citations: [],
          save_suggestion: null,
          agent_files: [],
          agent_actions: [],
          project_objects: [],
          project_object_generations: [],
          error: null,
        }}
        onResumeRun={onResumeRun}
      />,
    );

    await waitFor(() => expect(onResumeRun).not.toHaveBeenCalled());
  });

  it("renders the empty state for an existing thread with no messages", () => {
    render(
      <Conversation
        threadId="thread-1"
        emptyState={<div data-testid="empty-thread">empty</div>}
      />,
    );

    expect(screen.getByTestId("empty-thread")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-scroll")).not.toBeInTheDocument();
  });

  it("clears an unavailable active thread", async () => {
    const onThreadUnavailable = vi.fn();
    messagesError = new ApiError(404, "not_found");

    render(
      <Conversation
        threadId="missing-thread"
        onThreadUnavailable={onThreadUnavailable}
      />,
    );

    await waitFor(() => expect(onThreadUnavailable).toHaveBeenCalled());
  });

  it("renders the pending user turn before the live agent stream", () => {
    render(
      <Conversation
        threadId="thread-1"
        pendingUser={message({
          id: "pending-user-1",
          role: "user",
          content: { body: "테스트" },
        })}
        live={{
          id: "agent-1",
          body: "답변",
          status: null,
          thought: null,
          citations: [],
          save_suggestion: null,
          agent_files: [],
          agent_actions: [],
          project_objects: [],
          project_object_generations: [],
          error: null,
        }}
      />,
    );

    const user = screen.getByTestId("message-pending-user-1");
    const live = screen.getByTestId("live-body");
    expect(user.compareDocumentPosition(live)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(live).toHaveAttribute("data-compact", "true");
  });

  it("renders live citations and hides matching footnote markers", () => {
    render(
      <Conversation
        threadId="thread-1"
        live={{
          id: "agent-1",
          body: "자료에서 확인했습니다.[^1]",
          status: null,
          thought: null,
          citations: [
            {
              index: 1,
              title: "운영체제.pdf",
              noteId: "00000000-0000-4000-8000-000000000001",
            },
          ],
          save_suggestion: null,
          agent_files: [],
          agent_actions: [],
          project_objects: [],
          project_object_generations: [],
          error: null,
        }}
      />,
    );

    expect(screen.getByTestId("live-body")).toHaveTextContent(
      "자료에서 확인했습니다.",
    );
    expect(screen.queryByText(/\[\^1\]/)).not.toBeInTheDocument();
    expect(screen.getByText("운영체제.pdf")).toBeInTheDocument();
  });

  it("hides internal directive fences while rendering the live stream", () => {
    render(
      <Conversation
        threadId="thread-1"
        live={{
          id: "agent-1",
          body:
            '노트를 준비했습니다.\n\n```save-suggestion\n{"title":"요약","body_markdown":"# 요약"}\n```\n\n```agent-actions\n{"actions":[{"kind":"note.create","risk":"write","input":{"title":"요약"}}]}\n```\n\n```agent-file\n{"files":[{"filename":"summary.md","content":"# 요약"}]}\n```',
          status: null,
          thought: null,
          citations: [],
          save_suggestion: null,
          agent_files: [],
          agent_actions: [],
          project_objects: [],
          project_object_generations: [],
          error: null,
        }}
      />,
    );

    expect(screen.getByTestId("live-body")).toHaveTextContent("노트를 준비했습니다.");
    expect(screen.queryByText(/save-suggestion/)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent-actions/)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent-file/)).not.toBeInTheDocument();
  });

  it("renders live save suggestions so the user can actually create the note", async () => {
    const onSaveSuggestion = vi.fn();
    render(
      <Conversation
        threadId="thread-1"
        live={{
          id: "agent-1",
          body: "새 노트 초안을 준비했습니다.",
          status: null,
          thought: null,
          citations: [],
          save_suggestion: {
            title: "PDF 요약 노트",
            body_markdown: "# PDF 요약",
          },
          agent_files: [],
          agent_actions: [],
          project_objects: [],
          project_object_generations: [],
          error: null,
        }}
        onSaveSuggestion={onSaveSuggestion}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "save_suggestion_save" }));
    expect(onSaveSuggestion).toHaveBeenCalledWith({
      title: "PDF 요약 노트",
      body_markdown: "# PDF 요약",
    });
  });

  it("renders live note action cards instead of hiding created actions in Activity", () => {
    render(
      <Conversation
        threadId="thread-1"
        live={{
          id: "agent-1",
          body: "노트 생성 작업을 만들었습니다.",
          status: null,
          thought: null,
          citations: [],
          save_suggestion: null,
          agent_files: [],
          agent_actions: [
            {
              id: "00000000-0000-4000-8000-000000000050",
              requestId: "00000000-0000-4000-8000-000000000051",
              workspaceId: "00000000-0000-4000-8000-000000000052",
              projectId: "00000000-0000-4000-8000-000000000053",
              actorUserId: "user-1",
              sourceRunId: null,
              kind: "note.create",
              status: "approval_required",
              risk: "write",
              input: { title: "PDF 요약 노트", folderId: null },
              preview: null,
              result: null,
              errorCode: null,
              createdAt: "2026-05-11T00:00:00.000Z",
              updatedAt: "2026-05-11T00:00:00.000Z",
            },
          ],
          project_objects: [],
          project_object_generations: [],
          error: null,
        }}
      />,
    );

    expect(screen.getByText("noteCreateApproval")).toBeInTheDocument();
    expect(screen.getByText("PDF 요약 노트")).toBeInTheDocument();
  });

  it("does not drag the reader to the bottom while they scroll up during streaming", async () => {
    const liveMessage = {
      id: "agent-1",
      body: "첫 문장",
      status: null,
      thought: null,
      citations: [],
      save_suggestion: null,
      agent_files: [],
      agent_actions: [],
      project_objects: [],
      project_object_generations: [],
      error: null,
    };
    const { rerender } = render(
      <Conversation threadId="thread-1" live={liveMessage} />,
    );
    const scroller = screen.getByTestId("conversation-scroll");
    Object.defineProperty(scroller, "clientHeight", {
      value: 100,
      configurable: true,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(scroller, "scrollTop", {
      value: 100,
      configurable: true,
    });

    fireEvent.scroll(scroller);
    scrollIntoView.mockClear();
    rerender(
      <Conversation
        threadId="thread-1"
        live={{ ...liveMessage, body: "첫 문장\n둘째 문장" }}
      />,
    );

    const jump = await screen.findByRole("button", {
      name: "jump_to_stream",
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(jump);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "end",
      behavior: "smooth",
    });
  });
});
