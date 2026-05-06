"use client";

// Scrollable message log + transient streaming bubble for a single thread.
// The persisted rows from `useChatMessages` and the in-flight `live` slot
// from `useChatSend` are intentionally rendered as siblings, not merged: when
// the SSE `done` frame fires the hook clears `live` and invalidates the query
// so the persisted row appears in the same position without a double-render.
//
// `onSaveSuggestion` is lifted to a prop so the AgentPanel host can wire the
// Plan 11B consumer without touching this component again.

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { useChatMessages } from "@/hooks/use-chat-messages";
import type { StreamingAgentMessage } from "@/hooks/use-chat-send";
import { chatApi } from "@/lib/api-client";

import {
  AgentFileCards,
  DocumentGenerationCards,
  MessageBubble,
  asAgentFileCards,
  asDocumentGenerationCards,
} from "./message-bubble";
import { StatusLine } from "./status-line";
import { ThoughtBubble } from "./thought-bubble";

interface Props {
  threadId: string | null;
  live?: StreamingAgentMessage | null;
  onResumeRun?: (runId: string, messageId: string) => void;
  onSaveSuggestion?: (payload: unknown) => void;
}

export function Conversation({
  threadId,
  live = null,
  onResumeRun,
  onSaveSuggestion,
}: Props) {
  const t = useTranslations("agentPanel.bubble");
  const { data: messages = [] } = useChatMessages(threadId);

  // Ref-based scroll keeps the DOM cheap on long threads — no per-message
  // ref. We re-run on `messages.length` (new turn arrived) and `live?.body`
  // (delta during stream) so the latest content stays in view.
  //
  // Behavior: `auto` while a stream is live (re-firing `smooth` on every
  // delta retriggers the animation and visibly lags behind the text), and
  // `smooth` when the turn lands so the boundary feels intentional.
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const behavior: ScrollBehavior = live ? "auto" : "smooth";
    endRef.current?.scrollIntoView({ block: "end", behavior });
  }, [messages.length, live?.body]);

  useEffect(() => {
    if (live) return;
    const running = [...messages]
      .reverse()
      .find(
        (m) =>
          m.role === "agent" &&
          m.run_id &&
          (m.status === "streaming" ||
            m.run_status === "queued" ||
            m.run_status === "running"),
      );
    if (running?.run_id) {
      onResumeRun?.(running.run_id, running.id);
    }
  }, [messages, live, onResumeRun]);

  async function onFeedback(
    msgId: string,
    sentiment: "positive" | "negative",
    reason?: string,
  ) {
    await chatApi.submitFeedback(msgId, sentiment, reason);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto bg-background/35 p-3">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          msg={m}
          onRegenerate={() => {
            // Plan 11A wires regenerate; Phase 4 leaves it as a no-op so the
            // action button doesn't disappear and reflow the row mid-thread.
          }}
          onSaveSuggestion={(payload) => onSaveSuggestion?.(payload)}
          onFeedback={onFeedback}
        />
      ))}
      {live ? (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase text-muted-foreground">
            {t("agent_label")}
          </span>
          {live.thought ? <ThoughtBubble {...live.thought} /> : null}
          {live.status?.phrase ? (
            <StatusLine phrase={live.status.phrase} />
          ) : null}
          <p className="whitespace-pre-wrap text-sm">{live.body}</p>
          {live.agent_files.length > 0 || live.project_objects.length > 0 ? (
            <AgentFileCards
              files={asAgentFileCards(live.agent_files, live.project_objects)}
            />
          ) : null}
          {live.project_object_generations.length > 0 ? (
            <DocumentGenerationCards
              items={asDocumentGenerationCards(live.project_object_generations)}
            />
          ) : null}
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
