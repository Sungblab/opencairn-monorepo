"use client";

import type { ReactNode } from "react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
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
          <SheetContent side="left" className="w-[min(280px,100vw)] p-0">
            <SheetTitle className="sr-only">{sidebarTitle}</SheetTitle>
            <ShellSidebarLoader
              deepResearchEnabled={deepResearchEnabled}
              synthesisExportEnabled={synthesisExportEnabled}
            />
          </SheetContent>
        ) : null}
      </Sheet>
      <TabShell
        leadingControls={
          <CompactPanelButton
            label={sidebarTitle}
            onClick={() => setCompactSidebarOpen(true)}
            Icon={PanelLeftOpen}
            testId="compact-sidebar-trigger"
          />
        }
        trailingControls={
          <CompactPanelButton
            label={agentPanelTitle}
            onClick={() => setCompactAgentPanelOpen(true)}
            Icon={PanelRightOpen}
            testId="compact-agent-panel-trigger"
            side="right"
          />
        }
      >
        {children}
      </TabShell>
      <Sheet
        open={compactAgentPanelOpen}
        onOpenChange={setCompactAgentPanelOpen}
      >
        {compactAgentPanelOpen ? (
          <SheetContent side="right" className="w-[min(360px,100vw)] p-0">
            <SheetTitle className="sr-only">{agentPanelTitle}</SheetTitle>
            <LazyAgentPanel wsSlug={wsSlug} />
          </SheetContent>
        ) : null}
      </Sheet>
    </div>
  );
}

function CompactPanelButton({
  label,
  onClick,
  Icon,
  testId,
  side = "left",
}: {
  label: string;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  testId: string;
  side?: "left" | "right";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className={`grid h-10 w-10 shrink-0 place-items-center border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        side === "left" ? "border-r" : "border-l"
      }`}
    >
      <Icon aria-hidden className="h-4 w-4" />
    </button>
  );
}
