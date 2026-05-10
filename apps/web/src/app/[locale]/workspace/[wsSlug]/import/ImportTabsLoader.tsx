"use client";

import dynamic from "next/dynamic";

const LazyImportTabs = dynamic<{ wsSlug: string }>(
  () => import("./ImportTabs").then((mod) => mod.ImportTabs),
  {
    ssr: false,
    loading: () => <ImportTabsSkeleton />,
  },
);

export function ImportTabsLoader({ wsSlug }: { wsSlug: string }) {
  return <LazyImportTabs wsSlug={wsSlug} />;
}

function ImportTabsSkeleton() {
  return (
    <div aria-hidden className="mt-6">
      <div className="flex gap-2 border-b border-border">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-10 w-20 animate-pulse rounded-t bg-muted"
          />
        ))}
      </div>
      <div className="mt-6 space-y-4 rounded-[var(--radius-card)] border border-border p-5">
        <div className="h-5 w-48 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="h-10 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
        <div className="h-24 animate-pulse rounded-[var(--radius-control)] bg-muted/50" />
      </div>
    </div>
  );
}
