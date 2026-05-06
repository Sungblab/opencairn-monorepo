"use client";
import { useEffect } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useTranslations } from "next-intl";
import { ShellSidebar } from "@/components/sidebar/shell-sidebar";
import { TabShell } from "../tab-shell/tab-shell";
import { AgentPanel } from "@/components/agent-panel/agent-panel";
import { ShellResizeHandle } from "./shell-resize-handle";
import { IngestOverlays } from "@/components/ingest/ingest-overlays";
import { usePanelStore } from "@/stores/panel-store";
import { useBreakpoint } from "@/hooks/use-breakpoint";

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
  const t = useTranslations("appShell.placeholders");
  const sidebarWidth = usePanelStore((s) => s.sidebarWidth);
  const sidebarOpen = usePanelStore((s) => s.sidebarOpen);
  const compactSidebarOpen = usePanelStore((s) => s.compactSidebarOpen);
  const setCompactSidebarOpen = usePanelStore(
    (s) => s.setCompactSidebarOpen,
  );
  const agentPanelWidth = usePanelStore((s) => s.agentPanelWidth);
  const agentPanelOpen = usePanelStore((s) => s.agentPanelOpen);
  const compactAgentPanelOpen = usePanelStore((s) => s.compactAgentPanelOpen);
  const setCompactAgentPanelOpen = usePanelStore(
    (s) => s.setCompactAgentPanelOpen,
  );
  const setSidebarWidth = usePanelStore((s) => s.setSidebarWidth);
  const resetSidebarWidth = usePanelStore((s) => s.resetSidebarWidth);
  const setAgentPanelWidth = usePanelStore((s) => s.setAgentPanelWidth);
  const resetAgentPanelWidth = usePanelStore((s) => s.resetAgentPanelWidth);

  const isCompact = bp !== "lg";

  useEffect(() => {
    if (!isCompact) return;
    setCompactSidebarOpen(false);
    setCompactAgentPanelOpen(false);
  }, [isCompact, setCompactAgentPanelOpen, setCompactSidebarOpen]);

  if (isCompact) {
    return (
      <div
        className="flex h-screen w-screen overflow-hidden bg-background"
        data-testid="app-shell"
      >
        <Sheet
          open={compactSidebarOpen}
          onOpenChange={setCompactSidebarOpen}
        >
          <SheetContent side="left" className="w-[280px] p-0">
            <SheetTitle className="sr-only">{t("sidebar")}</SheetTitle>
            <ShellSidebar
              deepResearchEnabled={deepResearchEnabled}
              synthesisExportEnabled={synthesisExportEnabled}
            />
          </SheetContent>
        </Sheet>
        <TabShell>{children}</TabShell>
        <Sheet
          open={compactAgentPanelOpen}
          onOpenChange={setCompactAgentPanelOpen}
        >
          <SheetContent side="right" className="w-[360px] p-0">
            <SheetTitle className="sr-only">{t("agent_panel")}</SheetTitle>
            <AgentPanel wsSlug={wsSlug} />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-background"
      data-testid="app-shell"
    >
      {sidebarOpen && (
        <>
          <div style={{ width: sidebarWidth, flexShrink: 0 }}>
            <ShellSidebar
              deepResearchEnabled={deepResearchEnabled}
              synthesisExportEnabled={synthesisExportEnabled}
            />
          </div>
          <ShellResizeHandle
            onDrag={(d) => setSidebarWidth(sidebarWidth + d)}
            onReset={resetSidebarWidth}
          />
        </>
      )}
      <TabShell>{children}</TabShell>
      {agentPanelOpen && (
        <>
          <ShellResizeHandle
            onDrag={(d) => setAgentPanelWidth(agentPanelWidth - d)}
            onReset={resetAgentPanelWidth}
          />
          <div style={{ width: agentPanelWidth, flexShrink: 0 }}>
            <AgentPanel wsSlug={wsSlug} />
          </div>
        </>
      )}
      <IngestOverlays />
    </div>
  );
}
