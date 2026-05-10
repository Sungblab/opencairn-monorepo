"use client";

import dynamic from "next/dynamic";

export type ChatMessageRendererLoaderProps = {
  body: string;
  streaming?: boolean;
};

const LazyChatMessageRenderer = dynamic<ChatMessageRendererLoaderProps>(
  () =>
    import("./chat-message-renderer").then((mod) => mod.ChatMessageRenderer),
  { ssr: false, loading: () => <ChatMessageRendererSkeleton /> },
);

export function ChatMessageRendererLoader(
  props: ChatMessageRendererLoaderProps,
) {
  return <LazyChatMessageRenderer {...props} />;
}

function ChatMessageRendererSkeleton() {
  return (
    <div
      aria-hidden
      className="h-10 animate-pulse rounded-[var(--radius-card)] bg-muted/60"
    />
  );
}
