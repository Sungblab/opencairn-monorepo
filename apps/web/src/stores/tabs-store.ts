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
 * Source PDFs should reopen in the original PDF view. Other sources default to
 * the Plate editor unless they have a dedicated viewer mode.
 * Callers (sidebar "open note", import flows) use this when they don't already
 * know the desired mode, instead of hardcoding `'plate'`.
 */
export function modeFromSourceType(
  sourceType: string | null | undefined,
): TabMode {
  if (sourceType === "canvas") return "canvas";
  if (sourceType === "pdf") return "source";
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

export type SplitPane = "primary" | "secondary";

export interface SplitLayout {
  primaryTabId: string;
  secondaryTabId: string;
  orientation: "vertical";
  ratio: number;
}

// ⌘⇧T ring buffer — keeps the last N non-pinned closed tabs per workspace.
// Persisted so a restore survives reloads (matches Chrome / VSCode behavior).
const CLOSED_STACK_LIMIT = 10;
const RECENT_ACTIVE_LIMIT = 20;
const SPLIT_RATIO_MIN = 0.25;
const SPLIT_RATIO_MAX = 0.75;
const SPLIT_RATIO_DEFAULT = 0.5;

interface Persisted {
  version: 1;
  tabs: Tab[];
  activeId: string | null;
  activePane: SplitPane;
  split: SplitLayout | null;
  closedStack: Tab[];
  recentlyActiveTabIds: string[];
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
  openTabToRight(tab: Tab, options?: { reuseExisting?: boolean }): void;
  setActivePane(pane: SplitPane): void;
  swapSplitPanes(): void;
  setSplitRatio(ratio: number): void;
  unsplit(keep?: SplitPane): void;
  toggleActiveSplit(): void;
  closeActiveSplitPane(): void;
}

// Per-workspace storage keys: switching workspaces flushes the outgoing
// stack to its own key so each workspace remembers its own open tabs even
// after a multi-workspace user toggles back and forth a few times.
const key = (wsId: string) => `oc:tabs:${wsId}`;

const defaultPersisted = (): Persisted => ({
  version: 1,
  tabs: [],
  activeId: null,
  activePane: "primary",
  split: null,
  closedStack: [],
  recentlyActiveTabIds: [],
});

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function tabExists(tabs: Tab[], id: string | null | undefined): id is string {
  return Boolean(id && tabs.some((tab) => tab.id === id));
}

function deriveLegacySplit(tabs: Tab[]): SplitLayout | null {
  const left = tabs.find(
    (tab) =>
      tab.splitSide === "left" && tabExists(tabs, tab.splitWith ?? undefined),
  );
  if (left?.splitWith) {
    return {
      primaryTabId: left.id,
      secondaryTabId: left.splitWith,
      orientation: "vertical",
      ratio: SPLIT_RATIO_DEFAULT,
    };
  }

  const right = tabs.find(
    (tab) =>
      tab.splitSide === "right" && tabExists(tabs, tab.splitWith ?? undefined),
  );
  if (right?.splitWith) {
    return {
      primaryTabId: right.splitWith,
      secondaryTabId: right.id,
      orientation: "vertical",
      ratio: SPLIT_RATIO_DEFAULT,
    };
  }

  return null;
}

function sanitizeSplit(
  tabs: Tab[],
  split: Partial<SplitLayout> | null | undefined,
): SplitLayout | null {
  if (!split) return null;
  if (!tabExists(tabs, split.primaryTabId)) return null;
  if (!tabExists(tabs, split.secondaryTabId)) return null;
  if (split.primaryTabId === split.secondaryTabId) return null;
  return {
    primaryTabId: split.primaryTabId,
    secondaryTabId: split.secondaryTabId,
    orientation: "vertical",
    ratio:
      typeof split.ratio === "number" && Number.isFinite(split.ratio)
        ? clamp(split.ratio, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX)
        : SPLIT_RATIO_DEFAULT,
  };
}

function paneForActive(
  activeId: string | null,
  split: SplitLayout | null,
): SplitPane {
  if (split?.secondaryTabId === activeId) return "secondary";
  return "primary";
}

function tabIdForPane(split: SplitLayout, pane: SplitPane) {
  return pane === "secondary" ? split.secondaryTabId : split.primaryTabId;
}

function addRecent(
  recentlyActiveTabIds: string[],
  id: string | null,
): string[] {
  if (!id || recentlyActiveTabIds[0] === id) return recentlyActiveTabIds;
  return [
    id,
    ...recentlyActiveTabIds.filter((existing) => existing !== id),
  ].slice(0, RECENT_ACTIVE_LIMIT);
}

function pickFallbackActive(tabs: Tab[], recent: string[]) {
  const recentMatch = recent.find((id) => tabExists(tabs, id));
  if (recentMatch) return recentMatch;
  const lastUnpinned = [...tabs].reverse().find((tab) => !tab.pinned);
  return lastUnpinned?.id ?? tabs[0]?.id ?? null;
}

function normalizePersisted(parsed: Partial<Persisted>): Persisted {
  const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
  const closedStack = Array.isArray(parsed.closedStack)
    ? parsed.closedStack
    : [];
  const recentlyActiveTabIds = Array.isArray(parsed.recentlyActiveTabIds)
    ? parsed.recentlyActiveTabIds.filter(
        (id): id is string => typeof id === "string" && tabExists(tabs, id),
      )
    : [];
  const split = sanitizeSplit(tabs, parsed.split) ?? deriveLegacySplit(tabs);
  const activeId = tabExists(tabs, parsed.activeId)
    ? parsed.activeId
    : pickFallbackActive(tabs, recentlyActiveTabIds);
  return {
    version: 1,
    tabs,
    activeId,
    activePane: split ? paneForActive(activeId, split) : "primary",
    split,
    closedStack,
    recentlyActiveTabIds,
  };
}

function loadPersisted(wsId: string): Persisted {
  try {
    const raw = localStorage.getItem(key(wsId));
    if (!raw) return defaultPersisted();
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return normalizePersisted(parsed);
  } catch {
    return defaultPersisted();
  }
}

function flush(wsId: string, data: Persisted) {
  localStorage.setItem(key(wsId), JSON.stringify(data));
}

export const useTabsStore = create<State>((set, get) => ({
  workspaceId: null,
  version: 1,
  tabs: [],
  activeId: null,
  activePane: "primary",
  split: null,
  closedStack: [],
  recentlyActiveTabIds: [],

  setWorkspace: (id) => {
    const prev = get();
    if (prev.workspaceId && prev.workspaceId !== id) {
      flush(prev.workspaceId, {
        tabs: prev.tabs,
        activeId: prev.activeId,
        activePane: prev.activePane,
        split: prev.split,
        closedStack: prev.closedStack,
        recentlyActiveTabIds: prev.recentlyActiveTabIds,
        version: 1,
      });
    }
    const loaded = loadPersisted(id);
    set({
      workspaceId: id,
      tabs: loaded.tabs,
      activeId: loaded.activeId,
      activePane: loaded.activePane,
      split: loaded.split,
      closedStack: loaded.closedStack,
      recentlyActiveTabIds: loaded.recentlyActiveTabIds,
    });
  },

  addTab: (tab) => {
    const s = get();
    const tabs = [...s.tabs, tab];
    const activeId = tab.id;
    const recentlyActiveTabIds = addRecent(s.recentlyActiveTabIds, activeId);
    set({
      tabs,
      activeId,
      activePane: "primary",
      split: null,
      recentlyActiveTabIds,
    });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs,
        activeId,
        activePane: "primary",
        split: null,
        closedStack: s.closedStack,
        recentlyActiveTabIds,
      });
  },

  closeTab: (id) => {
    const s = get();
    const target = s.tabs.find((t) => t.id === id);
    if (!target || target.pinned) return;
    const idx = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    let split = s.split;
    let activeId = s.activeId;
    let activePane = s.activePane;
    if (split && (split.primaryTabId === id || split.secondaryTabId === id)) {
      const survivingId =
        split.primaryTabId === id ? split.secondaryTabId : split.primaryTabId;
      split = null;
      activeId = tabExists(tabs, survivingId)
        ? survivingId
        : pickFallbackActive(tabs, s.recentlyActiveTabIds);
      activePane = "primary";
    } else if (activeId === id) {
      // Right neighbor wins; falls back to left when closing the rightmost.
      const right = s.tabs[idx + 1];
      const left = s.tabs[idx - 1];
      activeId = right?.id ?? left?.id ?? null;
    }
    const closedStack = [...s.closedStack, target].slice(-CLOSED_STACK_LIMIT);
    const recentlyActiveTabIds = addRecent(
      s.recentlyActiveTabIds.filter((tabId) => tabId !== id),
      activeId,
    );
    set({ tabs, activeId, activePane, split, closedStack, recentlyActiveTabIds });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs,
        activeId,
        activePane,
        split,
        closedStack,
        recentlyActiveTabIds,
      });
  },

  setActive: (id) => {
    const s = get();
    if (!s.tabs.some((t) => t.id === id)) return;
    const isInSplit = Boolean(
      s.split && (s.split.primaryTabId === id || s.split.secondaryTabId === id),
    );
    const split = isInSplit ? s.split : null;
    const activePane = split ? paneForActive(id, split) : "primary";
    const recentlyActiveTabIds = addRecent(s.recentlyActiveTabIds, id);
    set({ activeId: id, activePane, split, recentlyActiveTabIds });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: s.tabs,
        activeId: id,
        activePane,
        split,
        closedStack: s.closedStack,
        recentlyActiveTabIds,
      });
  },

  updateTab: (id, patch) => {
    const s = get();
    const tabs = s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ tabs });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs,
        activeId: s.activeId,
        activePane: s.activePane,
        split: s.split,
        closedStack: s.closedStack,
        recentlyActiveTabIds: s.recentlyActiveTabIds,
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
    const split = sanitizeSplit(tabs, s.split);
    const activePane = split ? paneForActive(activeId, split) : "primary";
    const recentlyActiveTabIds = addRecent(s.recentlyActiveTabIds, activeId);
    set({ tabs, activeId, activePane, split, recentlyActiveTabIds });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs,
        activeId,
        activePane,
        split,
        closedStack: s.closedStack,
        recentlyActiveTabIds,
      });
  },

  reorderTab: (from, to) => {
    const s = get();
    if (from === to) return;
    if (from < 0 || from >= s.tabs.length) return;
    if (to < 0 || to >= s.tabs.length) return;
    const next = [...s.tabs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const split = sanitizeSplit(next, s.split);
    const activePane = split ? paneForActive(s.activeId, split) : "primary";
    set({ tabs: next, activePane, split });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: next,
        activeId: s.activeId,
        activePane,
        split,
        closedStack: s.closedStack,
        recentlyActiveTabIds: s.recentlyActiveTabIds,
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
    // always resolves to the new tab. One set / one flush for both branches.
    const tabs =
      previewIdx < 0
        ? [...s.tabs, tab]
        : s.tabs.map((t, i) => (i === previewIdx ? tab : t));
    const activeId = tab.id;
    const recentlyActiveTabIds = addRecent(s.recentlyActiveTabIds, activeId);
    set({
      tabs,
      activeId,
      activePane: "primary",
      split: null,
      recentlyActiveTabIds,
    });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs,
        activeId,
        activePane: "primary",
        split: null,
        closedStack: s.closedStack,
        recentlyActiveTabIds,
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
    const split = sanitizeSplit(next, s.split);
    const activePane = split ? paneForActive(keepId, split) : "primary";
    const recentlyActiveTabIds = addRecent(
      s.recentlyActiveTabIds.filter((id) => next.some((tab) => tab.id === id)),
      keepId,
    );
    set({ tabs: next, activeId: keepId, activePane, split, closedStack, recentlyActiveTabIds });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: next,
        activeId: keepId,
        activePane,
        split,
        closedStack,
        recentlyActiveTabIds,
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
    const split = sanitizeSplit(next, s.split);
    const activePane = split ? paneForActive(activeId, split) : "primary";
    const closedStack = [...s.closedStack, ...evicted].slice(
      -CLOSED_STACK_LIMIT,
    );
    const recentlyActiveTabIds = addRecent(
      s.recentlyActiveTabIds.filter((tabId) =>
        next.some((tab) => tab.id === tabId),
      ),
      activeId,
    );
    set({ tabs: next, activeId, activePane, split, closedStack, recentlyActiveTabIds });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: next,
        activeId,
        activePane,
        split,
        closedStack,
        recentlyActiveTabIds,
      });
  },

  restoreClosed: () => {
    const s = get();
    if (s.closedStack.length === 0) return;
    const last = s.closedStack[s.closedStack.length - 1];
    const closedStack = s.closedStack.slice(0, -1);
    const restored = { ...last, pinned: false, preview: false };
    const tabs = [...s.tabs, restored];
    const recentlyActiveTabIds = addRecent(s.recentlyActiveTabIds, restored.id);
    set({
      tabs,
      activeId: restored.id,
      activePane: "primary",
      split: null,
      closedStack,
      recentlyActiveTabIds,
    });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs,
        activeId: restored.id,
        activePane: "primary",
        split: null,
        closedStack,
        recentlyActiveTabIds,
      });
  },

  openTabToRight: (tab, options) => {
    const s = get();
    const reuseExisting = options?.reuseExisting ?? true;
    const activeId = s.activeId ?? s.tabs[0]?.id ?? null;
    if (!activeId) {
      get().addTab({ ...tab, preview: false });
      return;
    }

    const existing =
      reuseExisting && tab.targetId !== null
        ? s.tabs.find(
            (candidate) =>
              candidate.id !== activeId &&
              candidate.kind === tab.kind &&
              candidate.targetId === tab.targetId,
          )
        : undefined;

    const secondary = existing ?? { ...tab, preview: false };
    const tabs = existing
      ? s.tabs.map((candidate) =>
          candidate.id === existing.id ? { ...candidate, preview: false } : candidate,
        )
      : [...s.tabs, secondary];
    const split: SplitLayout = {
      primaryTabId: activeId,
      secondaryTabId: secondary.id,
      orientation: "vertical",
      ratio: s.split?.ratio ?? SPLIT_RATIO_DEFAULT,
    };
    const recentlyActiveTabIds = addRecent(
      addRecent(s.recentlyActiveTabIds, activeId),
      secondary.id,
    );
    set({
      tabs,
      activeId: secondary.id,
      activePane: "secondary",
      split,
      recentlyActiveTabIds,
    });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs,
        activeId: secondary.id,
        activePane: "secondary",
        split,
        closedStack: s.closedStack,
        recentlyActiveTabIds,
      });
  },

  setActivePane: (pane) => {
    const s = get();
    if (!s.split || s.activePane === pane) return;
    const activeId = tabIdForPane(s.split, pane);
    const recentlyActiveTabIds = addRecent(s.recentlyActiveTabIds, activeId);
    set({ activePane: pane, activeId, recentlyActiveTabIds });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: s.tabs,
        activeId,
        activePane: pane,
        split: s.split,
        closedStack: s.closedStack,
        recentlyActiveTabIds,
      });
  },

  swapSplitPanes: () => {
    const s = get();
    if (!s.split) return;
    const split: SplitLayout = {
      ...s.split,
      primaryTabId: s.split.secondaryTabId,
      secondaryTabId: s.split.primaryTabId,
    };
    const activePane = paneForActive(s.activeId, split);
    set({ split, activePane });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: s.tabs,
        activeId: s.activeId,
        activePane,
        split,
        closedStack: s.closedStack,
        recentlyActiveTabIds: s.recentlyActiveTabIds,
      });
  },

  setSplitRatio: (ratio) => {
    const s = get();
    if (!s.split) return;
    const split = {
      ...s.split,
      ratio: clamp(ratio, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX),
    };
    set({ split });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: s.tabs,
        activeId: s.activeId,
        activePane: s.activePane,
        split,
        closedStack: s.closedStack,
        recentlyActiveTabIds: s.recentlyActiveTabIds,
      });
  },

  unsplit: (keep) => {
    const s = get();
    if (!s.split) return;
    const activePane = keep ?? s.activePane;
    const activeId = tabIdForPane(s.split, activePane);
    const recentlyActiveTabIds = addRecent(s.recentlyActiveTabIds, activeId);
    set({
      split: null,
      activePane: "primary",
      activeId,
      recentlyActiveTabIds,
    });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: s.tabs,
        activeId,
        activePane: "primary",
        split: null,
        closedStack: s.closedStack,
        recentlyActiveTabIds,
      });
  },

  toggleActiveSplit: () => {
    const s = get();
    if (s.split) {
      get().unsplit(s.activePane);
      return;
    }
    if (!s.activeId) return;
    const activeIdx = s.tabs.findIndex((tab) => tab.id === s.activeId);
    if (activeIdx < 0 || s.tabs.length < 2) return;
    const secondary =
      s.tabs[(activeIdx + 1) % s.tabs.length] ?? s.tabs.find((tab) => tab.id !== s.activeId);
    if (!secondary || secondary.id === s.activeId) return;
    const split: SplitLayout = {
      primaryTabId: s.activeId,
      secondaryTabId: secondary.id,
      orientation: "vertical",
      ratio: SPLIT_RATIO_DEFAULT,
    };
    set({ split, activePane: "primary" });
    if (s.workspaceId)
      flush(s.workspaceId, {
        version: 1,
        tabs: s.tabs,
        activeId: s.activeId,
        activePane: "primary",
        split,
        closedStack: s.closedStack,
        recentlyActiveTabIds: s.recentlyActiveTabIds,
      });
  },

  closeActiveSplitPane: () => {
    const s = get();
    if (!s.split) return;
    get().closeTab(tabIdForPane(s.split, s.activePane));
  },
}));
