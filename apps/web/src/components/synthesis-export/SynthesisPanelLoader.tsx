"use client";

import dynamic from "next/dynamic";
import type { SynthesisPanelProps } from "./SynthesisPanel";

const LazySynthesisPanel = dynamic<SynthesisPanelProps>(
  () => import("./SynthesisPanel").then((mod) => mod.SynthesisPanel),
  {
    ssr: false,
    loading: () => <SynthesisPanelSkeleton />,
  },
);

export function SynthesisPanelLoader(props: SynthesisPanelProps) {
  return <LazySynthesisPanel {...props} />;
}

export function SynthesisPanelSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full min-h-0 flex-col gap-4 p-4"
    >
      <div className="h-7 w-48 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="h-20 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      <div className="h-36 animate-pulse rounded-[var(--radius-card)] bg-muted/50" />
      <div className="h-4 w-full animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      <div className="h-28 animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      <div className="h-9 w-28 animate-pulse rounded-[var(--radius-control)] bg-muted/80" />
    </div>
  );
}
