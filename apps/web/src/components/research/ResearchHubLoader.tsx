"use client";

import dynamic from "next/dynamic";
import type { ResearchHubProps } from "./ResearchHub";

const LazyResearchHub = dynamic<ResearchHubProps>(
  () => import("./ResearchHub").then((mod) => mod.ResearchHub),
  {
    ssr: false,
    loading: () => <ResearchHubSkeleton />,
  },
);

export function ResearchHubLoader(props: ResearchHubProps) {
  return <LazyResearchHub {...props} />;
}

function ResearchHubSkeleton() {
  return (
    <div aria-hidden className="space-y-5 p-6">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-8 w-24 animate-pulse rounded-[var(--radius-control)] bg-muted/60"
          />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-[var(--radius-card)] border border-border bg-muted/40"
          />
        ))}
      </div>
    </div>
  );
}
