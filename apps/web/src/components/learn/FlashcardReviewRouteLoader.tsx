"use client";

import dynamic from "next/dynamic";
import type { FlashcardReviewRouteProps } from "./FlashcardReviewRoute";

const LazyFlashcardReviewRoute = dynamic<FlashcardReviewRouteProps>(
  () =>
    import("./FlashcardReviewRoute").then((mod) => mod.FlashcardReviewRoute),
  {
    ssr: false,
    loading: () => <FlashcardReviewRouteSkeleton />,
  },
);

export function FlashcardReviewRouteLoader(props: FlashcardReviewRouteProps) {
  return <LazyFlashcardReviewRoute {...props} />;
}

function FlashcardReviewRouteSkeleton() {
  return (
    <div aria-hidden className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-8">
      <div className="h-4 w-32 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      <div className="min-h-[220px] w-full animate-pulse rounded-[var(--radius-card)] bg-muted/60" />
      <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-10 animate-pulse rounded-[var(--radius-control)] bg-muted/70"
          />
        ))}
      </div>
    </div>
  );
}
