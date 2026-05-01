import { create } from "zustand";
import { persist } from "zustand/middleware";

// Width bounds reflect what the resize handle in Task 10 actually allows
// the user to drag to; the clamps here are the second line of defense so
// that a bad localStorage value (e.g. carried over from a future build
// that loosened the bounds) cannot bork the layout.
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;
const AGENT_MIN = 300;
const AGENT_MAX = 560;
const AGENT_DEFAULT = 360;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

interface PanelState {
  sidebarWidth: number;
  sidebarOpen: boolean;
  agentPanelWidth: number;
  agentPanelOpen: boolean;
  backlinksOpen: boolean;
  enrichmentOpen: boolean;
  toggleSidebar(): void;
  toggleAgentPanel(): void;
  toggleBacklinks(): void;
  toggleEnrichment(): void;
  setSidebarOpen(open: boolean): void;
  setAgentPanelOpen(open: boolean): void;
  setSidebarWidth(w: number): void;
  setAgentPanelWidth(w: number): void;
  resetSidebarWidth(): void;
  resetAgentPanelWidth(): void;
}

// User-global, not workspace-scoped: a user who likes a 320px sidebar
// likes it everywhere. Other shell stores (tabs/threads/sidebar tree state)
// keyed per workspace because their data IS the workspace.
export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR_DEFAULT,
      sidebarOpen: true,
      agentPanelWidth: AGENT_DEFAULT,
      agentPanelOpen: true,
      backlinksOpen: false,
      enrichmentOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleAgentPanel: () =>
        set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
      toggleBacklinks: () =>
        set((s) => ({ backlinksOpen: !s.backlinksOpen })),
      toggleEnrichment: () =>
        set((s) => ({ enrichmentOpen: !s.enrichmentOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setAgentPanelOpen: (open) => set({ agentPanelOpen: open }),
      setSidebarWidth: (w) =>
        set({ sidebarWidth: clamp(w, SIDEBAR_MIN, SIDEBAR_MAX) }),
      setAgentPanelWidth: (w) =>
        set({ agentPanelWidth: clamp(w, AGENT_MIN, AGENT_MAX) }),
      resetSidebarWidth: () => set({ sidebarWidth: SIDEBAR_DEFAULT }),
      resetAgentPanelWidth: () => set({ agentPanelWidth: AGENT_DEFAULT }),
    }),
    { name: "oc:panel" },
  ),
);
