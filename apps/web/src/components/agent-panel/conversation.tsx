"use client";

// Scrollable message log + transient streaming bubble for a single thread.
// The persisted rows from `useChatMessages` and the in-flight `live` slot
// from `useChatSend` are intentionally rendered as siblings, not merged: when
// the SSE `done` frame fires the hook clears `live` and invalidates the query
// so the persisted row appears in the same position without a double-render.
//
// `onSaveSuggestion` is lifted to a prop so the AgentPanel host can wire the
// Plan 11B consumer without touching this component again.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { stripAgentDirectiveFences } from "@opencairn/shared";
import { ArrowDown } from "lucide-react";

import { ChatMessageRendererLoader } from "@/components/chat/chat-message-renderer-loader";
import { useChatMessages } from "@/hooks/use-chat-messages";
import type { StreamingAgentMessage } from "@/hooks/use-chat-send";
import { ApiError, chatApi, type ChatMessage } from "@/lib/api-client";

import {
  AgentFileCards,
  DocumentGenerationCards,
  asAgentFileCards,
  asDocumentGenerationCards,
} from "./message-attachments";
import { AgentActionCards, asAgentActionCards } from "./agent-action-cards";
import { SaveSuggestionCard } from "./save-suggestion-card";
import { asSaveSuggestion } from "./message-bubble";
import { MessageBubbleLoader } from "./message-bubble-loader";
import { StatusLine } from "./status-line";
import { ThoughtBubble } from "./thought-bubble";
import {
  CitationChips,
  asCitations,
  stripRenderedCitationMarkers,
} from "./citation-chips";
import {
  isAgentInteractionCard,
  type InteractionCardSubmit,
} from "./interaction-card";

function liveErrorMessage(
  error: StreamingAgentMessage["error"],
): string | null {
  if (!error?.message) return null;
  return error.code ? `${error.message} (${error.code})` : error.message;
}

interface Props {
  threadId: string | null;
  live?: StreamingAgentMessage | null;
  pendingUser?: ChatMessage | null;
  onResumeRun?: (runId: string, messageId: string) => void;
  onSaveSuggestion?: (payload: unknown) => void;
  onInteractionCardSubmit?: (input: InteractionCardSubmit) => void;
  onThreadUnavailable?: () => void;
  emptyState?: ReactNode;
  workflowCard?: ReactNode;
}

