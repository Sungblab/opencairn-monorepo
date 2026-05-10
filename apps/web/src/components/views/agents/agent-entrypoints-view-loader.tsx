"use client";

import dynamic from "next/dynamic";
import type { AgentEntryPointsViewProps } from "./agent-entrypoints-view";

const LazyAgentEntryPointsView = dynamic<AgentEntryPointsViewProps>(
  () =>
    import("./agent-entrypoints-view").then(
      (mod) => mod.AgentEntryPointsView,
    ),
  {
    ssr: false,
    loading: () => <AgentEntryPointsViewSkeleton />,
  },
);

export function AgentEntryPointsViewLoader(props: AgentEntryPointsViewProps) {
  return <LazyAgentEntryPointsView {...props} />;
}

export function AgentEntryPointsViewSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full min-h-0 flex-col gap-6 p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 animate-pulse rounded-[var(--radius-control)] bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
        </div>
        <div className="h-9 w-24 animate-pulse rounded-[var(--radius-control)] bg-muted/80" />
      </div>
      <div className="grid gap-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-40 animate-pulse rounded-[var(--radius-card)] border border-border bg-muted/50"
          />
        ))}
      </div>
      <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      <div className="grid min-h-0 flex-1 gap-6 2xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="min-h-48 animate-pulse rounded-[var(--radius-card)] bg-muted/50"
          />
        ))}
      </div>
    </div>
  );
}
