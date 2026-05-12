"use client";
import { useTabsStore, type SplitPane, type Tab } from "@/stores/tabs-store";
import { TabBar } from "./tab-bar";
import { TabModeRouterLoader } from "./tab-mode-router-loader";
import { isRoutedByTabModeRouter } from "./tab-mode-routing";

// Phase 3-B: the body branch. If there's an active tab whose mode is NOT
// `plate`, load TabModeRouter — which dispatches to the per-mode viewer.
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
  const split = useTabsStore((s) => s.split);
  const primary = useTabsStore((s) =>
    s.split ? s.tabs.find((t) => t.id === s.split?.primaryTabId) : undefined,
  );
  const secondary = useTabsStore((s) =>
    s.split ? s.tabs.find((t) => t.id === s.split?.secondaryTabId) : undefined,
  );

  return (
    <main
      data-testid="app-shell-main"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <TabBar />
      <div className="app-scrollbar-thin flex min-h-0 flex-1 overflow-auto">
        {split && primary && secondary ? (
          <SplitWorkspace
            primary={primary}
            secondary={secondary}
            ratio={split.ratio}
          >
            {children}
          </SplitWorkspace>
        ) : active && isRoutedByTabModeRouter(active) ? (
          <div className="min-w-0 flex-1 w-full">
            <TabModeRouterLoader tab={active} />
          </div>
        ) : (
          <div className="min-w-0 flex-1 w-full">{children}</div>
        )}
      </div>
    </main>
  );
}

function SplitWorkspace({
  primary,
  secondary,
  ratio,
  children,
}: {
  primary: Tab;
  secondary: Tab;
  ratio: number;
  children: React.ReactNode;
}) {
  const routeChildrenPane: SplitPane | null = !isRoutedByTabModeRouter(primary)
    ? "primary"
    : !isRoutedByTabModeRouter(secondary)
      ? "secondary"
      : null;

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      <SplitPaneView
        pane="primary"
        tab={primary}
        width={`${ratio * 100}%`}
        routeChildrenPane={routeChildrenPane}
      >
        {children}
      </SplitPaneView>
      <div className="w-px shrink-0 bg-border" aria-hidden />
      <SplitPaneView
        pane="secondary"
        tab={secondary}
        width={`${(1 - ratio) * 100}%`}
        routeChildrenPane={routeChildrenPane}
      >
        {children}
      </SplitPaneView>
    </div>
  );
}

function SplitPaneView({
  pane,
  tab,
  width,
  routeChildrenPane,
  children,
}: {
  pane: SplitPane;
  tab: Tab;
  width: string;
  routeChildrenPane: SplitPane | null;
  children: React.ReactNode;
}) {
  const activePane = useTabsStore((s) => s.activePane);
  const setActivePane = useTabsStore((s) => s.setActivePane);
  const isRouteBacked = !isRoutedByTabModeRouter(tab);
  const isActivePane = activePane === pane;

  return (
    <section
      data-testid={`split-pane-${pane}`}
      aria-current={isActivePane ? "true" : undefined}
      onClick={() => setActivePane(pane)}
      className={`min-w-0 overflow-auto ${
        isActivePane ? "bg-background" : "bg-muted/10"
      }`}
      style={{ width, flexShrink: 0 }}
    >
      {isRouteBacked ? (
        routeChildrenPane === pane ? (
          <div className="min-w-0 w-full">{children}</div>
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {tab.title}
          </div>
        )
      ) : (
        <TabModeRouterLoader tab={tab} />
      )}
    </section>
  );
}
