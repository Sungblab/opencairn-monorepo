"use client";

import dynamic from "next/dynamic";
import type { Tab } from "@/stores/tabs-store";

const LazyTabModeRouter = dynamic<{ tab: Tab }>(
  () => import("./tab-mode-router").then((mod) => mod.TabModeRouter),
  {
    ssr: false,
    loading: () => <RoutedViewerSkeleton />,
  },
);

export function TabModeRouterLoader({ tab }: { tab: Tab }) {
  return <LazyTabModeRouter tab={tab} />;
}

function RoutedViewerSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="h-6 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-10 animate-pulse rounded-[var(--radius-control)] bg-muted/80" />
      <div className="min-h-0 flex-1 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </div>
  );
}
