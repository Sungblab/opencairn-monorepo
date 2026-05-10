import { create } from "zustand";

// Tab system canonical types — Phase 3 fills in tab bar rendering, drag,
// preview-mode italic, keyboard nav, and the closed-tab restore stack.
// New tab kinds added in later phases must extend the union here.
export type TabKind =
  | "dashboard"
  | "project"
  | "note"
  | "research_hub"
  | "research_run"
  | "import"
  | "help"
  | "report"
  | "ws_settings"
  | "ingest"
  | "lit_search"
  | "agent_file"
  | "code_workspace";

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
  | "agent-file"
  | "graph"
  | "mindmap"
  | "flashcard"
  | "ingest"
  | "lit-search"
  | "code-workspace";

/**
 * Map a note's `sourceType` (DB enum) to the Tab Mode that should render it.
 * Phase 1 only auto-detects canvas; other sources default to the Plate editor.
 * Callers (sidebar "open note", import flows) use this when they don't already
 * know the desired mode, instead of hardcoding `'plate'`.
 */
export function modeFromSourceType(
  sourceType: string | null | undefined,
): TabMode {
  if (sourceType === "canvas") return "canvas";
  return "plate";
}

export interface Tab {
  id: string;
  kind: TabKind;
  targetId: string | null;
  mode: TabMode;
  title: string;
  /**
   * i18n key under `appShell.tabTitles` for kinds whose title is static UI
   * copy. Left unset for `note` because its title comes from the DB and cannot
   * be translated.
   */
  titleKey?: string;
  /**
   * Interpolation params for `titleKey`. Only `id` is used today
   * (`research_run` → "Research {id}"); kept open for future kinds.
   */
  titleParams?: Record<string, string>;
  pinned: boolean;
  preview: boolean;
  dirty: boolean;
  splitWith: string | null;
  splitSide: "left" | "right" | null;
  scrollY: number;
}

// ⌘⇧T ring buffer — keeps the last N non-pinned closed tabs per workspace.
// Persisted so a restore survives reloads (matches Chrome / VSCode behavior).
const CLOSED_STACK_LIMIT = 10;

interface Persisted {
  tabs: Tab[];
  activeId: string | null;
  closedStack: Tab[];
}

interface State extends Persisted {
  workspaceId: string | null;
  setWorkspace(id: string): void;
  addTab(tab: Tab): void;
  closeTab(id: string): void;
  setActive(id: string): void;
  updateTab(id: string, patch: Partial<Tab>): void;
  findTabByTarget(kind: TabKind, targetId: string | null): Tab | undefined;
  dedupeTabsByKind(kind: TabKind, keepId: string): void;
  reorderTab(from: number, to: number): void;
  togglePin(id: string): void;
  promoteFromPreview(id: string): void;
  addOrReplacePreview(tab: Tab): void;
  closeOthers(keepId: string): void;
  closeRight(id: string): void;
  restoreClosed(): void;
}

// Per-workspace storage keys: switching workspaces flushes the outgoing
// stack to its own key so each workspace remembers its own open tabs even
// after a multi-workspace user toggles back and forth a few times.
const key = (wsId: string) => `oc:tabs:${wsId}`;

function loadPersisted(wsId: string): Persisted {
  try {
    const raw = localStorage.getItem(key(wsId));
    if (!raw) return { tabs: [], activeId: null, closedStack: [] };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      tabs: parsed.tabs ?? [],
      activeId: parsed.activeId ?? null,
      // closedStack was added in Phase 3. Older persisted blobs from Phase 1
      // omit it — coerce to empty so the user doesn't see a crash on first
      // load after the upgrade.
      closedStack: parsed.closedStack ?? [],
    };
  } catch {
    return { tabs: [], activeId: null, closedStack: [] };
  }
}

function flush(wsId: string, data: Persisted) {
  localStorage.setItem(key(wsId), JSON.stringify(data));
}

