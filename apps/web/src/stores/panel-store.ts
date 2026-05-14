import { create } from "zustand";

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
const BOTTOM_DOCK_MIN = 180;
const BOTTOM_DOCK_MAX = 420;
const BOTTOM_DOCK_DEFAULT = 260;
export type AgentPanelTab = "chat" | "tools" | "activity" | "notifications";
export type BottomDockTab = "activity" | "logs";

const PANEL_STORAGE_KEY = "oc:panel";
const AGENT_PANEL_TABS: AgentPanelTab[] = [
  "chat",
  "tools",
  "activity",
  "notifications",
];

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

interface PanelState {
  sidebarWidth: number;
  sidebarOpen: boolean;
  compactSidebarOpen: boolean;
  agentPanelWidth: number;
  agentPanelOpen: boolean;
  compactAgentPanelOpen: boolean;
  agentPanelTab: AgentPanelTab;
  bottomDockOpen: boolean;
  bottomDockHeight: number;
  bottomDockTab: BottomDockTab;
  backlinksOpen: boolean;
  enrichmentOpen: boolean;
  toggleSidebar(): void;
  toggleCompactSidebar(): void;
  toggleAgentPanel(): void;
  toggleCompactAgentPanel(): void;
  toggleBacklinks(): void;
  toggleEnrichment(): void;
  setAgentPanelTab(tab: AgentPanelTab): void;
  openAgentPanelTab(tab: AgentPanelTab): void;
  setBottomDockOpen(open: boolean): void;
  toggleBottomDock(): void;
  setBottomDockTab(tab: BottomDockTab): void;
  openBottomDock(tab: BottomDockTab): void;
  setBottomDockHeight(h: number): void;
  resetBottomDockHeight(): void;
  setSidebarOpen(open: boolean): void;
  setCompactSidebarOpen(open: boolean): void;
  setAgentPanelOpen(open: boolean): void;
  setCompactAgentPanelOpen(open: boolean): void;
  setSidebarWidth(w: number): void;
  setAgentPanelWidth(w: number): void;
  resetSidebarWidth(): void;
  resetAgentPanelWidth(): void;
  hydrateFromStorage(): void;
}

type PanelData = Pick<
  PanelState,
  | "sidebarWidth"
  | "sidebarOpen"
  | "compactSidebarOpen"
  | "agentPanelWidth"
  | "agentPanelOpen"
  | "compactAgentPanelOpen"
  | "agentPanelTab"
  | "bottomDockOpen"
  | "bottomDockHeight"
  | "bottomDockTab"
  | "backlinksOpen"
  | "enrichmentOpen"
>;

const DEFAULT_PANEL_DATA: PanelData = {
  sidebarWidth: SIDEBAR_DEFAULT,
  sidebarOpen: true,
  compactSidebarOpen: false,
  agentPanelWidth: AGENT_DEFAULT,
  agentPanelOpen: false,
  compactAgentPanelOpen: false,
  agentPanelTab: "chat",
  bottomDockOpen: false,
  bottomDockHeight: BOTTOM_DOCK_DEFAULT,
  bottomDockTab: "activity",
  backlinksOpen: false,
  enrichmentOpen: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readClampedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

function isAgentPanelTab(value: unknown): value is AgentPanelTab {
  return (
    typeof value === "string" &&
    AGENT_PANEL_TABS.includes(value as AgentPanelTab)
  );
}

function readPersistedPanelState(): PanelData | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    const stored =
      isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed;

    if (!isRecord(stored)) {
      return null;
    }

    return {
      sidebarWidth: readClampedNumber(
        stored.sidebarWidth,
        SIDEBAR_DEFAULT,
        SIDEBAR_MIN,
        SIDEBAR_MAX,
      ),
      sidebarOpen: readBoolean(stored.sidebarOpen, true),
      compactSidebarOpen: false,
      agentPanelWidth: readClampedNumber(
        stored.agentPanelWidth,
        AGENT_DEFAULT,
        AGENT_MIN,
        AGENT_MAX,
      ),
      agentPanelOpen: readBoolean(stored.agentPanelOpen, false),
      compactAgentPanelOpen: false,
      agentPanelTab: isAgentPanelTab(stored.agentPanelTab)
        ? stored.agentPanelTab
        : "chat",
      bottomDockOpen: readBoolean(stored.bottomDockOpen, false),
      bottomDockHeight: readClampedNumber(
        stored.bottomDockHeight,
        BOTTOM_DOCK_DEFAULT,
        BOTTOM_DOCK_MIN,
        BOTTOM_DOCK_MAX,
      ),
      bottomDockTab: stored.bottomDockTab === "logs" ? "logs" : "activity",
      backlinksOpen: readBoolean(stored.backlinksOpen, false),
      enrichmentOpen: readBoolean(stored.enrichmentOpen, false),
    };
  } catch {
    return null;
  }
}

