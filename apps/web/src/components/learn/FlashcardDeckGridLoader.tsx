"use client";

import dynamic from "next/dynamic";
import type { FlashcardDeckGridProps } from "./FlashcardDeckGrid";

const LazyFlashcardDeckGrid = dynamic<FlashcardDeckGridProps>(
  () => import("./FlashcardDeckGrid").then((mod) => mod.FlashcardDeckGrid),
  {
    ssr: false,
    loading: () => <FlashcardDeckGridSkeleton />,
  },
);

export function FlashcardDeckGridLoader(props: FlashcardDeckGridProps) {
  return <LazyFlashcardDeckGrid {...props} />;
}

function FlashcardDeckGridSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-[var(--radius-card)] bg-muted/60"
        />
      ))}
    </div>
  );
}
