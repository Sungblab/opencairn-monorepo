"use client";

import dynamic from "next/dynamic";

type ProjectViewProps = {
  wsSlug: string;
  projectId: string;
};

const LazyProjectView = dynamic<ProjectViewProps>(
  () => import("./project-view").then((mod) => mod.ProjectView),
  {
    ssr: false,
    loading: () => <ProjectViewSkeleton />,
  },
);

export function ProjectViewLoader(props: ProjectViewProps) {
  return <LazyProjectView {...props} />;
}

function ProjectViewSkeleton() {
  return (
    <div
      data-testid="route-project-skeleton"
      aria-hidden
      className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
    >
      <div className="space-y-2">
        <div className="h-8 w-64 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="h-4 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      </div>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-[var(--radius-card)] bg-muted/60"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-muted/50" />
    </div>
  );
}
