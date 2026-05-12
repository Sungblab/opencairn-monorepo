import { create } from "zustand";

// Tracks which folder/project nodes are expanded in the sidebar tree.
// Per-workspace because the tree IS the workspace; expanded state from
// workspace A would be meaningless when the user switches to B. Phase 2
// fills in the actual tree component on top of this set.
const key = (wsId: string) => `oc:sidebar:${wsId}`;
export const DEFAULT_QUICK_CREATE_ORDER = [
  "new_note",
  "upload",
  "new_folder",
  "new_canvas",
  "new_code",
  "generate_document",
] as const;
const DEFAULT_COLLAPSED_SECTIONS = [
  "favorites",
  "recent",
  "publish",
  "help",
] as const;
export type SidebarQuickCreateActionId =
  (typeof DEFAULT_QUICK_CREATE_ORDER)[number];
const QUICK_CREATE_IDS = new Set<string>(DEFAULT_QUICK_CREATE_ORDER);

interface State {
  workspaceId: string | null;
  expanded: Set<string>;
  collapsedSections: Set<string>;
  quickCreateOrder: SidebarQuickCreateActionId[];
  setWorkspace(id: string): void;
  toggleExpanded(nodeId: string): void;
  isExpanded(nodeId: string): boolean;
  toggleSectionCollapsed(sectionId: string): void;
  isSectionCollapsed(sectionId: string): boolean;
  recordQuickCreateUse(actionId: SidebarQuickCreateActionId): void;
}

function normalizeQuickCreateOrder(value: unknown): SidebarQuickCreateActionId[] {
  const validIds = Array.isArray(value)
    ? value.filter(
        (id): id is SidebarQuickCreateActionId =>
          typeof id === "string" && QUICK_CREATE_IDS.has(id),
      )
    : [];
  const fromStorage = [...new Set(validIds)];
  return [
    ...fromStorage,
    ...DEFAULT_QUICK_CREATE_ORDER.filter((id) => !fromStorage.includes(id)),
  ];
}

function load(
  wsId: string,
): Pick<State, "expanded" | "collapsedSections" | "quickCreateOrder"> {
  try {
    const raw = localStorage.getItem(key(wsId));
    if (!raw) {
      return {
        expanded: new Set(),
        collapsedSections: new Set(DEFAULT_COLLAPSED_SECTIONS),
        quickCreateOrder: [...DEFAULT_QUICK_CREATE_ORDER],
      };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        expanded: new Set<string>(parsed),
        collapsedSections: new Set(DEFAULT_COLLAPSED_SECTIONS),
        quickCreateOrder: [...DEFAULT_QUICK_CREATE_ORDER],
      };
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const expanded = Array.isArray(record.expanded)
        ? record.expanded.filter((id): id is string => typeof id === "string")
        : [];
      const collapsedSections = Array.isArray(record.collapsedSections)
        ? record.collapsedSections.filter(
            (id): id is string => typeof id === "string",
          )
        : DEFAULT_COLLAPSED_SECTIONS;
      return {
        expanded: new Set(expanded),
        collapsedSections: new Set(collapsedSections),
        quickCreateOrder: normalizeQuickCreateOrder(record.quickCreateOrder),
      };
    }
  } catch {
    // Fall through to a clean sidebar state when old localStorage is invalid.
  }
  return {
    expanded: new Set(),
    collapsedSections: new Set(DEFAULT_COLLAPSED_SECTIONS),
    quickCreateOrder: [...DEFAULT_QUICK_CREATE_ORDER],
  };
}

function flush(
  wsId: string,
  state: Pick<State, "expanded" | "collapsedSections" | "quickCreateOrder">,
) {
  localStorage.setItem(
    key(wsId),
    JSON.stringify({
      expanded: [...state.expanded],
      collapsedSections: [...state.collapsedSections],
      quickCreateOrder: state.quickCreateOrder,
    }),
  );
}

export const useSidebarStore = create<State>((set, get) => ({
  workspaceId: null,
  expanded: new Set(),
  collapsedSections: new Set(DEFAULT_COLLAPSED_SECTIONS),
  quickCreateOrder: [...DEFAULT_QUICK_CREATE_ORDER],
  setWorkspace: (id) => {
    set({ workspaceId: id, ...load(id) });
  },
  toggleExpanded: (nodeId) => {
    const s = get();
    const next = new Set(s.expanded);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    set({ expanded: next });
    if (s.workspaceId) flush(s.workspaceId, { ...s, expanded: next });
  },
  isExpanded: (nodeId) => get().expanded.has(nodeId),
  toggleSectionCollapsed: (sectionId) => {
    const s = get();
    const next = new Set(s.collapsedSections);
    if (next.has(sectionId)) next.delete(sectionId);
    else next.add(sectionId);
    set({ collapsedSections: next });
    if (s.workspaceId) flush(s.workspaceId, { ...s, collapsedSections: next });
  },
  isSectionCollapsed: (sectionId) => get().collapsedSections.has(sectionId),
  recordQuickCreateUse: (actionId) => {
    const s = get();
    const next = [
      actionId,
      ...s.quickCreateOrder.filter((id) => id !== actionId),
    ];
    set({ quickCreateOrder: next });
    if (s.workspaceId) flush(s.workspaceId, { ...s, quickCreateOrder: next });
  },
}));
