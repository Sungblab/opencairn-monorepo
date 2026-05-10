"use client";

import dynamic from "next/dynamic";

type ByokKeyCardLoaderProps = {
  withProviders?: boolean;
};

const LazyByokKeyCard = dynamic(
  () => import("./ByokKeyCard").then((mod) => mod.ByokKeyCard),
  {
    ssr: false,
    loading: () => <ByokKeyCardSkeleton />,
  },
);

const LazyByokKeyCardRuntime = dynamic(
  () => import("./ByokKeyCardRuntime").then((mod) => mod.ByokKeyCardRuntime),
  {
    ssr: false,
    loading: () => <ByokKeyCardSkeleton />,
  },
);

export function ByokKeyCardLoader({
  withProviders = false,
}: ByokKeyCardLoaderProps) {
  return withProviders ? <LazyByokKeyCardRuntime /> : <LazyByokKeyCard />;
}

function ByokKeyCardSkeleton() {
  return (
    <section
      aria-hidden
      className="rounded-lg border border-border p-6"
    >
      <div className="h-5 w-40 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="mt-3 h-4 w-72 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      <div className="mt-5 h-10 animate-pulse rounded-[var(--radius-control)] bg-muted/60" />
    </section>
  );
}