export const useTabsStore = create<State>((set, get) => ({
  workspaceId: null,
  tabs: [],
  activeId: null,
  closedStack: [],

  setWorkspace: (id) => {
    const prev = get();
    if (prev.workspaceId && prev.workspaceId !== id) {
      flush(prev.workspaceId, {
        tabs: prev.tabs,
        activeId: prev.activeId,
        closedStack: prev.closedStack,
      });
    }
    const loaded = loadPersisted(id);
    set({
      workspaceId: id,
      tabs: loaded.tabs,
      activeId: loaded.activeId,
      closedStack: loaded.closedStack,
    });
  },

  addTab: (tab) => {
    const s = get();
    const tabs = [...s.tabs, tab];
    const activeId = tab.id;
    set({ tabs, activeId });
    if (s.workspaceId)
      flush(s.workspaceId, { tabs, activeId, closedStack: s.closedStack });
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
    const closedStack = [...s.closedStack, target].slice(-CLOSED_STACK_LIMIT);
    set({ tabs, activeId, closedStack });
    if (s.workspaceId) flush(s.workspaceId, { tabs, activeId, closedStack });
  },

  setActive: (id) => {
    const s = get();
    if (!s.tabs.some((t) => t.id === id)) return;
    set({ activeId: id });
    if (s.workspaceId)
      flush(s.workspaceId, {
        tabs: s.tabs,
        activeId: id,
        closedStack: s.closedStack,
      });
  },

  updateTab: (id, patch) => {
    const s = get();
    const tabs = s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ tabs });
    if (s.workspaceId)
      flush(s.workspaceId, {
        tabs,
        activeId: s.activeId,
        closedStack: s.closedStack,
      });
  },

  findTabByTarget: (kind, targetId) =>
    get().tabs.find((t) => t.kind === kind && t.targetId === targetId),

  dedupeTabsByKind: (kind, keepId) => {
    const s = get();
    if (!s.tabs.some((t) => t.id === keepId && t.kind === kind)) return;
    const hasDuplicate = s.tabs.some(
      (t) => t.kind === kind && t.id !== keepId,
    );
    if (!hasDuplicate) return;
    const tabs = s.tabs.filter((t) => t.kind !== kind || t.id === keepId);
    const activeId =
      s.activeId && tabs.some((t) => t.id === s.activeId)
        ? s.activeId
        : keepId;
    set({ tabs, activeId });
    if (s.workspaceId)
      flush(s.workspaceId, { tabs, activeId, closedStack: s.closedStack });
  },

  reorderTab: (from, to) => {
    const s = get();
    if (from === to) return;
    if (from < 0 || from >= s.tabs.length) return;
    if (to < 0 || to >= s.tabs.length) return;
    const next = [...s.tabs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set({ tabs: next });
    if (s.workspaceId)
      flush(s.workspaceId, {
        tabs: next,
        activeId: s.activeId,
        closedStack: s.closedStack,
      });
  },

  togglePin: (id) => {
    const current = get().tabs.find((t) => t.id === id);
    if (!current) return;
    get().updateTab(id, { pinned: !current.pinned });
  },

  promoteFromPreview: (id) => {
    const current = get().tabs.find((t) => t.id === id);
    if (!current || !current.preview) return;
    get().updateTab(id, { preview: false });
  },

  addOrReplacePreview: (tab) => {
    const s = get();
    const previewIdx = s.tabs.findIndex((t) => t.preview);
    // The caller's intent is "open and focus this preview tab", so activeId
    // always resolves to the new tab — unlike addTab which preserves any
    // existing activeId. One set / one flush for both branches.
    const tabs =
      previewIdx < 0
        ? [...s.tabs, tab]
        : s.tabs.map((t, i) => (i === previewIdx ? tab : t));
    const activeId = tab.id;
    set({ tabs, activeId });
    if (s.workspaceId)
      flush(s.workspaceId, {
        tabs,
        activeId,
        closedStack: s.closedStack,
      });
  },

  closeOthers: (keepId) => {
    const s = get();
    const next = s.tabs.filter((t) => t.id === keepId || t.pinned);
    // Evicted tabs feed the ⌘⇧T stack so bulk-close stays undoable
    // (VSCode / Chrome "Reopen closed tabs" parity). Pinned tabs can't be
    // closed so they're filtered alongside keepId — they never enter
    // the stack.
    const evicted = s.tabs.filter(
      (t) => t.id !== keepId && !t.pinned,
    );
    const closedStack = [...s.closedStack, ...evicted].slice(
      -CLOSED_STACK_LIMIT,
    );
    set({ tabs: next, activeId: keepId, closedStack });
    if (s.workspaceId)
      flush(s.workspaceId, {
        tabs: next,
        activeId: keepId,
        closedStack,
      });
  },

  closeRight: (id) => {
    const s = get();
    const idx = s.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    // Keep the pivot + everything to its left + any pinned tabs on the
    // right. Matches the close-button / ⌘W rule that pinned tabs resist
    // close actions; closing just the unpinned right-hand tabs is the
    // least surprising behavior.
    const rightSlice = s.tabs.slice(idx + 1);
    const evicted = rightSlice.filter((t) => !t.pinned);
    const rightPinned = rightSlice.filter((t) => t.pinned);
    const next = [...s.tabs.slice(0, idx + 1), ...rightPinned];
    const activeId = next.some((t) => t.id === s.activeId) ? s.activeId : id;
    const closedStack = [...s.closedStack, ...evicted].slice(
      -CLOSED_STACK_LIMIT,
    );
    set({ tabs: next, activeId, closedStack });
    if (s.workspaceId)
      flush(s.workspaceId, {
        tabs: next,
        activeId,
        closedStack,
      });
  },

  restoreClosed: () => {
    const s = get();
    if (s.closedStack.length === 0) return;
    const last = s.closedStack[s.closedStack.length - 1];
    const closedStack = s.closedStack.slice(0, -1);
    const tabs = [...s.tabs, last];
    set({ tabs, activeId: last.id, closedStack });
    if (s.workspaceId)
      flush(s.workspaceId, { tabs, activeId: last.id, closedStack });
  },
}));
