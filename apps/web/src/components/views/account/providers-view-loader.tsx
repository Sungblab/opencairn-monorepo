"use client";

import dynamic from "next/dynamic";

const LazyProvidersView = dynamic(
  () =>
    import("./providers-view-runtime").then((mod) => mod.ProvidersViewRuntime),
  {
    ssr: false,
    loading: () => <AccountViewSkeleton />,
  },
);

export function ProvidersViewLoader() {
  return <LazyProvidersView />;
}

function AccountViewSkeleton() {
  return (
    <section aria-hidden className="grid max-w-3xl gap-4">
      <div className="h-7 w-48 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-56 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </section>
  );
}
