"use client";

import dynamic from "next/dynamic";
import type { ProjectGraphProps } from "./ProjectGraph";

const LazyProjectGraph = dynamic<ProjectGraphProps>(
  () => import("./ProjectGraph").then((mod) => mod.ProjectGraph),
  {
    ssr: false,
    loading: () => <ProjectGraphSkeleton />,
  },
);

export function ProjectGraphLoader(props: ProjectGraphProps) {
  return <LazyProjectGraph {...props} />;
}

export function ProjectGraphSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full min-h-0 flex-col gap-3 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="h-9 w-72 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="h-9 w-32 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      </div>
      <div className="min-h-0 flex-1 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </div>
  );
}
