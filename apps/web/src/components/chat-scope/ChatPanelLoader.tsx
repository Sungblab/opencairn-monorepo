"use client";

import dynamic from "next/dynamic";

const LazyChatPanel = dynamic(
  () => import("./ChatPanel").then((mod) => mod.ChatPanel),
  {
    ssr: false,
    loading: () => <ChatPanelSkeleton />,
  },
);

export function ChatPanelLoader() {
  return <LazyChatPanel />;
}

export function ChatPanelSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="flex h-full min-h-0 flex-col gap-4 p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-5 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted" />
          <div className="h-3 w-64 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
        </div>
        <div className="h-8 w-28 animate-pulse rounded-[var(--radius-control)] bg-muted/80" />
      </div>
      <div className="min-h-0 flex-1 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-muted/80" />
    </section>
  );
}
