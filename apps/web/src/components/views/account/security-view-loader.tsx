"use client";

import dynamic from "next/dynamic";

const LazySecurityView = dynamic(
  () => import("./security-view").then((mod) => mod.SecurityView),
  {
    ssr: false,
    loading: () => <AccountViewSkeleton />,
  },
);

export function SecurityViewLoader() {
  return <LazySecurityView />;
}

function AccountViewSkeleton() {
  return (
    <section aria-hidden className="grid max-w-2xl gap-4">
      <div className="h-7 w-44 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </section>
  );
}
