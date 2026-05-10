"use client";

import { lazy, Suspense } from "react";
import { TabShell } from "../tab-shell/tab-shell";
import type { CompactAppShellProps } from "./compact-app-shell";

const LazyCompactAppShell = lazy(() =>
  import("./compact-app-shell").then((mod) => ({
    default: mod.CompactAppShell,
  })),
);

export function CompactAppShellLoader(props: CompactAppShellProps) {
  return (
    <Suspense fallback={<CompactAppShellFallback {...props} />}>
      <LazyCompactAppShell {...props} />
    </Suspense>
  );
}

function CompactAppShellFallback({ children }: CompactAppShellProps) {
  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-background"
      data-testid="app-shell"
    >
      <TabShell>{children}</TabShell>
    </div>
  );
}
