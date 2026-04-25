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
import { useChatSend } from "@/hooks/use-chat-send";
import { chatApi } from "@/lib/api-client";

import { MessageBubble } from "./message-bubble";
import { StatusLine } from "./status-line";
import { ThoughtBubble } from "./thought-bubble";

interface Props {
  threadId: string | null;
  onSaveSuggestion?: (payload: unknown) => void;
}

export function Conversation({ threadId, onSaveSuggestion }: Props) {
  const t = useTranslations("agentPanel.bubble");
  const { data: messages = [] } = useChatMessages(threadId);
  const { live } = useChatSend(threadId);

  // Ref-based scroll keeps the DOM cheap on long threads — no per-message
  // ref. We re-run on `messages.length` (new turn arrived) and `live?.body`
  // (delta during stream) so the latest content stays in view.
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, live?.body]);

  async function onFeedback(
    msgId: string,
    sentiment: "positive" | "negative",
    reason?: string,
  ) {
    await chatApi.submitFeedback(msgId, sentiment, reason);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-3">
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
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
