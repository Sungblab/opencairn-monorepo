"use client";

import dynamic from "next/dynamic";

import type { ChatMessage } from "@/lib/api-client";
import type { InteractionCardSubmit } from "./interaction-card";

export type MessageBubbleLoaderProps = {
  msg: ChatMessage;
  onRegenerate: (msgId: string) => void;
  onSaveSuggestion: (payload: unknown) => void;
  onFeedback: (
    msgId: string,
    sentiment: "positive" | "negative",
    reason?: string,
  ) => void;
  onInteractionCardSubmit?: (input: InteractionCardSubmit) => void;
};

const LazyMessageBubble = dynamic<MessageBubbleLoaderProps>(
  () => import("./message-bubble").then((mod) => mod.MessageBubble),
  { ssr: false, loading: () => <MessageBubbleSkeleton /> },
);

export function MessageBubbleLoader(props: MessageBubbleLoaderProps) {
  return <LazyMessageBubble {...props} />;
}

function MessageBubbleSkeleton() {
  return (
    <div
      aria-hidden
      className="h-20 animate-pulse rounded-[var(--radius-card)] bg-muted/60"
    />
  );
}
