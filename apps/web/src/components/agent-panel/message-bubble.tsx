"use client";

// Composed user vs agent bubble. The agent branch stitches together the
// optional thought/status/citation/save-suggestion wrappers around the body
// plus the universal action row. We narrow `msg.content.*` via type guards
// instead of `as any` because the wire shape is `unknown` on purpose — the
// SSE pipeline persists arbitrary jsonb and we want the renderer to be the
// single boundary that decides whether each slot is renderable.

import { useTranslations } from "next-intl";
import type { ChatMessage } from "@/lib/api-client";
import { ChatMessageRendererLoader } from "../chat/chat-message-renderer-loader";
import { CitationChips, type Citation } from "./citation-chips";
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
export {
  AgentFileCards,
  DocumentGenerationCards,
  asAgentFileCards,
  asDocumentGenerationCards,
} from "./message-attachments";

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
    isStatus(msg.content.status) &&
    typeof msg.content.status.phrase === "string"
      ? msg.content.status.phrase
      : null;
  const citations = asCitations(msg.content.citations);
  const saveSuggestion = asSaveSuggestion(msg.content.save_suggestion);
  const error = asAgentError(msg.content.error);
  const agentFiles = asAgentFileCards(
    msg.content.agent_files,
    msg.content.project_objects,
  );
  const generations = asDocumentGenerationCards(
    msg.content.project_object_generations,
  );

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
      <ChatMessageRendererLoader
        body={String(msg.content.body ?? "")}
        streaming={msg.status === "streaming"}
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
      <MessageActions
        text={msg.content.body}
        onRegenerate={() => onRegenerate(msg.id)}
        onFeedback={(s, r) => onFeedback(msg.id, s, r)}
      />
    </div>
  );
}
