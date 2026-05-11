import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ChatMessage } from "@/lib/api-client";

import { Conversation } from "./conversation";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

let messages: ChatMessage[] = [];
let scrollIntoView: ReturnType<typeof vi.fn>;

vi.mock("@/hooks/use-chat-messages", () => ({
  useChatMessages: () => ({ data: messages }),
}));

vi.mock("./message-bubble-loader", () => ({
  MessageBubbleLoader: ({ msg }: { msg: ChatMessage }) => (
    <div data-testid={`message-${msg.id}`}>{msg.id}</div>
  ),
}));

vi.mock("@/components/chat/chat-message-renderer-loader", () => ({
  ChatMessageRendererLoader: ({ body }: { body: string }) => (
    <div data-testid="live-body">{body}</div>
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
