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
  // Single selector so TabShell only re-renders when the active tab's object
  // reference changes. Two separate selectors + external `.find()` would
  // subscribe to the whole `tabs` array and re-render on ANY tab update
  // (dirty flag, scrollY persistence, neighbor closeTab). `updateTab` only
  // replaces the one targeted tab's object, so unrelated updates keep the
  // active tab's reference stable and this selector returns the same value.
  const active = useTabsStore((s) =>
    s.tabs.find((t) => t.id === s.activeId),
  );

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
