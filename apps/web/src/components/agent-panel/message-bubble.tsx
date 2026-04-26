"use client";

// Composed user vs agent bubble. The agent branch stitches together the
// optional thought/status/citation/save-suggestion wrappers around the body
// plus the universal action row. We narrow `msg.content.*` via type guards
// instead of `as any` because the wire shape is `unknown` on purpose — the
// SSE pipeline persists arbitrary jsonb and we want the renderer to be the
// single boundary that decides whether each slot is renderable.

import { useTranslations } from "next-intl";

import type { ChatMessage } from "@/lib/api-client";

import { ChatMessageRenderer } from "../chat/chat-message-renderer";
import { CitationChips, type Citation } from "./citation-chips";
import { MessageActions } from "./message-actions";
import { SaveSuggestionCard } from "./save-suggestion-card";
import { StatusLine } from "./status-line";
import { ThoughtBubble } from "./thought-bubble";

type FeedbackSentiment = "positive" | "negative";

function isThought(
  v: unknown,
): v is { summary: string; tokens?: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { summary?: unknown }).summary === "string"
  );
}

function isStatus(v: unknown): v is { phrase?: string } {
  return typeof v === "object" && v !== null;
}

function asCitations(v: unknown): Citation[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (c): c is Citation =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as { index?: unknown }).index === "number" &&
      typeof (c as { title?: unknown }).title === "string",
  );
}

function asSaveSuggestion(v: unknown): { title: string } | null {
  if (
    v &&
    typeof v === "object" &&
    typeof (v as { title?: unknown }).title === "string"
  ) {
    return v as { title: string };
  }
  return null;
}

export function MessageBubble({
  msg,
  onRegenerate,
  onSaveSuggestion,
  onFeedback,
}: {
  msg: ChatMessage;
  onRegenerate(msgId: string): void;
  onSaveSuggestion(payload: unknown): void;
  onFeedback(msgId: string, s: FeedbackSentiment, reason?: string): void;
}) {
  const t = useTranslations("agentPanel.bubble");

  if (msg.role === "user") {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase text-muted-foreground">
          {t("user_label")}
        </span>
        <p className="whitespace-pre-wrap text-sm">{msg.content.body}</p>
      </div>
    );
  }

  const thought = isThought(msg.content.thought) ? msg.content.thought : null;
  const status =
    isStatus(msg.content.status) && typeof msg.content.status.phrase === "string"
      ? msg.content.status.phrase
      : null;
  const citations = asCitations(msg.content.citations);
  const saveSuggestion = asSaveSuggestion(msg.content.save_suggestion);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase text-muted-foreground">
          {t("agent_label")}
        </span>
        {msg.mode ? (
          <span className="rounded border border-border px-1.5 text-[10px] uppercase tracking-wide">
            {msg.mode}
          </span>
        ) : null}
      </div>
      {thought ? (
        <ThoughtBubble summary={thought.summary} tokens={thought.tokens} />
      ) : null}
      {status ? <StatusLine phrase={status} /> : null}
      <ChatMessageRenderer
        body={String(msg.content.body ?? "")}
        streaming={msg.status === "streaming"}
      />
      {citations.length > 0 ? <CitationChips citations={citations} /> : null}
      {saveSuggestion ? (
        <SaveSuggestionCard
          title={saveSuggestion.title}
          onSave={() => onSaveSuggestion(msg.content.save_suggestion)}
          onDismiss={() => {
            /* dismissal is local-only until Phase 4 wires the persisted state */
          }}
        />
      ) : null}
      <MessageActions
        text={msg.content.body}
        onRegenerate={() => onRegenerate(msg.id)}
        onFeedback={(s, r) => onFeedback(msg.id, s, r)}
      />
    </div>
  );
}
