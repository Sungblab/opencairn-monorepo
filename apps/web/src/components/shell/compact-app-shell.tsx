"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ShellSidebarLoader } from "@/components/sidebar/shell-sidebar-loader";
import { LazyAgentPanel } from "@/components/agent-panel/agent-panel-loader";
import { TabShell } from "../tab-shell/tab-shell";

export interface CompactAppShellProps {
  children: ReactNode;
  wsSlug: string;
  deepResearchEnabled: boolean;
  synthesisExportEnabled: boolean;
  compactSidebarOpen: boolean;
  setCompactSidebarOpen: (open: boolean) => void;
  compactAgentPanelOpen: boolean;
  setCompactAgentPanelOpen: (open: boolean) => void;
  sidebarTitle: string;
  agentPanelTitle: string;
}

export function CompactAppShell({
  children,
  wsSlug,
  deepResearchEnabled,
  synthesisExportEnabled,
  compactSidebarOpen,
  setCompactSidebarOpen,
  compactAgentPanelOpen,
  setCompactAgentPanelOpen,
  sidebarTitle,
  agentPanelTitle,
}: CompactAppShellProps) {
  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-background"
      data-testid="app-shell"
    >
      <Sheet open={compactSidebarOpen} onOpenChange={setCompactSidebarOpen}>
        {compactSidebarOpen ? (
          <SheetContent side="left" className="w-[280px] p-0">
            <SheetTitle className="sr-only">{sidebarTitle}</SheetTitle>
            <ShellSidebarLoader
              deepResearchEnabled={deepResearchEnabled}
              synthesisExportEnabled={synthesisExportEnabled}
            />
          </SheetContent>
        ) : null}
      </Sheet>
      <TabShell>{children}</TabShell>
      <Sheet
        open={compactAgentPanelOpen}
        onOpenChange={setCompactAgentPanelOpen}
      >
        {compactAgentPanelOpen ? (
          <SheetContent side="right" className="w-[360px] p-0">
            <SheetTitle className="sr-only">{agentPanelTitle}</SheetTitle>
            <LazyAgentPanel wsSlug={wsSlug} />
          </SheetContent>
        ) : null}
      </Sheet>
    </div>
  );
}
