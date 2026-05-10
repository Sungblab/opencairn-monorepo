"use client";

import dynamic from "next/dynamic";
import type { NoteRouteClientProps } from "./NoteRouteClient";

const LazyNoteRouteClient = dynamic<NoteRouteClientProps>(
  () => import("./NoteRouteClient").then((mod) => mod.NoteRouteClient),
  {
    ssr: false,
    loading: () => <NoteRouteClientSkeleton />,
  },
);

export function NoteRouteClientLoader(props: NoteRouteClientProps) {
  return <LazyNoteRouteClient {...props} />;
}

function NoteRouteClientSkeleton() {
  return (
    <div aria-hidden className="flex min-h-full min-w-0 flex-1 flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="h-4 w-52 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        <div className="mt-2 h-7 w-80 max-w-full animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      </div>
      <div className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-6 py-7">
        <div className="h-9 w-2/3 animate-pulse rounded-[var(--radius-control)] bg-muted" />
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="h-5 animate-pulse rounded-[var(--radius-control)] bg-muted/50"
          />
        ))}
      </div>
    </div>
  );
}
