"use client";

import dynamic from "next/dynamic";
import { useIdleReady } from "@/lib/performance/use-idle-ready";
import type { ShellSidebarProps } from "./shell-sidebar";

const LazyShellSidebar = dynamic<ShellSidebarProps>(
  () => import("./shell-sidebar").then((mod) => mod.ShellSidebar),
  {
    ssr: false,
    loading: () => <ShellSidebarSkeleton />,
  },
);

export function ShellSidebarLoader(props: ShellSidebarProps) {
  const ready = useIdleReady({ timeout: 1200, fallbackMs: 400 });

  return ready ? <LazyShellSidebar {...props} /> : <ShellSidebarSkeleton />;
}

export function ShellSidebarSkeleton() {
  return (
    <aside
      data-testid="app-shell-sidebar-loading"
      className="flex h-full min-h-0 flex-col border-r border-border bg-background"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="h-8 w-8 rounded-[var(--radius-control)] bg-muted" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-2.5 w-16 rounded bg-muted/70" />
        </div>
      </div>
      <div className="border-b border-border px-3 py-2">
        <div className="h-8 rounded-[var(--radius-control)] bg-muted" />
        <div className="mt-2 flex items-center gap-1.5">
          <div className="h-8 flex-1 rounded-[var(--radius-control)] bg-muted/70" />
          <div className="h-8 w-8 rounded-[var(--radius-control)] bg-muted/70" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 px-3 py-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-8 rounded-[var(--radius-control)] bg-muted/60"
          />
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-2 px-3 py-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="h-7 rounded-[var(--radius-control)] bg-muted/50"
          />
        ))}
      </div>
      <div className="border-t border-border p-3">
        <div className="h-8 rounded-[var(--radius-control)] bg-muted/70" />
      </div>
    </aside>
  );
}
