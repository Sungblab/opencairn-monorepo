"use client";

import dynamic from "next/dynamic";

const LazyNotionTab = dynamic<{ wsSlug: string }>(
  () => import("./NotionTab").then((mod) => mod.NotionTab),
  {
    ssr: false,
    loading: () => <LegacyImportTabSkeleton />,
  },
);

export function NotionTabLoader({ wsSlug }: { wsSlug: string }) {
  return <LazyNotionTab wsSlug={wsSlug} />;
}

function LegacyImportTabSkeleton() {
  return (
    <div aria-hidden className="space-y-4">
      <div className="h-4 w-64 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-10 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      <div className="h-24 animate-pulse rounded-[var(--radius-control)] bg-muted/50" />
    </div>
  );
}
