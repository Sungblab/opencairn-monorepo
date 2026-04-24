"use client";
import { useTabsStore } from "@/stores/tabs-store";
import { TabBar } from "./tab-bar";
import { TabModeRouter, isRoutedByTabModeRouter } from "./tab-mode-router";

// Phase 3-B: the body branch. If there's an active tab whose mode is NOT
// `plate`, render TabModeRouter — which dispatches to the per-mode viewer.
// Otherwise fall back to Next.js route `children` (the SSR-rendered page
// that already handles auth + NoteEditor fan-out). `plate` stays on the
// children path deliberately: migrating the editor into a client-only
// router would lose server-side auth + meta fetching.
export function TabShell({ children }: { children: React.ReactNode }) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId);

  return (
    <main
      data-testid="app-shell-main"
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <TabBar />
      <div className="flex min-h-0 flex-1 overflow-auto">
        {active && isRoutedByTabModeRouter(active) ? (
          <TabModeRouter tab={active} />
        ) : (
          children
        )}
      </div>
    </main>
  );
}
