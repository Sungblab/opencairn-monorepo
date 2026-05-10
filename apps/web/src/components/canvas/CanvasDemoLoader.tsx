"use client";

import dynamic from "next/dynamic";
import type { DemoLang } from "./CanvasDemoClient";

const LazyCanvasDemoClient = dynamic<{ initialLang: DemoLang }>(
  () => import("./CanvasDemoClient").then((mod) => mod.CanvasDemoClient),
  {
    ssr: false,
    loading: () => <CanvasDemoSkeleton />,
  },
);

export function CanvasDemoLoader({ initialLang }: { initialLang: DemoLang }) {
  return <LazyCanvasDemoClient initialLang={initialLang} />;
}

function CanvasDemoSkeleton() {
  return (
    <div aria-hidden className="flex h-screen flex-col">
      <div className="h-14 border-b p-3">
        <div className="h-6 w-44 animate-pulse rounded-[var(--radius-control)] bg-muted" />
      </div>
      <div className="h-12 border-b p-2">
        <div className="h-8 w-64 animate-pulse rounded-[var(--radius-control)] bg-muted/70" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-0">
        <div className="animate-pulse border-r bg-muted/40" />
        <div className="animate-pulse bg-muted/30" />
      </div>
    </div>
  );
}
