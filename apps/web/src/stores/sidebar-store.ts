import { create } from "zustand";

// Tracks which folder/project nodes are expanded in the sidebar tree.
// Per-workspace because the tree IS the workspace; expanded state from
// workspace A would be meaningless when the user switches to B. Phase 2
// fills in the actual tree component on top of this set.
const key = (wsId: string) => `oc:sidebar:${wsId}`;

interface State {
  workspaceId: string | null;
  expanded: Set<string>;
  setWorkspace(id: string): void;
  toggleExpanded(nodeId: string): void;
  isExpanded(nodeId: string): boolean;
}

function load(wsId: string): Set<string> {
  try {
    const raw = localStorage.getItem(key(wsId));
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function flush(wsId: string, s: Set<string>) {
  localStorage.setItem(key(wsId), JSON.stringify([...s]));
}

export const useSidebarStore = create<State>((set, get) => ({
  workspaceId: null,
  expanded: new Set(),
  setWorkspace: (id) => {
    const prev = get();
    if (prev.workspaceId && prev.workspaceId !== id) {
      flush(prev.workspaceId, prev.expanded);
    }
    set({ workspaceId: id, expanded: load(id) });
  },
  toggleExpanded: (nodeId) => {
    const s = get();
    const next = new Set(s.expanded);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    set({ expanded: next });
    if (s.workspaceId) flush(s.workspaceId, next);
  },
  isExpanded: (nodeId) => get().expanded.has(nodeId),
}));
