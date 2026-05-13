"use client";

// Composed user vs agent bubble. The agent branch stitches together the
// optional thought/status/citation/save-suggestion wrappers around the body
// plus the universal action row. We narrow `msg.content.*` via type guards
// instead of `as any` because the wire shape is `unknown` on purpose — the
// SSE pipeline persists arbitrary jsonb and we want the renderer to be the
// single boundary that decides whether each slot is renderable.

import { useTranslations } from "next-intl";
import { stripAgentDirectiveFences } from "@opencairn/shared";
import type { ChatMessage } from "@/lib/api-client";
import { ChatMessageRendererLoader } from "../chat/chat-message-renderer-loader";
import {
  CitationChips,
  asCitations,
  stripRenderedCitationMarkers,
} from "./citation-chips";
import { MessageActions } from "./message-actions";
import { SaveSuggestionCard } from "./save-suggestion-card";
import { StatusLine } from "./status-line";
import { ThoughtBubble } from "./thought-bubble";
import {
  AgentFileCards,
  DocumentGenerationCards,
  asAgentFileCards,
  asDocumentGenerationCards,
} from "./message-attachments";
import {
  InteractionCard,
  isAgentInteractionCard,
  type InteractionCardSubmit,
} from "./interaction-card";
import { AgentActionCards, asAgentActionCards } from "./agent-action-cards";
export {
  AgentFileCards,
  DocumentGenerationCards,
  asAgentFileCards,
  asDocumentGenerationCards,
} from "./message-attachments";
export { asAgentActionCards } from "./agent-action-cards";

type FeedbackSentiment = "positive" | "negative";

function isThought(v: unknown): v is { summary: string; tokens?: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { summary?: unknown }).summary === "string"
  );
}

function isStatus(v: unknown): v is { phrase?: string } {
  return typeof v === "object" && v !== null;
}

function isTransientThought(summary: string): boolean {
  return summary.trim() === "사용자의 질문 분석 중";
}

export function asSaveSuggestion(v: unknown): { title: string } | null {
  if (
    v &&
    typeof v === "object" &&
    typeof (v as { title?: unknown }).title === "string"
  ) {
    return v as { title: string };
  }
  return null;
}

function extractNestedErrorMessage(message: string): string {
  let current = message;
  for (let i = 0; i < 3; i += 1) {
    try {
      const parsed = JSON.parse(current) as unknown;
      if (!parsed || typeof parsed !== "object") return current;
      const record = parsed as Record<string, unknown>;
      const nested = record.error;
      if (nested && typeof nested === "object") {
        const nestedMessage = (nested as Record<string, unknown>).message;
        if (typeof nestedMessage === "string" && nestedMessage.trim()) {
          current = nestedMessage;
          continue;
        }
      }
      const direct = record.message;
      if (typeof direct === "string" && direct.trim()) {
        current = direct;
        continue;
      }
      return current;
    } catch {
      return current;
    }
  }
  return current;
}

function asAgentError(v: unknown): { message: string; code?: string } | null {
  if (!v || typeof v !== "object") return null;
  const record = v as Record<string, unknown>;
  if (typeof record.message !== "string" || !record.message.trim()) return null;
  return {
    message: extractNestedErrorMessage(record.message),
    ...(typeof record.code === "string" ? { code: record.code } : {}),
  };
}

export function MessageBubble({
  msg,
  onRegenerate,
  onSaveSuggestion,
  onFeedback,
  onInteractionCardSubmit,
}: {
  msg: ChatMessage;
  onRegenerate(msgId: string): void;
  onSaveSuggestion(payload: unknown): void;
  onFeedback(msgId: string, s: FeedbackSentiment, reason?: string): void;
  onInteractionCardSubmit?(input: InteractionCardSubmit): void;
}) {
  const t = useTranslations("agentPanel.bubble");

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[86%] whitespace-pre-wrap rounded-[var(--radius-control)] bg-muted px-3 py-2 text-sm text-foreground">
          {msg.content.body}
        </p>
      </div>
    );
  }

  const isActiveRun =
    msg.status === "streaming" ||
    msg.run_status === "queued" ||
    msg.run_status === "running";
  const thought = isThought(msg.content.thought) ? msg.content.thought : null;
  const visibleThought =
    thought && (isActiveRun || !isTransientThought(thought.summary))
      ? thought
      : null;
  const status =
    isActiveRun &&
    isStatus(msg.content.status) &&
    typeof msg.content.status.phrase === "string"
      ? msg.content.status.phrase
      : null;
  const citations = asCitations(msg.content.citations);
  const body = stripRenderedCitationMarkers(
    stripAgentDirectiveFences(String(msg.content.body ?? "")),
    citations,
  );
  const saveSuggestion = asSaveSuggestion(msg.content.save_suggestion);
  const error = asAgentError(msg.content.error);
  const agentFiles = asAgentFileCards(
    msg.content.agent_files,
    msg.content.project_objects,
  );
  const generations = asDocumentGenerationCards(
    msg.content.project_object_generations,
  );
  const agentActions = asAgentActionCards(msg.content.agent_actions);
  const interactionCard = isAgentInteractionCard(msg.content.interaction_card)
    ? msg.content.interaction_card
    : null;

  return (
    <div className="flex flex-col gap-2">
      {visibleThought ? (
        <ThoughtBubble
          summary={visibleThought.summary}
          tokens={visibleThought.tokens}
        />
      ) : null}
      {status ? <StatusLine phrase={status} /> : null}
      <ChatMessageRendererLoader
        body={body}
        streaming={msg.status === "streaming"}
        compact
      />
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {t("error_prefix", {
            message: error.code
              ? `${error.message} (${error.code})`
              : error.message,
          })}
        </div>
      ) : null}
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
      {agentFiles.length > 0 ? <AgentFileCards files={agentFiles} /> : null}
      {generations.length > 0 ? (
        <DocumentGenerationCards items={generations} />
      ) : null}
      {agentActions.length > 0 ? (
        <AgentActionCards actions={agentActions} />
      ) : null}
      {interactionCard ? (
        <InteractionCard
          card={interactionCard}
          onSubmit={(input) => onInteractionCardSubmit?.(input)}
        />
      ) : null}
      <MessageActions
        text={body}
        onRegenerate={() => onRegenerate(msg.id)}
        onFeedback={(s, r) => onFeedback(msg.id, s, r)}
      />
    </div>
  );
}
