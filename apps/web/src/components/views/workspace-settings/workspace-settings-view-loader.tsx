"use client";

import dynamic from "next/dynamic";
import type { WorkspaceSettingsViewProps } from "./workspace-settings-view";

const LazyWorkspaceSettingsView = dynamic<WorkspaceSettingsViewProps>(
  () =>
    import("./workspace-settings-view").then(
      (mod) => mod.WorkspaceSettingsView,
    ),
  {
    ssr: false,
    loading: () => <WorkspaceSettingsViewSkeleton />,
  },
);

export function WorkspaceSettingsViewLoader(props: WorkspaceSettingsViewProps) {
  return <LazyWorkspaceSettingsView {...props} />;
}

export function WorkspaceSettingsViewSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-full min-w-0 flex-col bg-background md:flex-row"
    >
      <aside className="w-full shrink-0 border-b border-border bg-background p-4 md:w-60 md:border-b-0 md:border-r">
        <div className="mb-3 h-3 w-28 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="flex flex-row gap-3 overflow-x-auto pb-1 md:flex-col md:gap-4 md:overflow-x-visible md:pb-0">
          {Array.from({ length: 4 }).map((_, groupIndex) => (
            <section key={groupIndex} className="shrink-0 space-y-2 md:shrink">
              <div className="h-3 w-20 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
              {Array.from({ length: groupIndex === 2 ? 5 : 2 }).map(
                (_, itemIndex) => (
                  <div
                    key={itemIndex}
                    className="h-7 w-32 animate-pulse rounded-[var(--radius-control)] bg-muted/50"
                  />
                ),
              )}
            </section>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      </main>
    </div>
  );
}