export function Conversation({
  threadId,
  live = null,
  pendingUser = null,
  onResumeRun,
  onSaveSuggestion,
  onInteractionCardSubmit,
  onThreadUnavailable,
  emptyState,
  workflowCard,
}: Props) {
  const t = useTranslations("agentPanel.bubble");
  const {
    data: messages = [],
    isPending,
    error: messagesError,
  } = useChatMessages(threadId);
  const liveError = liveErrorMessage(live?.error ?? null);
  const liveCitations = asCitations(live?.citations);
  const liveSaveSuggestion = asSaveSuggestion(live?.save_suggestion);
  const liveAgentActions = asAgentActionCards(live?.agent_actions);
  const liveBody = live
    ? stripRenderedCitationMarkers(
        stripAgentDirectiveFences(live.body),
        liveCitations,
      )
    : "";
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const liveActiveRef = useRef(false);
  const messageCountRef = useRef(0);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [answeredCards, setAnsweredCards] = useState<
    Record<string, { value: string; label?: string }>
  >({});
  const pendingUserAlreadyPersisted =
    pendingUser !== null &&
    messages.some(
      (message) =>
        message.id === pendingUser.id ||
        (message.role === "user" &&
          message.content.body === pendingUser.content.body),
    );
  const visiblePendingUser =
    pendingUser && !pendingUserAlreadyPersisted ? pendingUser : null;
  const showEmptyState =
    emptyState &&
    !isPending &&
    messages.length === 0 &&
    !visiblePendingUser &&
    !live &&
    !workflowCard;

  const updatePinnedState = useCallback(() => {
    const node = scrollAreaRef.current;
    if (!node) return true;
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    const pinned = distanceFromBottom < 72;
    setIsPinnedToBottom(pinned);
    if (pinned) setShowJumpToLatest(false);
    return pinned;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ block: "end", behavior });
      setIsPinnedToBottom(true);
      setShowJumpToLatest(false);
    });
  }, []);

  const handleScroll = useCallback(() => {
    updatePinnedState();
  }, [updatePinnedState]);

  useEffect(() => {
    if (
      messagesError instanceof ApiError &&
      (messagesError.status === 403 || messagesError.status === 404)
    ) {
      onThreadUnavailable?.();
    }
  }, [messagesError, onThreadUnavailable]);

  useEffect(() => {
    messageCountRef.current = messages.length;
    liveActiveRef.current = Boolean(live);
    scrollToBottom("auto");
  }, [threadId, scrollToBottom]);

  useEffect(() => {
    const liveStarted = Boolean(live) && !liveActiveRef.current;
    const liveEnded = !live && liveActiveRef.current;
    const messageCountChanged = messages.length !== messageCountRef.current;
    liveActiveRef.current = Boolean(live);
    messageCountRef.current = messages.length;

    if (!liveStarted && !liveEnded && !messageCountChanged) return;

    if (liveStarted || liveEnded || isPinnedToBottom) {
      scrollToBottom("smooth");
    } else {
      setShowJumpToLatest(true);
    }
  }, [isPinnedToBottom, live, messages.length, scrollToBottom]);

  useEffect(() => {
    if (!live) return;
    if (isPinnedToBottom || updatePinnedState()) {
      scrollToBottom("auto");
    } else {
      setShowJumpToLatest(true);
    }
  }, [isPinnedToBottom, live, live?.body, scrollToBottom, updatePinnedState]);

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

  function withAnsweredCard(message: ChatMessage): ChatMessage {
    const card = isAgentInteractionCard(message.content.interaction_card)
      ? message.content.interaction_card
      : null;
    if (!card || card.answered || !answeredCards[card.id]) return message;
    return {
      ...message,
      content: {
        ...message.content,
        interaction_card: {
          ...card,
          answered: answeredCards[card.id],
        },
      },
    };
  }

  function submitInteractionCard(input: InteractionCardSubmit) {
    setAnsweredCards((current) => ({
      ...current,
      [input.card.id]: { value: input.value, label: input.label },
    }));
    onInteractionCardSubmit?.(input);
  }

  return (
    <div className="relative min-h-0 flex-1 bg-background/35">
      {showEmptyState ? (
        <div className="flex h-full flex-col">{emptyState}</div>
      ) : (
        <div
          ref={scrollAreaRef}
          data-testid="conversation-scroll"
          onScroll={handleScroll}
          className="app-scrollbar-thin flex h-full flex-col gap-4 overflow-auto p-3"
        >
          {messages.map((m) => (
            <MessageBubbleLoader
              key={m.id}
              msg={withAnsweredCard(m)}
              onRegenerate={() => {
                // Plan 11A wires regenerate; Phase 4 leaves it as a no-op so the
                // action button doesn't disappear and reflow the row mid-thread.
              }}
              onSaveSuggestion={(payload) => onSaveSuggestion?.(payload)}
              onFeedback={onFeedback}
              onInteractionCardSubmit={submitInteractionCard}
            />
          ))}
          {visiblePendingUser ? (
            <MessageBubbleLoader
              key={visiblePendingUser.id}
              msg={visiblePendingUser}
              onRegenerate={() => {}}
              onSaveSuggestion={(payload) => onSaveSuggestion?.(payload)}
              onFeedback={onFeedback}
              onInteractionCardSubmit={submitInteractionCard}
            />
          ) : null}
          {live ? (
            <div className="flex flex-col gap-2">
              {live.thought ? <ThoughtBubble {...live.thought} /> : null}
              {live.status?.phrase ? (
                <StatusLine phrase={live.status.phrase} />
              ) : !live.body ? (
                <StatusLine phrase={t("streaming_preparing")} />
              ) : null}
              {live.body ? (
                <div className="rounded-[var(--radius-card)] border border-border/60 bg-background/80 px-3 py-2 shadow-sm">
                  <ChatMessageRendererLoader body={liveBody} streaming compact />
                  <span
                    aria-hidden
                    className="mt-1 inline-block h-2 w-2 animate-pulse rounded-full bg-foreground/45"
                  />
                </div>
              ) : null}
              {liveCitations.length > 0 ? (
                <CitationChips citations={liveCitations} />
              ) : null}
              {liveSaveSuggestion ? (
                <SaveSuggestionCard
                  title={liveSaveSuggestion.title}
                  onSave={() => onSaveSuggestion?.(live?.save_suggestion)}
                  onDismiss={() => {}}
                />
              ) : null}
              {liveError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {t("error_prefix", { message: liveError })}
                </div>
              ) : null}
              {live.agent_files.length > 0 ||
              live.project_objects.length > 0 ? (
                <AgentFileCards
                  files={asAgentFileCards(
                    live.agent_files,
                    live.project_objects,
                  )}
                />
              ) : null}
              {live.project_object_generations.length > 0 ? (
                <DocumentGenerationCards
                  items={asDocumentGenerationCards(
                    live.project_object_generations,
                  )}
                />
              ) : null}
              {liveAgentActions.length > 0 ? (
                <AgentActionCards actions={liveAgentActions} />
              ) : null}
            </div>
          ) : null}
          {workflowCard ? (
            <div className="rounded-[var(--radius-card)] border border-border/60 bg-background/80 px-2 py-2 shadow-sm">
              {workflowCard}
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      )}
      {showJumpToLatest ? (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-md transition hover:bg-muted"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          {live ? t("jump_to_stream") : t("jump_to_latest")}
        </button>
      ) : null}
    </div>
  );
}
