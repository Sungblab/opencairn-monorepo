"use client";
import { Columns2, Rows2, Shuffle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { WorkflowConsoleRuns } from "@/components/agent-panel/workflow-console-runs";
import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";
import { usePanelStore, type BottomDockTab } from "@/stores/panel-store";
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
export function TabShell({
  children,
  leadingControls,
  trailingControls,
}: {
  children: React.ReactNode;
  leadingControls?: React.ReactNode;
  trailingControls?: React.ReactNode;
}) {
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
      <TabBar
        leadingControls={leadingControls}
        trailingControls={trailingControls}
      />
      <div className="app-scrollbar-thin flex min-h-0 flex-1 overflow-hidden">
        {split && primary && secondary ? (
          <SplitWorkspace
            primary={primary}
            secondary={secondary}
            orientation={split.orientation}
            ratio={split.ratio}
          >
            {children}
          </SplitWorkspace>
        ) : active && isRoutedByTabModeRouter(active) ? (
          <div className="h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden">
            <TabModeRouterLoader tab={active} />
          </div>
        ) : (
          <div className="app-scrollbar-thin min-w-0 w-full flex-1 overflow-auto">
            {children}
          </div>
        )}
      </div>
      <WorkspaceBottomDock />
    </main>
  );
}

function WorkspaceBottomDock() {
  const t = useTranslations("appShell.bottomDock");
  const { projectId: routeProjectId } = useCurrentProjectContext();
  const tabProjectId = useTabsStore(
    (s) => s.tabs.find((tab) => tab.kind === "project")?.targetId ?? null,
  );
  const projectId = routeProjectId ?? tabProjectId;
  const bottomDockOpen = usePanelStore((s) => s.bottomDockOpen);
  const bottomDockHeight = usePanelStore((s) => s.bottomDockHeight);
  const bottomDockTab = usePanelStore((s) => s.bottomDockTab);
  const setBottomDockOpen = usePanelStore((s) => s.setBottomDockOpen);
  const setBottomDockTab = usePanelStore((s) => s.setBottomDockTab);
  if (!bottomDockOpen) return null;

  return (
    <section
      data-testid="workspace-bottom-dock"
      className="min-h-0 shrink-0 border-t border-border bg-background"
      style={{ height: bottomDockHeight }}
      aria-label={t("title")}
    >
      <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-2">
        <div className="flex min-w-0 items-center gap-1">
          {(["activity", "logs"] satisfies BottomDockTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={bottomDockTab === tab}
              className={`inline-flex h-7 items-center rounded-[var(--radius-control)] px-2 text-xs ${
                bottomDockTab === tab
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
              onClick={() => setBottomDockTab(tab)}
            >
              {t(`tabs.${tab}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={t("close")}
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setBottomDockOpen(false)}
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="app-scrollbar-thin h-[calc(100%-2.25rem)] min-h-0 overflow-y-auto">
        {bottomDockTab === "activity" ? (
          <WorkflowConsoleRuns projectId={projectId} />
        ) : null}
        {bottomDockTab === "logs" ? (
          <div className="px-3 py-3 text-sm">
            <p className="font-medium text-foreground">{t("logsEmpty.title")}</p>
            <p className="mt-1 text-muted-foreground">{t("logsEmpty.body")}</p>
          </div>
        ) : null}
        {!projectId ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            {t("noProject")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SplitWorkspace({
  primary,
  secondary,
  orientation,
  ratio,
  children,
}: {
  primary: Tab;
  secondary: Tab;
  orientation: "vertical" | "horizontal";
  ratio: number;
  children: React.ReactNode;
}) {
  const routeChildrenPane: SplitPane | null = !isRoutedByTabModeRouter(primary)
    ? "primary"
    : !isRoutedByTabModeRouter(secondary)
      ? "secondary"
      : null;

  return (
    <div
      data-orientation={orientation}
      className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <SplitLayoutToolbar orientation={orientation} />
      <div
        className={`min-h-0 w-full flex-1 overflow-hidden ${
          orientation === "horizontal" ? "flex flex-col" : "flex"
        }`}
      >
        <SplitPaneView
          pane="primary"
          tab={primary}
          basis={`${ratio * 100}%`}
          orientation={orientation}
          routeChildrenPane={routeChildrenPane}
        >
          {children}
        </SplitPaneView>
        <div
          className={`shrink-0 bg-border ${
            orientation === "horizontal" ? "h-px w-full" : "w-px"
          }`}
          aria-hidden
        />
        <SplitPaneView
          pane="secondary"
          tab={secondary}
          basis={`${(1 - ratio) * 100}%`}
          orientation={orientation}
          routeChildrenPane={routeChildrenPane}
        >
          {children}
        </SplitPaneView>
      </div>
    </div>
  );
}

function SplitLayoutToolbar({
  orientation,
}: {
  orientation: "vertical" | "horizontal";
}) {
  const t = useTranslations("appShell.tabs.layout");
  const setSplitOrientation = useTabsStore((s) => s.setSplitOrientation);
  const swapSplitPanes = useTabsStore((s) => s.swapSplitPanes);
  const unsplit = useTabsStore((s) => s.unsplit);
  return (
    <div
      data-testid="split-layout-toolbar"
      className="flex h-9 shrink-0 items-center justify-between border-b bg-background px-2"
    >
      <span className="truncate text-xs font-medium text-muted-foreground">
        {t("title")}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={orientation === "vertical"}
          aria-label={t("vertical")}
          title={t("vertical")}
          data-testid="split-layout-vertical"
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
          onClick={() => setSplitOrientation("vertical")}
        >
          <Columns2 aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-pressed={orientation === "horizontal"}
          aria-label={t("horizontal")}
          title={t("horizontal")}
          data-testid="split-layout-horizontal"
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
          onClick={() => setSplitOrientation("horizontal")}
        >
          <Rows2 aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={t("swap")}
          title={t("swap")}
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={swapSplitPanes}
        >
          <Shuffle aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={t("unsplit")}
          title={t("unsplit")}
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => unsplit()}
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SplitPaneView({
  pane,
  tab,
  basis,
  orientation,
  routeChildrenPane,
  children,
}: {
  pane: SplitPane;
  tab: Tab;
  basis: string;
  orientation: "vertical" | "horizontal";
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
      className={`h-full min-h-0 min-w-0 overflow-auto ${
        isActivePane ? "bg-background" : "bg-muted/10"
      }`}
      style={
        orientation === "horizontal"
          ? { height: basis, flexShrink: 0 }
          : { width: basis, flexShrink: 0 }
      }
    >
      {isRouteBacked ? (
        routeChildrenPane === pane ? (
          <div className="h-full min-h-0 min-w-0 w-full overflow-hidden">
            {children}
          </div>
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
