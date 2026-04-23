import { create } from "zustand";

// Tab system canonical types — Phase 3 will fill in tab bar rendering, drag,
// preview-mode italic, split panes, etc. Keep this list authoritative; new
// tab kinds added in later phases must extend the union here.
export type TabKind =
  | "dashboard"
  | "project"
  | "note"
  | "research_hub"
  | "research_run"
  | "import"
  | "ws_settings";

export type TabMode =
  | "plate"
  | "reading"
  | "diff"
  | "artifact"
  | "presentation"
  | "data"
  | "spreadsheet"
  | "whiteboard"
  | "source"
  | "canvas"
  | "mindmap"
  | "flashcard";

export interface Tab {
  id: string;
  kind: TabKind;
  targetId: string | null;
  mode: TabMode;
  title: string;
  pinned: boolean;
  preview: boolean;
  dirty: boolean;
  splitWith: string | null;
  splitSide: "left" | "right" | null;
  scrollY: number;
}

interface Persisted {
  tabs: Tab[];
  activeId: string | null;
}

interface State extends Persisted {
  workspaceId: string | null;
  setWorkspace(id: string): void;
  addTab(tab: Tab): void;
  closeTab(id: string): void;
  setActive(id: string): void;
  updateTab(id: string, patch: Partial<Tab>): void;
  findTabByTarget(kind: TabKind, targetId: string | null): Tab | undefined;
}

// Per-workspace storage keys: switching workspaces flushes the outgoing
// stack to its own key so each workspace remembers its own open tabs even
// after a multi-workspace user toggles back and forth a few times.
const key = (wsId: string) => `oc:tabs:${wsId}`;

function loadPersisted(wsId: string): Persisted {
  try {
    const raw = localStorage.getItem(key(wsId));
    if (!raw) return { tabs: [], activeId: null };
    return JSON.parse(raw) as Persisted;
  } catch {
    return { tabs: [], activeId: null };
  }
}

function flush(wsId: string, data: Persisted) {
  localStorage.setItem(key(wsId), JSON.stringify(data));
}

export const useTabsStore = create<State>((set, get) => ({
  workspaceId: null,
  tabs: [],
  activeId: null,

  setWorkspace: (id) => {
    const prev = get();
    if (prev.workspaceId && prev.workspaceId !== id) {
      flush(prev.workspaceId, { tabs: prev.tabs, activeId: prev.activeId });
    }
    const loaded = loadPersisted(id);
    set({ workspaceId: id, tabs: loaded.tabs, activeId: loaded.activeId });
  },

  addTab: (tab) => {
    const s = get();
    const tabs = [...s.tabs, tab];
    const activeId = s.activeId ?? tab.id;
    set({ tabs, activeId });
    if (s.workspaceId) flush(s.workspaceId, { tabs, activeId });
  },

  closeTab: (id) => {
    const s = get();
    const target = s.tabs.find((t) => t.id === id);
    if (!target || target.pinned) return;
    const idx = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeId = s.activeId;
    if (activeId === id) {
      // Right neighbor wins; falls back to left when closing the rightmost.
      const right = s.tabs[idx + 1];
      const left = s.tabs[idx - 1];
      activeId = right?.id ?? left?.id ?? null;
    }
    set({ tabs, activeId });
    if (s.workspaceId) flush(s.workspaceId, { tabs, activeId });
  },

  setActive: (id) => {
    const s = get();
    if (!s.tabs.some((t) => t.id === id)) return;
    set({ activeId: id });
    if (s.workspaceId) flush(s.workspaceId, { tabs: s.tabs, activeId: id });
  },

  updateTab: (id, patch) => {
    const s = get();
    const tabs = s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ tabs });
    if (s.workspaceId) flush(s.workspaceId, { tabs, activeId: s.activeId });
  },

  findTabByTarget: (kind, targetId) =>
    get().tabs.find((t) => t.kind === kind && t.targetId === targetId),
}));
