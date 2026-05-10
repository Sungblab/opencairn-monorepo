"use client";

import dynamic from "next/dynamic";

const LazyDriveTab = dynamic<{ wsSlug: string }>(
  () => import("./DriveTab").then((mod) => mod.DriveTab),
  {
    ssr: false,
    loading: () => <LegacyImportTabSkeleton />,
  },
);

export function DriveTabLoader({ wsSlug }: { wsSlug: string }) {
  return <LazyDriveTab wsSlug={wsSlug} />;
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
