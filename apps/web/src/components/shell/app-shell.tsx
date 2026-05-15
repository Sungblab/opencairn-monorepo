"use client";
import { useEffect, useLayoutEffect } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { ShellSidebarLoader } from "@/components/sidebar/shell-sidebar-loader";
import { TabShell } from "../tab-shell/tab-shell";
import { LazyAgentPanel } from "@/components/agent-panel/agent-panel-loader";
import { ShellResizeHandle } from "./shell-resize-handle";
import { IngestOverlaysLoader } from "@/components/ingest/ingest-overlays-loader";
import { CompactAppShellLoader } from "./compact-app-shell-loader";
import { useShellLabels } from "@/components/shell/shell-labels";
import { usePanelStore } from "@/stores/panel-store";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { ProjectMainDropZone } from "./project-main-drop-zone";

const usePanelHydrationEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface AppShellProps {
  children: React.ReactNode;
  wsSlug: string;
  deepResearchEnabled: boolean;
  synthesisExportEnabled?: boolean;
}

// 3-panel desktop shell on `lg`, Sheet overlays everywhere else. The
// breakpoint switch is a hard branch rather than CSS media queries because
// the shell needs different state semantics in the two modes — overlays
// always start closed on viewport entry, inline columns stay where the
// panel-store left them.
export function AppShell({
  children,
  wsSlug,
  deepResearchEnabled,
  synthesisExportEnabled = false,
}: AppShellProps) {
  const bp = useBreakpoint();
  const { placeholders } = useShellLabels();
  const sidebarWidth = usePanelStore((s) => s.sidebarWidth);
  const sidebarOpen = usePanelStore((s) => s.sidebarOpen);
  const setSidebarOpen = usePanelStore((s) => s.setSidebarOpen);
  const compactSidebarOpen = usePanelStore((s) => s.compactSidebarOpen);
  const setCompactSidebarOpen = usePanelStore((s) => s.setCompactSidebarOpen);
  const agentPanelWidth = usePanelStore((s) => s.agentPanelWidth);
  const agentPanelOpen = usePanelStore((s) => s.agentPanelOpen);
  const setAgentPanelOpen = usePanelStore((s) => s.setAgentPanelOpen);
  const compactAgentPanelOpen = usePanelStore((s) => s.compactAgentPanelOpen);
  const setCompactAgentPanelOpen = usePanelStore(
    (s) => s.setCompactAgentPanelOpen,
  );
  const setSidebarWidth = usePanelStore((s) => s.setSidebarWidth);
  const resetSidebarWidth = usePanelStore((s) => s.resetSidebarWidth);
  const setAgentPanelWidth = usePanelStore((s) => s.setAgentPanelWidth);
  const resetAgentPanelWidth = usePanelStore((s) => s.resetAgentPanelWidth);
  const hydratePanelFromStorage = usePanelStore((s) => s.hydrateFromStorage);

  const isCompact = bp !== "lg";

  usePanelHydrationEffect(() => {
    hydratePanelFromStorage();
  }, [hydratePanelFromStorage]);

  useEffect(() => {
    if (!isCompact) return;
    setCompactSidebarOpen(false);
    setCompactAgentPanelOpen(false);
  }, [isCompact, setCompactAgentPanelOpen, setCompactSidebarOpen]);

  if (isCompact) {
    return (
      <CompactAppShellLoader
        wsSlug={wsSlug}
        deepResearchEnabled={deepResearchEnabled}
        synthesisExportEnabled={synthesisExportEnabled}
        compactSidebarOpen={compactSidebarOpen}
        setCompactSidebarOpen={setCompactSidebarOpen}
        compactAgentPanelOpen={compactAgentPanelOpen}
        setCompactAgentPanelOpen={setCompactAgentPanelOpen}
        sidebarTitle={placeholders.sidebar}
        agentPanelTitle={placeholders.agentPanel}
      >
        {children}
      </CompactAppShellLoader>
    );
  }

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-background"
      data-testid="app-shell"
    >
      {sidebarOpen && (
        <>
          <div
            className="hidden lg:block"
            style={{ width: sidebarWidth, maxWidth: "20vw", flexShrink: 0 }}
          >
            <ShellSidebarLoader
              deepResearchEnabled={deepResearchEnabled}
              synthesisExportEnabled={synthesisExportEnabled}
            />
          </div>
          <ShellResizeHandle
            className="hidden lg:block"
            onDrag={(d) => setSidebarWidth(sidebarWidth + d)}
            onReset={resetSidebarWidth}
          />
        </>
      )}
      {!sidebarOpen ? (
        <CollapsedPanelRail side="left">
          <CollapsedPanelButton
            label={placeholders.openSidebar}
            onClick={() => setSidebarOpen(true)}
            Icon={PanelLeftOpen}
          />
        </CollapsedPanelRail>
      ) : null}
      <ProjectMainDropZone>
        <TabShell>{children}</TabShell>
      </ProjectMainDropZone>
      {agentPanelOpen && (
        <>
          <ShellResizeHandle
            className="hidden lg:block"
            onDrag={(d) => setAgentPanelWidth(agentPanelWidth - d)}
            onReset={resetAgentPanelWidth}
          />
          <div
            className="hidden lg:block"
            style={{ width: agentPanelWidth, maxWidth: "22vw", flexShrink: 0 }}
          >
            <LazyAgentPanel wsSlug={wsSlug} />
          </div>
        </>
      )}
      {!agentPanelOpen ? (
        <CollapsedPanelRail side="right">
          <CollapsedPanelButton
            label={placeholders.openAgentPanel}
            onClick={() => setAgentPanelOpen(true)}
            Icon={PanelRightOpen}
          />
        </CollapsedPanelRail>
      ) : null}
      <IngestOverlaysLoader />
    </div>
  );
}

function CollapsedPanelRail({
  side,
  children,
}: {
  side: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`hidden h-full w-11 shrink-0 justify-center bg-muted/30 px-1.5 py-2 lg:flex ${
        side === "left" ? "border-r border-border" : "border-l border-border"
      }`}
    >
      {children}
    </div>
  );
}

function CollapsedPanelButton({
  label,
  onClick,
  Icon,
}: {
  label: string;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden className="h-4 w-4" />
    </button>
  );
}
