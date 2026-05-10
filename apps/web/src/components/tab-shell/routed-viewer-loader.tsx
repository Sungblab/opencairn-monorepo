"use client";

import dynamic from "next/dynamic";
import type { Tab } from "@/stores/tabs-store";

type TabViewerProps = { tab: Tab };

const loading = () => <RoutedViewerSkeleton />;

export const LazyReadingViewer = dynamic<TabViewerProps>(
  () => import("./viewers/reading-viewer").then((mod) => mod.ReadingViewer),
  { ssr: false, loading },
);

export const LazySourceViewer = dynamic<TabViewerProps>(
  () => import("./viewers/source-viewer").then((mod) => mod.SourceViewer),
  { ssr: false, loading },
);

export const LazyDataViewer = dynamic<TabViewerProps>(
  () => import("./viewers/data-viewer").then((mod) => mod.DataViewer),
  { ssr: false, loading },
);

export const LazyCanvasViewer = dynamic<TabViewerProps>(
  () => import("./viewers/canvas-viewer").then((mod) => mod.CanvasViewer),
  { ssr: false, loading },
);

export const LazyProjectGraphViewer = dynamic<TabViewerProps>(
  () =>
    import("./viewers/project-graph-viewer").then(
      (mod) => mod.ProjectGraphViewer,
    ),
  { ssr: false, loading },
);

export const LazyIngestViewer = dynamic<TabViewerProps>(
  () => import("./viewers/ingest-viewer").then((mod) => mod.IngestViewer),
  { ssr: false, loading },
);

export const LazyLitSearchViewer = dynamic<TabViewerProps>(
  () =>
    import("./viewers/lit-search-viewer").then((mod) => mod.LitSearchViewer),
  { ssr: false, loading },
);

export const LazyAgentFileViewer = dynamic<TabViewerProps>(
  () =>
    import("./viewers/agent-file-viewer").then((mod) => mod.AgentFileViewer),
  { ssr: false, loading },
);

export const LazyCodeWorkspaceViewer = dynamic<TabViewerProps>(
  () =>
    import("./viewers/code-workspace-viewer").then(
      (mod) => mod.CodeWorkspaceViewer,
    ),
  { ssr: false, loading },
);

function RoutedViewerSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="h-6 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-10 animate-pulse rounded-[var(--radius-control)] bg-muted/80" />
      <div className="min-h-0 flex-1 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </div>
  );
}
