"use client";

// Composed user vs agent bubble. The agent branch stitches together the
// optional thought/status/citation/save-suggestion wrappers around the body
// plus the universal action row. We narrow `msg.content.*` via type guards
// instead of `as any` because the wire shape is `unknown` on purpose — the
// SSE pipeline persists arbitrary jsonb and we want the renderer to be the
// single boundary that decides whether each slot is renderable.

import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";

import type { ChatMessage } from "@/lib/api-client";
import { newTab } from "@/lib/tab-factory";
import { useTabsStore } from "@/stores/tabs-store";

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

export type AgentFileCardItem = {
  id: string;
  title: string;
  filename: string;
  kind?: string;
  mimeType?: string;
};

export function asAgentFileCards(...values: unknown[]): AgentFileCardItem[] {
  const byId = new Map<string, AgentFileCardItem>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (record.objectType && record.objectType !== "agent_file") continue;
      if (typeof record.id !== "string") continue;
      const filename =
        typeof record.filename === "string" ? record.filename : "generated";
      byId.set(record.id, {
        id: record.id,
        title:
          typeof record.title === "string" && record.title.trim()
            ? record.title
            : filename,
        filename,
        ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
        ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
      });
    }
  }
  return [...byId.values()];
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
  const agentFiles = asAgentFileCards(
    msg.content.agent_files,
    msg.content.project_objects,
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
      {agentFiles.length > 0 ? <AgentFileCards files={agentFiles} /> : null}
      <MessageActions
        text={msg.content.body}
        onRegenerate={() => onRegenerate(msg.id)}
        onFeedback={(s, r) => onFeedback(msg.id, s, r)}
      />
    </div>
  );
}

export function AgentFileCards({ files }: { files: AgentFileCardItem[] }) {
  const t = useTranslations("agentFiles.card");
  const addOrActivateTab = useTabsStore((s) => s.addTab);
  const findTabByTarget = useTabsStore((s) => s.findTabByTarget);
  const setActive = useTabsStore((s) => s.setActive);

  return (
    <div className="grid gap-2">
      {files.map((file) => (
        <button
          key={file.id}
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted"
          onClick={() => {
            const existing = findTabByTarget("agent_file", file.id);
            if (existing) {
              setActive(existing.id);
              return;
            }
            addOrActivateTab(
              newTab({
                kind: "agent_file",
                targetId: file.id,
                title: file.title,
                mode: "agent-file",
                preview: false,
              }),
            );
          }}
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{file.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {t("created", { filename: file.filename })}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{t("open")}</span>
        </button>
      ))}
    </div>
  );
}
