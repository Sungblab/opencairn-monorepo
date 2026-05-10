"use client";

import dynamic from "next/dynamic";
import type { ScoreEntry } from "./ScoresDashboard";

export type ScoresDashboardLoaderProps = {
  scores: ScoreEntry[];
};

const LazyScoresDashboard = dynamic<ScoresDashboardLoaderProps>(
  () => import("./ScoresDashboard").then((mod) => mod.ScoresDashboard),
  {
    ssr: false,
    loading: () => <ScoresDashboardSkeleton />,
  },
);

export function ScoresDashboardLoader(props: ScoresDashboardLoaderProps) {
  return <LazyScoresDashboard {...props} />;
}

function ScoresDashboardSkeleton() {
  return (
    <div aria-hidden className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-[var(--radius-card)] bg-muted/60"
        />
      ))}
    </div>
  );
}
