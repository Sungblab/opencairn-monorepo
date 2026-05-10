"use client";

import dynamic from "next/dynamic";

type BacklinksPanelLoaderProps = {
  noteId: string;
};

const LazyBacklinksPanel = dynamic<BacklinksPanelLoaderProps>(
  () => import("./BacklinksPanel").then((mod) => mod.BacklinksPanel),
  {
    ssr: false,
    loading: () => <SidePanelSkeleton />,
  },
);

export function BacklinksPanelLoader(props: BacklinksPanelLoaderProps) {
  return <LazyBacklinksPanel {...props} />;
}

function SidePanelSkeleton() {
  return (
    <aside
      aria-hidden
      className="flex h-full w-72 flex-col gap-3 border-l border-border bg-background p-3"
    >
      <div className="h-5 w-28 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="h-8 animate-pulse rounded-[var(--radius-control)] bg-muted/60"
        />
      ))}
    </aside>
  );
}
