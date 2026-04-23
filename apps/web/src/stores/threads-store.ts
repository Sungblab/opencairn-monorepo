import { create } from "zustand";

// Per-workspace active chat thread. Phase 4 will turn `activeThreadId`
// into the source of truth for which thread the agent panel renders;
// Phase 1 just needs the persistence shape locked down so the panel
// can pick it up without a migration later.
const key = (wsId: string) => `oc:active_thread:${wsId}`;

interface State {
  workspaceId: string | null;
  activeThreadId: string | null;
  setWorkspace(id: string): void;
  setActiveThread(threadId: string | null): void;
}

export const useThreadsStore = create<State>((set, get) => ({
  workspaceId: null,
  activeThreadId: null,
  setWorkspace: (id) => {
    try {
      const raw = localStorage.getItem(key(id));
      const parsed = raw ? (JSON.parse(raw) as string | null) : null;
      set({ workspaceId: id, activeThreadId: parsed });
    } catch {
      set({ workspaceId: id, activeThreadId: null });
    }
  },
  setActiveThread: (threadId) => {
    const s = get();
    set({ activeThreadId: threadId });
    if (s.workspaceId) {
      localStorage.setItem(key(s.workspaceId), JSON.stringify(threadId));
    }
  },
}));
