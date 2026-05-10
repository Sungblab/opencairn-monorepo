"use client";

import dynamic from "next/dynamic";
import { useIdleReady } from "@/lib/performance/use-idle-ready";

const AgentPanel = dynamic<{ wsSlug?: string }>(
  () => import("./agent-panel").then((mod) => mod.AgentPanel),
  {
    ssr: false,
    loading: () => <AgentPanelSkeleton />,
  },
);

export function LazyAgentPanel({ wsSlug }: { wsSlug?: string }) {
  const ready = useIdleReady({ timeout: 1500, fallbackMs: 750 });

  return ready ? <AgentPanel wsSlug={wsSlug} /> : <AgentPanelSkeleton />;
}

function AgentPanelSkeleton() {
  return (
    <div
      aria-hidden
      className="flex h-full flex-col gap-3 border-l border-border bg-background p-3"
    >
      <div className="h-7 w-28 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-9 animate-pulse rounded-[var(--radius-control)] bg-muted/80" />
      <div className="flex-1 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </div>
  );
}
