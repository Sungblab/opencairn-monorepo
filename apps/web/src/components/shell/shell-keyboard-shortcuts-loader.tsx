"use client";

import { lazy, Suspense } from "react";
import { useIdleReady } from "@/lib/performance/use-idle-ready";

const LazyShellKeyboardShortcuts = lazy(() =>
  import("./shell-keyboard-shortcuts").then((mod) => ({
    default: mod.ShellKeyboardShortcuts,
  })),
);

export function ShellKeyboardShortcutsLoader() {
  const ready = useIdleReady({ timeout: 1500, fallbackMs: 750 });

  return ready ? (
    <Suspense fallback={null}>
      <LazyShellKeyboardShortcuts />
    </Suspense>
  ) : null;
}