function persistPanelState(state: PanelState) {
  if (typeof localStorage === "undefined") {
    return;
  }

  const data: PanelData = {
    sidebarWidth: state.sidebarWidth,
    sidebarOpen: state.sidebarOpen,
    compactSidebarOpen: false,
    agentPanelWidth: state.agentPanelWidth,
    agentPanelOpen: state.agentPanelOpen,
    compactAgentPanelOpen: false,
    agentPanelTab: state.agentPanelTab,
    bottomDockOpen: state.bottomDockOpen,
    bottomDockHeight: state.bottomDockHeight,
    bottomDockTab: state.bottomDockTab,
    backlinksOpen: state.backlinksOpen,
    enrichmentOpen: state.enrichmentOpen,
  };

  try {
    localStorage.setItem(
      PANEL_STORAGE_KEY,
      JSON.stringify({ state: data, version: 0 }),
    );
  } catch {
    // Preference persistence is best-effort; layout state still updates in memory.
  }
}

// User-global, not workspace-scoped: a user who likes a 320px sidebar
// likes it everywhere. Other shell stores (tabs/threads/sidebar tree state)
// keyed per workspace because their data IS the workspace.
export const usePanelStore = create<PanelState>()((set) => {
  const setAndPersist = (
    updater: Partial<PanelData> | ((state: PanelState) => Partial<PanelData>),
  ) =>
    set((state) => {
      const patch = typeof updater === "function" ? updater(state) : updater;
      persistPanelState({ ...state, ...patch });
      return patch;
    });

  return {
    ...DEFAULT_PANEL_DATA,
    toggleSidebar: () => setAndPersist((s) => ({ sidebarOpen: !s.sidebarOpen })),
    toggleCompactSidebar: () =>
      setAndPersist((s) => ({ compactSidebarOpen: !s.compactSidebarOpen })),
    toggleAgentPanel: () =>
      setAndPersist((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
    toggleCompactAgentPanel: () =>
      setAndPersist((s) => ({
        compactAgentPanelOpen: !s.compactAgentPanelOpen,
      })),
    toggleBacklinks: () =>
      setAndPersist((s) => ({ backlinksOpen: !s.backlinksOpen })),
    toggleEnrichment: () =>
      setAndPersist((s) => ({ enrichmentOpen: !s.enrichmentOpen })),
    setAgentPanelTab: (tab) => setAndPersist({ agentPanelTab: tab }),
    openAgentPanelTab: (tab) =>
      setAndPersist({
        agentPanelTab: tab,
        agentPanelOpen: true,
        compactAgentPanelOpen: true,
      }),
    setBottomDockOpen: (open) => setAndPersist({ bottomDockOpen: open }),
    toggleBottomDock: () =>
      setAndPersist((s) => ({ bottomDockOpen: !s.bottomDockOpen })),
    setBottomDockTab: (tab) => setAndPersist({ bottomDockTab: tab }),
    openBottomDock: (tab) =>
      setAndPersist({
        bottomDockTab: tab,
        bottomDockOpen: true,
      }),
    setBottomDockHeight: (h) =>
      setAndPersist({
        bottomDockHeight: clamp(h, BOTTOM_DOCK_MIN, BOTTOM_DOCK_MAX),
      }),
    resetBottomDockHeight: () =>
      setAndPersist({ bottomDockHeight: BOTTOM_DOCK_DEFAULT }),
    setSidebarOpen: (open) => setAndPersist({ sidebarOpen: open }),
    setCompactSidebarOpen: (open) =>
      setAndPersist({ compactSidebarOpen: open }),
    setAgentPanelOpen: (open) => setAndPersist({ agentPanelOpen: open }),
    setCompactAgentPanelOpen: (open) =>
      setAndPersist({ compactAgentPanelOpen: open }),
    setSidebarWidth: (w) =>
      setAndPersist({ sidebarWidth: clamp(w, SIDEBAR_MIN, SIDEBAR_MAX) }),
    setAgentPanelWidth: (w) =>
      setAndPersist({ agentPanelWidth: clamp(w, AGENT_MIN, AGENT_MAX) }),
    resetSidebarWidth: () => setAndPersist({ sidebarWidth: SIDEBAR_DEFAULT }),
    resetAgentPanelWidth: () =>
      setAndPersist({ agentPanelWidth: AGENT_DEFAULT }),
    hydrateFromStorage: () => {
      const persisted = readPersistedPanelState();
      if (persisted) set(persisted);
    },
  };
});
