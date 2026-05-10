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
      aria-hidden
      className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8"
    >
      <div className="space-y-2">
        <div className="h-8 w-64 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="h-4 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
