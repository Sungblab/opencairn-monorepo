"use client";

import dynamic from "next/dynamic";

const LazyNotificationsView = dynamic(
  () =>
    import("./notifications-view-runtime").then(
      (mod) => mod.NotificationsViewRuntime,
    ),
  {
    ssr: false,
    loading: () => <AccountViewSkeleton />,
  },
);

export function NotificationsViewLoader() {
  return <LazyNotificationsView />;
}

function AccountViewSkeleton() {
  return (
    <section aria-hidden className="grid max-w-2xl gap-4">
      <div className="h-7 w-52 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-56 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
    </section>
  );
}
