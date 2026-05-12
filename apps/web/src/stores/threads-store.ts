import { create } from "zustand";

// Per workspace + project active chat thread. Project-scoped keys keep the
// Agent Panel from carrying a previous project's selected conversation across
// project switches; the workspace key is retained for workspace-level chat.
const key = (wsId: string, projectId: string | null) =>
  projectId
    ? `oc:active_thread:${wsId}:project:${projectId}`
    : `oc:active_thread:${wsId}:workspace`;
const legacyWorkspaceKey = (wsId: string) => `oc:active_thread:${wsId}`;

interface State {
  workspaceId: string | null;
  projectId: string | null;
  activeThreadId: string | null;
  setWorkspace(id: string, projectId?: string | null): void;
  setActiveThread(threadId: string | null): void;
}

export const useThreadsStore = create<State>((set, get) => ({
  workspaceId: null,
  projectId: null,
  activeThreadId: null,
  setWorkspace: (id, projectId = null) => {
    try {
      const raw =
        localStorage.getItem(key(id, projectId)) ??
        (projectId ? null : localStorage.getItem(legacyWorkspaceKey(id)));
      const parsed = raw ? (JSON.parse(raw) as string | null) : null;
      set({ workspaceId: id, projectId, activeThreadId: parsed });
    } catch {
      set({ workspaceId: id, projectId, activeThreadId: null });
    }
  },
  setActiveThread: (threadId) => {
    const s = get();
    set({ activeThreadId: threadId });
    if (s.workspaceId) {
      localStorage.setItem(
        key(s.workspaceId, s.projectId),
        JSON.stringify(threadId),
      );
    }
  },
}));
