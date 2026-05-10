"use client";

import dynamic from "next/dynamic";

const LazyBillingView = dynamic(
  () => import("./billing-view").then((mod) => mod.BillingView),
  {
    ssr: false,
    loading: () => <AccountViewSkeleton />,
  },
);

export function BillingViewLoader() {
  return <LazyBillingView />;
}

function AccountViewSkeleton() {
  return (
    <section aria-hidden className="grid max-w-2xl gap-4">
      <div className="h-7 w-36 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-52 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </section>
  );
}
