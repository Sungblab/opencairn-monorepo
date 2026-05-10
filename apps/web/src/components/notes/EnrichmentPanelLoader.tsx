"use client";

import dynamic from "next/dynamic";

type EnrichmentPanelLoaderProps = {
  noteId: string;
};

const LazyEnrichmentPanel = dynamic<EnrichmentPanelLoaderProps>(
  () => import("./EnrichmentPanel").then((mod) => mod.EnrichmentPanel),
  {
    ssr: false,
    loading: () => <SidePanelSkeleton />,
  },
);

export function EnrichmentPanelLoader(props: EnrichmentPanelLoaderProps) {
  return <LazyEnrichmentPanel {...props} />;
}

function SidePanelSkeleton() {
  return (
    <aside
      aria-hidden
      className="flex h-full w-72 flex-col gap-3 border-l border-border bg-background p-3"
    >
      <div className="h-5 w-32 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-20 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      <div className="h-28 animate-pulse rounded-[var(--radius-card)] bg-muted/50" />
    </aside>
  );
}
