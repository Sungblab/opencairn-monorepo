"use client";

import dynamic from "next/dynamic";

const LazyAdminUsersClient = dynamic(
  () => import("./AdminUsersClient").then((mod) => mod.AdminUsersClient),
  {
    ssr: false,
    loading: () => <AdminUsersClientSkeleton />,
  },
);

export function AdminUsersClientLoader({
  returnHref,
  hostedService,
}: {
  returnHref: string;
  hostedService: boolean;
}) {
  return (
    <LazyAdminUsersClient
      returnHref={returnHref}
      hostedService={hostedService}
    />
  );
}

function AdminUsersClientSkeleton() {
  return (
    <section aria-hidden className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-[var(--radius-card)] border border-border bg-muted/50"
          />
        ))}
      </div>
      <div className="h-12 animate-pulse rounded-[var(--radius-control)] bg-muted/60" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-14 animate-pulse rounded-[var(--radius-control)] bg-muted/40"
          />
        ))}
      </div>
    </section>
  );
}
