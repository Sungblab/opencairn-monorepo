"use client";

import dynamic from "next/dynamic";

const LazyProfileView = dynamic(
  () => import("./profile-view-runtime").then((mod) => mod.ProfileViewRuntime),
  {
    ssr: false,
    loading: () => <AccountViewSkeleton />,
  },
);

export function ProfileViewLoader() {
  return <LazyProfileView />;
}

function AccountViewSkeleton() {
  return (
    <section aria-hidden className="grid max-w-2xl gap-4">
      <div className="h-7 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-48 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </section>
  );
}
