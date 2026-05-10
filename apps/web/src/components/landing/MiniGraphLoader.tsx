"use client";

import dynamic from "next/dynamic";
import type { MiniGraphCopy } from "./MiniGraph";

const MiniGraph = dynamic<{ copy: MiniGraphCopy }>(
  () => import("./MiniGraph").then((mod) => mod.MiniGraph),
  {
    loading: () => <MiniGraphFallback />,
  },
);

export function MiniGraphLoader({ copy }: { copy: MiniGraphCopy }) {
  return <MiniGraph copy={copy} />;
}

function MiniGraphFallback() {
  return (
    <section id="try" aria-hidden className="border-b border-stone-900 py-24 md:py-32">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-6 lg:px-10">
        <div className="h-20 max-w-[560px] animate-pulse rounded-[var(--radius-card)] bg-stone-200/80" />
        <div className="grid gap-8 md:grid-cols-12">
          <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-stone-200/70 md:col-span-4" />
          <div className="h-80 animate-pulse rounded-[var(--radius-card)] bg-stone-200/70 md:col-span-8" />
        </div>
      </div>
    </section>
  );
}
