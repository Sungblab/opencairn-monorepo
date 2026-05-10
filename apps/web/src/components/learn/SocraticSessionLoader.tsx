"use client";

import dynamic from "next/dynamic";
import type { SocraticSessionProps } from "./SocraticSession";

const LazySocraticSession = dynamic<SocraticSessionProps>(
  () => import("./SocraticSession").then((mod) => mod.SocraticSession),
  {
    ssr: false,
    loading: () => <SocraticSessionSkeleton />,
  },
);

export function SocraticSessionLoader(props: SocraticSessionProps) {
  return <LazySocraticSession {...props} />;
}

function SocraticSessionSkeleton() {
  return (
    <div aria-hidden className="mx-auto grid max-w-3xl gap-5 p-6">
      <div className="h-8 w-56 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-28 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      <div className="h-48 animate-pulse rounded-[var(--radius-card)] bg-muted/50" />
    </div>
  );
}
