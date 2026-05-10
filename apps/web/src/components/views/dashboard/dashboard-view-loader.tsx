"use client";

import dynamic from "next/dynamic";
import type { DashboardViewProps } from "./dashboard-view";

const LazyDashboardView = dynamic<DashboardViewProps>(
  () => import("./dashboard-view").then((mod) => mod.DashboardView),
  {
    ssr: false,
    loading: () => <DashboardViewSkeleton />,
  },
);

export function DashboardViewLoader(props: DashboardViewProps) {
  return <LazyDashboardView {...props} />;
}

function DashboardViewSkeleton() {
  return (
    <div
      aria-hidden
      className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6"
    >
      <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      <div className="h-28 animate-pulse rounded-[var(--radius-card)] bg-muted/50" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-[var(--radius-card)] bg-muted/60"
          />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-muted/50" />
        <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-muted/50" />
      </div>
    </div>
  );
}
