"use client";

import type { Tab } from "@/stores/tabs-store";
import { AgentPanel } from "@/components/agent-panel/agent-panel";

export function AgentPanelViewer({ tab: _tab }: { tab: Tab }) {
  return (
    <div
      data-testid="agent-panel-tab-viewer"
      className="h-full min-h-0 overflow-hidden bg-background"
    >
      <AgentPanel />
    </div>
  );
}
