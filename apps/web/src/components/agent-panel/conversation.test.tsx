import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ChatMessage } from "@/lib/api-client";

import { Conversation } from "./conversation";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

let messages: ChatMessage[] = [];

vi.mock("@/hooks/use-chat-messages", () => ({
  useChatMessages: () => ({ data: messages }),
}));

vi.mock("./message-bubble", () => ({
  MessageBubble: ({ msg }: { msg: ChatMessage }) => <div>{msg.id}</div>,
  AgentFileCards: () => null,
  asAgentFileCards: () => [],
}));

vi.mock("./status-line", () => ({
  StatusLine: () => null,
}));

vi.mock("./thought-bubble", () => ({
  ThoughtBubble: () => null,
}));

function message(input: Partial<ChatMessage> & Pick<ChatMessage, "id">): ChatMessage {
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
    Element.prototype.scrollIntoView = vi.fn();
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
          project_objects: [],
          error: null,
        }}
        onResumeRun={onResumeRun}
      />,
    );

    await waitFor(() => expect(onResumeRun).not.toHaveBeenCalled());
  });
});
