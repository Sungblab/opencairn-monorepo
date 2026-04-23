"use client";
import { PlaceholderSidebar } from "./placeholder-sidebar";
import { PlaceholderTabShell } from "./placeholder-tab-shell";
import { PlaceholderAgentPanel } from "./placeholder-agent-panel";
import { ShellResizeHandle } from "./shell-resize-handle";
import { usePanelStore } from "@/stores/panel-store";

// 3-panel desktop shell: sidebar | tab area | agent panel. Each side is
// resizable and dismissable. Phase 12 (responsive Sheet) will swap in
// overlays when the viewport drops below `lg`; Phase 1 keeps the desktop
// path and trusts useBreakpoint consumers to handle the narrow case.
export function AppShell({ children }: { children: React.ReactNode }) {
  const sidebarWidth = usePanelStore((s) => s.sidebarWidth);
  const sidebarOpen = usePanelStore((s) => s.sidebarOpen);
  const agentPanelWidth = usePanelStore((s) => s.agentPanelWidth);
  const agentPanelOpen = usePanelStore((s) => s.agentPanelOpen);
  const setSidebarWidth = usePanelStore((s) => s.setSidebarWidth);
  const resetSidebarWidth = usePanelStore((s) => s.resetSidebarWidth);
  const setAgentPanelWidth = usePanelStore((s) => s.setAgentPanelWidth);
  const resetAgentPanelWidth = usePanelStore(
    (s) => s.resetAgentPanelWidth,
  );

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      data-testid="app-shell"
    >
      {sidebarOpen && (
        <>
          <div style={{ width: sidebarWidth, flexShrink: 0 }}>
            <PlaceholderSidebar />
          </div>
          <ShellResizeHandle
            onDrag={(d) => setSidebarWidth(sidebarWidth + d)}
            onReset={resetSidebarWidth}
          />
        </>
      )}
      <PlaceholderTabShell>{children}</PlaceholderTabShell>
      {agentPanelOpen && (
        <>
          <ShellResizeHandle
            onDrag={(d) => setAgentPanelWidth(agentPanelWidth - d)}
            onReset={resetAgentPanelWidth}
          />
          <div style={{ width: agentPanelWidth, flexShrink: 0 }}>
            <PlaceholderAgentPanel />
          </div>
        </>
      )}
    </div>
  );
}
