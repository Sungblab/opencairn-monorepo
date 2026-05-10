"use client";

import dynamic from "next/dynamic";

interface ProjectGraphRouteEntryProps {
  wsSlug: string;
  projectId: string;
}

const LazyProjectGraphRouteEntry = dynamic<ProjectGraphRouteEntryProps>(
  () =>
    import("./ProjectGraphRouteEntry").then(
      (mod) => mod.ProjectGraphRouteEntry,
    ),
  {
    ssr: false,
    loading: () => <ProjectGraphRouteEntrySkeleton />,
  },
);

export function ProjectGraphRouteEntryLoader(
  props: ProjectGraphRouteEntryProps,
) {
  return <LazyProjectGraphRouteEntry {...props} />;
}

function ProjectGraphRouteEntrySkeleton() {
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
