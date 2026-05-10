"use client";

import dynamic from "next/dynamic";
import type { ResearchRunViewProps } from "./ResearchRunView";

const LazyResearchRunView = dynamic<ResearchRunViewProps>(
  () => import("./ResearchRunView").then((mod) => mod.ResearchRunView),
  {
    ssr: false,
    loading: () => <ResearchRunViewSkeleton />,
  },
);

export function ResearchRunViewLoader(props: ResearchRunViewProps) {
  return <LazyResearchRunView {...props} />;
}

function ResearchRunViewSkeleton() {
  return (
    <div aria-hidden className="space-y-5 p-6">
      <div className="h-5 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="space-y-3 rounded-[var(--radius-card)] border border-border p-5">
        <div className="h-6 w-64 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="h-24 animate-pulse rounded-[var(--radius-control)] bg-muted/50" />
      </div>
      <div className="h-40 animate-pulse rounded-[var(--radius-card)] border border-border bg-muted/40" />
    </div>
  );
}
