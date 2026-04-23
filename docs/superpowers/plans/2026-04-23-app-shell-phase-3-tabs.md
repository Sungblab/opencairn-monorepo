# App Shell Phase 3 — Tab System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1 placeholder tab bar with the real tab system: live tab list with drag-reorder, pin, preview mode, context menu, overflow dropdown, keyboard shortcuts, and a `TabModeRouter` that dispatches to four core viewers (`plate`, `reading`, `source`, `data`). Editor integration for `plate` uses the existing Plan 2A/2B Plate pipeline.

**Architecture:**
- `TabBar` (drag/sort via `@dnd-kit/sortable`) + `TabItem` row; right-click opens shared `ContextMenu` component; overflow wrapped in a shadcn `DropdownMenu`.
- Preview mode = client-only flag; promoted to normal on the first Plate `onChange` or explicit pin. State lives in `tabs-store` (added in Phase 1).
- `TabModeRouter` is a pure dispatch on `Tab.mode` returning the right viewer; each viewer is a single-responsibility component in `components/tab-shell/viewers/`.
- Non-core modes (`artifact`, `spreadsheet`, `presentation`, `whiteboard`, `canvas`, `mindmap`, `flashcard`, `diff`) render a "Coming soon" stub that is replaced in later plans.

**Tech Stack:** `@dnd-kit/sortable`, existing Plate v49 editor, `pdf.js` (via `react-pdf`), `react-json-view-lite` for JSON tree, shadcn menus, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-23-app-shell-redesign-design.md` §5 (Tab System).
**Depends on:** Phase 1 (tabs-store, useUrlTabSync, AppShell) + Phase 2 (real Sidebar, for sidebar-click → preview tab interaction).

---

## File Structure

**New files:**

```
apps/web/src/components/tab-shell/
├── tab-shell.tsx                         # replaces PlaceholderTabShell
├── tab-bar.tsx                           # horizontal tab list, sortable, scrollable
├── tab-item.tsx                          # single tab row
├── tab-context-menu.tsx                  # shared right-click + ⋯ menu
├── tab-overflow-menu.tsx                 # ··· dropdown for off-screen tabs
├── tab-mode-router.tsx                   # dispatch mode → viewer
└── viewers/
    ├── plate-viewer.tsx                  # wraps existing editor
    ├── reading-viewer.tsx
    ├── source-viewer.tsx                 # PDF via react-pdf
    ├── data-viewer.tsx                   # JSON tree
    └── stub-viewer.tsx                   # placeholder for non-core modes

apps/web/src/hooks/
├── use-tab-keyboard.ts                   # ⌘T/W/⇧T/1~9/←→ etc.
└── use-tab-preview-promotion.ts          # promote preview → normal on edit

apps/web/src/lib/
└── tab-factory.ts                        # newTab helpers + title defaults
```

**Modified files:**

```
apps/web/src/components/shell/app-shell.tsx  # swap PlaceholderTabShell → TabShell
apps/web/src/stores/tabs-store.ts            # +reorder, togglePin, promoteFromPreview
apps/web/src/hooks/use-url-tab-sync.ts       # preview flag handling on sidebar click
messages/{ko,en}/tabs.json                   # i18n
```

**Tests:**

```
apps/web/src/components/tab-shell/tab-bar.test.tsx
apps/web/src/components/tab-shell/tab-item.test.tsx
apps/web/src/components/tab-shell/tab-mode-router.test.tsx
apps/web/src/hooks/use-tab-keyboard.test.tsx
apps/web/src/hooks/use-tab-preview-promotion.test.tsx
apps/web/src/lib/tab-factory.test.ts
apps/web/src/stores/tabs-store.extensions.test.ts
apps/web/tests/e2e/tab-system.spec.ts
```

---

## Task 1: Extend `tabs-store` with reorder / togglePin / promoteFromPreview

**Files:**
- Modify: `apps/web/src/stores/tabs-store.ts`
- Create: `apps/web/src/stores/tabs-store.extensions.test.ts`

- [ ] **Step 1.1: Write failing tests**

```ts
// apps/web/src/stores/tabs-store.extensions.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useTabsStore, type Tab } from "./tabs-store";

const mk = (p: Partial<Tab> = {}): Tab => ({
  id: "x", kind: "note", targetId: null, mode: "plate", title: "",
  pinned: false, preview: false, dirty: false, splitWith: null, splitSide: null,
  scrollY: 0, ...p,
});

describe("tabs-store extensions", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-a");
  });

  it("reorderTab moves tab from fromIndex to toIndex", () => {
    ["a", "b", "c"].forEach((id) => useTabsStore.getState().addTab(mk({ id })));
    useTabsStore.getState().reorderTab(0, 2);
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("togglePin flips the pinned flag", () => {
    useTabsStore.getState().addTab(mk({ id: "a" }));
    useTabsStore.getState().togglePin("a");
    expect(useTabsStore.getState().tabs[0].pinned).toBe(true);
    useTabsStore.getState().togglePin("a");
    expect(useTabsStore.getState().tabs[0].pinned).toBe(false);
  });

  it("promoteFromPreview flips preview=false", () => {
    useTabsStore.getState().addTab(mk({ id: "a", preview: true }));
    useTabsStore.getState().promoteFromPreview("a");
    expect(useTabsStore.getState().tabs[0].preview).toBe(false);
  });

  it("addOrReplacePreview replaces existing preview when adding a new preview", () => {
    useTabsStore.getState().addTab(mk({ id: "prev", targetId: "n1", preview: true }));
    useTabsStore.getState().addOrReplacePreview(mk({ id: "new", targetId: "n2", preview: true }));
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe("new");
    expect(tabs[0].targetId).toBe("n2");
  });

  it("addOrReplacePreview appends when no preview exists", () => {
    useTabsStore.getState().addTab(mk({ id: "normal", preview: false }));
    useTabsStore.getState().addOrReplacePreview(mk({ id: "prev", preview: true }));
    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it("closeOthers keeps only the given tab and pinned tabs", () => {
    ["a", "b", "c", "d"].forEach((id) => useTabsStore.getState().addTab(mk({ id })));
    useTabsStore.getState().togglePin("c");
    useTabsStore.getState().closeOthers("a");
    expect(useTabsStore.getState().tabs.map((t) => t.id).sort()).toEqual(["a", "c"]);
  });

  it("closeRight closes all tabs to the right of the given id", () => {
    ["a", "b", "c", "d"].forEach((id) => useTabsStore.getState().addTab(mk({ id })));
    useTabsStore.getState().closeRight("b");
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 1.2: Extend store**

Add to the `State` interface and the `create(...)` body in `tabs-store.ts`:

```ts
// interface additions
reorderTab(from: number, to: number): void;
togglePin(id: string): void;
promoteFromPreview(id: string): void;
addOrReplacePreview(tab: Tab): void;
closeOthers(keepId: string): void;
closeRight(id: string): void;

// implementation additions (use persist helper already in the file)
reorderTab: (from, to) => {
  const s = get();
  if (from === to) return;
  const next = [...s.tabs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  set({ tabs: next });
  if (s.workspaceId) flush(s.workspaceId, { tabs: next, activeId: s.activeId });
},

togglePin: (id) => get().updateTab(id, { pinned: !get().tabs.find((t) => t.id === id)?.pinned }),

promoteFromPreview: (id) => get().updateTab(id, { preview: false }),

addOrReplacePreview: (tab) => {
  const s = get();
  const previewIdx = s.tabs.findIndex((t) => t.preview);
  if (previewIdx >= 0) {
    const next = [...s.tabs];
    next[previewIdx] = tab;
    set({ tabs: next, activeId: tab.id });
    if (s.workspaceId) flush(s.workspaceId, { tabs: next, activeId: tab.id });
  } else {
    s.addTab(tab);
  }
},

closeOthers: (keepId) => {
  const s = get();
  const next = s.tabs.filter((t) => t.id === keepId || t.pinned);
  set({ tabs: next, activeId: keepId });
  if (s.workspaceId) flush(s.workspaceId, { tabs: next, activeId: keepId });
},

closeRight: (id) => {
  const s = get();
  const idx = s.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const next = s.tabs.slice(0, idx + 1);
  const activeId = next.some((t) => t.id === s.activeId) ? s.activeId : id;
  set({ tabs: next, activeId });
  if (s.workspaceId) flush(s.workspaceId, { tabs: next, activeId });
},
```

- [ ] **Step 1.3: Run + commit**

```bash
pnpm --filter @opencairn/web test tabs-store
git add apps/web/src/stores/tabs-store.ts apps/web/src/stores/tabs-store.extensions.test.ts
git commit -m "feat(web): extend tabs-store with reorder/pin/preview promotion"
```

---

## Task 2: `tab-factory.ts` — Tab construction helpers

Centralize `newId`, default titles, default mode so viewers + sync hook + sidebar share one source.

**Files:**
- Create: `apps/web/src/lib/tab-factory.ts`
- Create: `apps/web/src/lib/tab-factory.test.ts`

- [ ] **Step 2.1: Test**

```ts
// apps/web/src/lib/tab-factory.test.ts
import { describe, expect, it } from "vitest";
import { newTab } from "./tab-factory";

describe("newTab", () => {
  it("produces a plate-mode note tab with preview=true by default", () => {
    const t = newTab({ kind: "note", targetId: "n-1", title: "Memo" });
    expect(t.kind).toBe("note");
    expect(t.mode).toBe("plate");
    expect(t.preview).toBe(true);
    expect(t.title).toBe("Memo");
  });

  it("non-note kinds default preview=false", () => {
    expect(newTab({ kind: "dashboard", targetId: null }).preview).toBe(false);
    expect(newTab({ kind: "research_hub", targetId: null }).preview).toBe(false);
  });

  it("title falls back to kind defaults", () => {
    expect(newTab({ kind: "dashboard", targetId: null }).title).toBe("대시보드");
    expect(newTab({ kind: "research_hub", targetId: null }).title).toBe("Deep Research");
  });

  it("generated id is unique", () => {
    const a = newTab({ kind: "note", targetId: "x" });
    const b = newTab({ kind: "note", targetId: "x" });
    expect(a.id).not.toBe(b.id);
  });
});
```

- [ ] **Step 2.2: Implement**

```ts
// apps/web/src/lib/tab-factory.ts
import type { Tab, TabKind, TabMode } from "@/stores/tabs-store";

export function genTabId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultMode(kind: TabKind): TabMode {
  return "plate";
}

function defaultTitle(kind: TabKind, targetId: string | null): string {
  switch (kind) {
    case "dashboard": return "대시보드";
    case "note": return "노트";
    case "project": return "프로젝트";
    case "research_hub": return "Deep Research";
    case "research_run": return `Research ${targetId ?? ""}`.trim();
    case "import": return "가져오기";
    case "ws_settings": return "설정";
  }
}

export function newTab(opts: {
  kind: TabKind;
  targetId: string | null;
  title?: string;
  mode?: TabMode;
  preview?: boolean;
}): Tab {
  return {
    id: genTabId(),
    kind: opts.kind,
    targetId: opts.targetId,
    mode: opts.mode ?? defaultMode(opts.kind),
    title: opts.title ?? defaultTitle(opts.kind, opts.targetId),
    pinned: false,
    preview: opts.preview ?? opts.kind === "note",
    dirty: false,
    splitWith: null,
    splitSide: null,
    scrollY: 0,
  };
}
```

- [ ] **Step 2.3: Migrate `use-url-tab-sync.ts`**

Replace the inline `newId`, `defaultModeFor`, `defaultTitleFor` functions with the new factory:

```ts
import { newTab } from "@/lib/tab-factory";
// ...
const tab = newTab({ kind: route.kind, targetId: route.targetId });
addTab(tab);
```

Also change `addTab(tab)` to `addOrReplacePreview(tab)` when the tab is a note (preview flow), `addTab(tab)` for other kinds. See §5.4 of the spec.

```ts
if (route.kind === "note") {
  useTabsStore.getState().addOrReplacePreview(tab);
} else {
  addTab(tab);
}
```

Re-run `pnpm --filter @opencairn/web test use-url-tab-sync` — the Phase 1 tests should still pass with this refactor. Adjust expectations if the preview semantics changed a specific assertion.

- [ ] **Step 2.4: Commit**

```bash
git add apps/web/src/lib/tab-factory.ts \
        apps/web/src/lib/tab-factory.test.ts \
        apps/web/src/hooks/use-url-tab-sync.ts
git commit -m "feat(web): centralize Tab construction and preview flow in sidebar click"
```

---

## Task 3: `TabItem` component

Single row: title, dirty dot, pin icon, close button, italic preview style.

**Files:**
- Create: `apps/web/src/components/tab-shell/tab-item.tsx`
- Create: `apps/web/src/components/tab-shell/tab-item.test.tsx`

- [ ] **Step 3.1: Test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabItem } from "./tab-item";

const base = {
  id: "t1", kind: "note" as const, targetId: "n1", mode: "plate" as const,
  title: "My Note", pinned: false, preview: false, dirty: false,
  splitWith: null, splitSide: null, scrollY: 0,
};

describe("TabItem", () => {
  it("renders title", () => {
    render(<TabItem tab={base} active={false} onClick={() => {}} onClose={() => {}} />);
    expect(screen.getByText("My Note")).toBeInTheDocument();
  });

  it("shows pushpin when pinned, hides close button", () => {
    render(<TabItem tab={{ ...base, pinned: true }} active={false} onClick={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("고정됨")).toBeInTheDocument();
    expect(screen.queryByLabelText("닫기")).toBeNull();
  });

  it("renders italic when preview", () => {
    render(<TabItem tab={{ ...base, preview: true }} active={false} onClick={() => {}} onClose={() => {}} />);
    expect(screen.getByText("My Note").className).toMatch(/italic/);
  });

  it("shows dirty dot when dirty", () => {
    render(<TabItem tab={{ ...base, dirty: true }} active={false} onClick={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("저장되지 않음")).toBeInTheDocument();
  });

  it("middle-click triggers onClose", () => {
    const onClose = vi.fn();
    render(<TabItem tab={base} active={false} onClick={() => {}} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("tab"), { button: 1 });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3.2: Implement**

```tsx
"use client";
import { Pin, X, FileText } from "lucide-react";
import type { Tab } from "@/stores/tabs-store";

export function TabItem({
  tab, active, onClick, onClose,
}: {
  tab: Tab;
  active: boolean;
  onClick(): void;
  onClose(): void;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid={`tab-${tab.id}`}
      onClick={onClick}
      onMouseDown={(e) => {
        if (e.button === 1 && !tab.pinned) {
          e.preventDefault();
          onClose();
        }
      }}
      className={`group flex h-9 min-w-[120px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-2 text-xs
        ${active ? "bg-background" : "bg-muted/40 hover:bg-muted/70"}`}
    >
      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
      <span className={`flex-1 truncate ${tab.preview ? "italic" : ""}`}>{tab.title}</span>
      {tab.dirty ? (
        <span aria-label="저장되지 않음" className="h-1.5 w-1.5 rounded-full bg-foreground" />
      ) : null}
      {tab.pinned ? (
        <Pin aria-label="고정됨" className="h-3 w-3 text-muted-foreground" />
      ) : (
        <button
          aria-label="닫기"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3.3: Commit**

```bash
git add apps/web/src/components/tab-shell/tab-item.tsx \
        apps/web/src/components/tab-shell/tab-item.test.tsx
git commit -m "feat(web): add TabItem row component"
```

---

## Task 4: `TabBar` component with drag-reorder + overflow

**Files:**
- Create: `apps/web/src/components/tab-shell/tab-bar.tsx`
- Create: `apps/web/src/components/tab-shell/tab-overflow-menu.tsx`
- Create: `apps/web/src/components/tab-shell/tab-bar.test.tsx`

- [ ] **Step 4.1: Test the happy path**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabBar } from "./tab-bar";
import { useTabsStore } from "@/stores/tabs-store";

beforeEach(() => {
  localStorage.clear();
  useTabsStore.setState(useTabsStore.getInitialState(), true);
  useTabsStore.getState().setWorkspace("ws-t");
});

describe("TabBar", () => {
  it("renders all active tabs + a new tab button", () => {
    useTabsStore.getState().addTab({
      id: "t1", kind: "note", targetId: "n1", mode: "plate", title: "Alpha",
      pinned: false, preview: false, dirty: false, splitWith: null, splitSide: null, scrollY: 0,
    });
    render(<TabBar />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByLabelText("새 탭")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2: Implement**

```tsx
"use client";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { useTabsStore } from "@/stores/tabs-store";
import { TabItem } from "./tab-item";
import { TabContextMenu } from "./tab-context-menu";
import { TabOverflowMenu } from "./tab-overflow-menu";
import { useUrlTabSync } from "@/hooks/use-url-tab-sync";
import { newTab } from "@/lib/tab-factory";

function SortableTab({ tab, active }: { tab: any; active: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tab.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const { navigateToTab } = useUrlTabSync();
  const closeTab = useTabsStore((s) => s.closeTab);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TabContextMenu tab={tab}>
        <TabItem
          tab={tab}
          active={active}
          onClick={() => navigateToTab({ kind: tab.kind, targetId: tab.targetId }, { mode: "replace" })}
          onClose={() => closeTab(tab.id)}
        />
      </TabContextMenu>
    </div>
  );
}

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const reorderTab = useTabsStore((s) => s.reorderTab);
  const addTab = useTabsStore((s) => s.addTab);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  return (
    <div className="flex h-10 items-stretch border-b border-border" data-testid="tab-bar">
      <div className="flex flex-1 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            const from = tabs.findIndex((t) => t.id === active.id);
            const to = tabs.findIndex((t) => t.id === over.id);
            reorderTab(from, to);
          }}
        >
          <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab) => (
              <SortableTab key={tab.id} tab={tab} active={tab.id === activeId} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <button
        aria-label="새 탭"
        onClick={() =>
          addTab(newTab({ kind: "note", targetId: null, title: "새 노트", preview: false }))
        }
        className="flex h-10 w-10 items-center justify-center border-l border-border hover:bg-accent"
      >
        <Plus className="h-4 w-4" />
      </button>
      <TabOverflowMenu />
    </div>
  );
}
```

- [ ] **Step 4.3: Overflow menu**

```tsx
// apps/web/src/components/tab-shell/tab-overflow-menu.tsx
"use client";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useTabsStore } from "@/stores/tabs-store";
import { useUrlTabSync } from "@/hooks/use-url-tab-sync";

export function TabOverflowMenu() {
  const tabs = useTabsStore((s) => s.tabs);
  const { navigateToTab } = useUrlTabSync();
  if (tabs.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="탭 목록"
        className="flex h-10 w-10 items-center justify-center border-l border-border hover:bg-accent"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
        {tabs.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => navigateToTab({ kind: t.kind, targetId: t.targetId }, { mode: "replace" })}
          >
            <span className={`truncate ${t.preview ? "italic" : ""}`}>{t.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4.4: Commit**

```bash
git add apps/web/src/components/tab-shell/tab-bar.tsx \
        apps/web/src/components/tab-shell/tab-overflow-menu.tsx \
        apps/web/src/components/tab-shell/tab-bar.test.tsx
git commit -m "feat(web): add TabBar with drag-reorder and overflow menu"
```

---

## Task 5: Tab context menu (Pin / Duplicate / Close / Close Others / Close Right / Copy Link)

**Files:**
- Create: `apps/web/src/components/tab-shell/tab-context-menu.tsx`

- [ ] **Step 5.1: Implement**

```tsx
"use client";
import { useParams } from "next/navigation";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useTabsStore } from "@/stores/tabs-store";
import { tabToUrl } from "@/lib/tab-url";
import { newTab } from "@/lib/tab-factory";
import type { Tab } from "@/stores/tabs-store";

export function TabContextMenu({ tab, children }: { tab: Tab; children: React.ReactNode }) {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const togglePin = useTabsStore((s) => s.togglePin);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeOthers = useTabsStore((s) => s.closeOthers);
  const closeRight = useTabsStore((s) => s.closeRight);
  const addTab = useTabsStore((s) => s.addTab);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => togglePin(tab.id)}>
          {tab.pinned ? "고정 해제" : "고정"}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            addTab(newTab({ kind: tab.kind, targetId: tab.targetId, title: tab.title, preview: false }))
          }
        >
          복제
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => closeTab(tab.id)}>닫기</ContextMenuItem>
        <ContextMenuItem onSelect={() => closeOthers(tab.id)}>다른 탭 닫기</ContextMenuItem>
        <ContextMenuItem onSelect={() => closeRight(tab.id)}>오른쪽 탭 닫기</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            const url = tabToUrl(wsSlug, { kind: tab.kind, targetId: tab.targetId });
            navigator.clipboard.writeText(`${location.origin}${url}`);
          }}
        >
          링크 복사
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
git add apps/web/src/components/tab-shell/tab-context-menu.tsx
git commit -m "feat(web): add tab context menu (pin/duplicate/close/copy)"
```

---

## Task 6: Tab keyboard shortcuts (⌘T/W/⇧T/1-9/←→/⌥←→)

**Files:**
- Create: `apps/web/src/hooks/use-tab-keyboard.ts`
- Create: `apps/web/src/hooks/use-tab-keyboard.test.tsx`
- Modify: `apps/web/src/components/shell/shell-providers.tsx` — mount the hook

- [ ] **Step 6.1: Test (sample of 3)**

```tsx
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useTabKeyboard } from "./use-tab-keyboard";
import { useTabsStore } from "@/stores/tabs-store";

beforeEach(() => {
  localStorage.clear();
  useTabsStore.setState(useTabsStore.getInitialState(), true);
  useTabsStore.getState().setWorkspace("ws-k");
});

const add = (id: string) =>
  useTabsStore.getState().addTab({
    id, kind: "note", targetId: id, mode: "plate", title: id,
    pinned: false, preview: false, dirty: false, splitWith: null, splitSide: null, scrollY: 0,
  });

function press(key: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean } = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt }),
  );
}

describe("useTabKeyboard", () => {
  it("Cmd+1 activates first tab", () => {
    add("a"); add("b"); add("c");
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("c");
    act(() => press("1", { meta: true }));
    expect(useTabsStore.getState().activeId).toBe("a");
  });

  it("Cmd+W closes active tab", () => {
    add("a"); add("b");
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("a");
    act(() => press("w", { meta: true }));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["b"]);
  });

  it("Cmd+Right moves to next tab", () => {
    add("a"); add("b"); add("c");
    renderHook(() => useTabKeyboard());
    useTabsStore.getState().setActive("a");
    act(() => press("ArrowRight", { meta: true }));
    expect(useTabsStore.getState().activeId).toBe("b");
  });
});
```

- [ ] **Step 6.2: Implement**

```ts
// apps/web/src/hooks/use-tab-keyboard.ts
"use client";
import { useEffect } from "react";
import { useTabsStore } from "@/stores/tabs-store";

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
}

export function useTabKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const s = useTabsStore.getState();

      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const t = s.tabs[idx];
        if (t) { e.preventDefault(); s.setActive(t.id); }
        return;
      }

      if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        if (s.activeId) { e.preventDefault(); s.closeTab(s.activeId); }
        return;
      }

      if (!e.altKey && e.key === "ArrowRight") {
        const idx = s.tabs.findIndex((t) => t.id === s.activeId);
        const next = s.tabs[idx + 1] ?? s.tabs[0];
        if (next) { e.preventDefault(); s.setActive(next.id); }
        return;
      }

      if (!e.altKey && e.key === "ArrowLeft") {
        const idx = s.tabs.findIndex((t) => t.id === s.activeId);
        const prev = s.tabs[idx - 1] ?? s.tabs[s.tabs.length - 1];
        if (prev) { e.preventDefault(); s.setActive(prev.id); }
        return;
      }

      if (e.altKey && e.key === "ArrowRight") {
        const idx = s.tabs.findIndex((t) => t.id === s.activeId);
        if (idx >= 0 && idx < s.tabs.length - 1) {
          e.preventDefault();
          s.reorderTab(idx, idx + 1);
        }
        return;
      }

      if (e.altKey && e.key === "ArrowLeft") {
        const idx = s.tabs.findIndex((t) => t.id === s.activeId);
        if (idx > 0) {
          e.preventDefault();
          s.reorderTab(idx, idx - 1);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

Also add `⌘T` handler that creates a new empty note tab — use the existing `useKeyboardShortcut` hook in `shell-providers.tsx` for brevity; keyboard-shortcut hooks already cover single chords cleanly.

- [ ] **Step 6.3: Mount in ShellProviders**

```tsx
// shell-providers.tsx — add near the other hooks
useTabKeyboard();
useKeyboardShortcut("mod+t", (e) => {
  e.preventDefault();
  useTabsStore.getState().addTab(newTab({ kind: "note", targetId: null, title: "새 노트", preview: false }));
});
useKeyboardShortcut("mod+shift+t", (e) => {
  e.preventDefault();
  // Task 6.4: closed-tab ring buffer
});
```

- [ ] **Step 6.4: Closed-tab ring buffer for `⌘⇧T`**

Extend `tabs-store`:

```ts
// state
closedStack: Tab[];
// methods
restoreClosed(): void;

// closeTab impl additions:
const next = /* ... */;
const closed = [...s.closedStack, target].slice(-10);
set({ tabs: next, activeId, closedStack: closed });

// restoreClosed impl:
restoreClosed: () => {
  const s = get();
  if (s.closedStack.length === 0) return;
  const last = s.closedStack[s.closedStack.length - 1];
  const nextClosed = s.closedStack.slice(0, -1);
  set({ tabs: [...s.tabs, last], activeId: last.id, closedStack: nextClosed });
  if (s.workspaceId) flush(s.workspaceId, { tabs: [...s.tabs, last], activeId: last.id });
},
```

Wire in `shell-providers.tsx`:
```ts
useKeyboardShortcut("mod+shift+t", (e) => { e.preventDefault(); useTabsStore.getState().restoreClosed(); });
```

Add a unit test for `restoreClosed` in the extensions test file.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/hooks/use-tab-keyboard.ts \
        apps/web/src/hooks/use-tab-keyboard.test.tsx \
        apps/web/src/stores/tabs-store.ts \
        apps/web/src/stores/tabs-store.extensions.test.ts \
        apps/web/src/components/shell/shell-providers.tsx
git commit -m "feat(web): tab keyboard shortcuts and closed-tab restore"
```

---

## Task 7: Preview promotion on edit (sidebar single-click → first onChange)

**Files:**
- Create: `apps/web/src/hooks/use-tab-preview-promotion.ts`
- Create: `apps/web/src/hooks/use-tab-preview-promotion.test.tsx`

- [ ] **Step 7.1: Test**

```tsx
import { renderHook } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useTabPreviewPromotion } from "./use-tab-preview-promotion";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

const previewTab = (id: string): Tab => ({
  id, kind: "note", targetId: "n", mode: "plate", title: "P",
  pinned: false, preview: true, dirty: false, splitWith: null, splitSide: null, scrollY: 0,
});

describe("useTabPreviewPromotion", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-p");
  });

  it("promotes preview tab when onEdit fires", () => {
    useTabsStore.getState().addTab(previewTab("a"));
    const { result } = renderHook(() => useTabPreviewPromotion("a"));
    result.current.onEdit();
    expect(useTabsStore.getState().tabs[0].preview).toBe(false);
  });

  it("is a no-op for non-preview tabs", () => {
    const tab = { ...previewTab("a"), preview: false };
    useTabsStore.getState().addTab(tab);
    const { result } = renderHook(() => useTabPreviewPromotion("a"));
    result.current.onEdit();
    expect(useTabsStore.getState().tabs[0].preview).toBe(false);
  });
});
```

- [ ] **Step 7.2: Implement**

```ts
"use client";
import { useCallback } from "react";
import { useTabsStore } from "@/stores/tabs-store";

export function useTabPreviewPromotion(tabId: string) {
  const promote = useTabsStore((s) => s.promoteFromPreview);
  const onEdit = useCallback(() => {
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId);
    if (tab?.preview) promote(tabId);
  }, [tabId, promote]);
  return { onEdit };
}
```

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/src/hooks/use-tab-preview-promotion.ts \
        apps/web/src/hooks/use-tab-preview-promotion.test.tsx
git commit -m "feat(web): preview tab promotion on first edit"
```

---

## Task 8: `TabModeRouter` + stub viewer

Dispatches `Tab.mode` to the appropriate viewer. Non-core modes render `StubViewer` with the mode label.

**Files:**
- Create: `apps/web/src/components/tab-shell/tab-mode-router.tsx`
- Create: `apps/web/src/components/tab-shell/viewers/stub-viewer.tsx`
- Create: `apps/web/src/components/tab-shell/tab-mode-router.test.tsx`

- [ ] **Step 8.1: Test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabModeRouter } from "./tab-mode-router";

describe("TabModeRouter", () => {
  it("plate mode renders PlateViewer", () => {
    render(<TabModeRouter tab={{ id: "a", kind: "note", targetId: "n1", mode: "plate",
      title: "T", pinned: false, preview: false, dirty: false, splitWith: null, splitSide: null, scrollY: 0 }} />);
    expect(screen.getByTestId("plate-viewer")).toBeInTheDocument();
  });

  it("unknown mode falls back to stub", () => {
    render(<TabModeRouter tab={{ id: "a", kind: "note", targetId: null, mode: "whiteboard" as any,
      title: "T", pinned: false, preview: false, dirty: false, splitWith: null, splitSide: null, scrollY: 0 }} />);
    expect(screen.getByText(/whiteboard.*준비/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8.2: Implement**

```tsx
"use client";
import type { Tab } from "@/stores/tabs-store";
import { PlateViewer } from "./viewers/plate-viewer";
import { ReadingViewer } from "./viewers/reading-viewer";
import { SourceViewer } from "./viewers/source-viewer";
import { DataViewer } from "./viewers/data-viewer";
import { StubViewer } from "./viewers/stub-viewer";

export function TabModeRouter({ tab }: { tab: Tab }) {
  switch (tab.mode) {
    case "plate": return <PlateViewer tab={tab} />;
    case "reading": return <ReadingViewer tab={tab} />;
    case "source": return <SourceViewer tab={tab} />;
    case "data": return <DataViewer tab={tab} />;
    default: return <StubViewer mode={tab.mode} />;
  }
}
```

Stub:
```tsx
"use client";
export function StubViewer({ mode }: { mode: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {mode} 뷰어는 다음 Plan 에서 준비됩니다.
    </div>
  );
}
```

- [ ] **Step 8.3: Commit**

```bash
git add apps/web/src/components/tab-shell/tab-mode-router.tsx \
        apps/web/src/components/tab-shell/viewers/stub-viewer.tsx \
        apps/web/src/components/tab-shell/tab-mode-router.test.tsx
git commit -m "feat(web): add TabModeRouter with stub fallback"
```

---

## Task 9: Plate viewer (integrate existing editor)

Reuses the Plate setup from Plan 2A/2B. Fetches note content by `targetId`, renders the editor, saves via existing Hocuspocus pipeline. Triggers preview promotion on first edit.

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/plate-viewer.tsx`

- [ ] **Step 9.1: Implement**

Locate the existing editor entry (likely `apps/web/src/components/editor/editor.tsx` or similar — check `components/editor/` directory). Wrap it:

```tsx
"use client";
import type { Tab } from "@/stores/tabs-store";
import { Editor } from "@/components/editor/editor"; // adapt to actual path
import { useTabPreviewPromotion } from "@/hooks/use-tab-preview-promotion";

export function PlateViewer({ tab }: { tab: Tab }) {
  const { onEdit } = useTabPreviewPromotion(tab.id);
  if (!tab.targetId) {
    return <div data-testid="plate-viewer" className="p-6 text-sm text-muted-foreground">새 노트를 저장하려면 제목을 입력하세요.</div>;
  }
  return (
    <div data-testid="plate-viewer" className="h-full">
      <Editor noteId={tab.targetId} onChange={onEdit} />
    </div>
  );
}
```

The `Editor` component signature may not already accept `onChange`; add a prop that fires once per change burst, wire it in the existing editor component if needed. Keep the change minimal.

- [ ] **Step 9.2: Commit**

```bash
git add apps/web/src/components/tab-shell/viewers/plate-viewer.tsx \
        apps/web/src/components/editor/
git commit -m "feat(web): plate viewer with preview promotion on first edit"
```

---

## Task 10: Reading viewer

Render Plate value with `readOnly=true` + larger typography + no toolbar. Expose a font-size slider in a floating control.

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/reading-viewer.tsx`

- [ ] **Step 10.1: Implement**

```tsx
"use client";
import { useState } from "react";
import type { Tab } from "@/stores/tabs-store";
import { Editor } from "@/components/editor/editor";

export function ReadingViewer({ tab }: { tab: Tab }) {
  const [size, setSize] = useState(16);
  if (!tab.targetId) return null;
  return (
    <div data-testid="reading-viewer" className="h-full overflow-auto">
      <div className="sticky top-0 flex justify-end gap-2 bg-background/80 p-2 backdrop-blur">
        <span className="text-xs text-muted-foreground">약 N분</span>
        <input
          type="range" min={14} max={22} value={size} onChange={(e) => setSize(Number(e.target.value))}
          aria-label="폰트 크기"
        />
      </div>
      <div style={{ fontSize: `${size}px`, lineHeight: 1.7 }} className="mx-auto max-w-2xl px-6 py-8">
        <Editor noteId={tab.targetId} readOnly />
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Commit**

```bash
git add apps/web/src/components/tab-shell/viewers/reading-viewer.tsx
git commit -m "feat(web): reading mode viewer with font size slider"
```

---

## Task 11: Source viewer (PDF via `react-pdf`)

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/source-viewer.tsx`
- Modify: `apps/web/package.json` — add `react-pdf`, `pdfjs-dist`

- [ ] **Step 11.1: Install**

```bash
pnpm --filter @opencairn/web add react-pdf pdfjs-dist
```

- [ ] **Step 11.2: Implement**

```tsx
"use client";
import { useState, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { Tab } from "@/stores/tabs-store";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function SourceViewer({ tab }: { tab: Tab }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const url = useMemo(() => (tab.targetId ? `/api/sources/${tab.targetId}/file` : null), [tab.targetId]);
  if (!url) return null;

  return (
    <div data-testid="source-viewer" className="h-full overflow-auto bg-neutral-100 p-4">
      <Document file={url} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
        {Array.from({ length: numPages ?? 0 }, (_, i) => (
          <Page key={i} pageNumber={i + 1} className="mx-auto my-2 shadow" />
        ))}
      </Document>
    </div>
  );
}
```

If `/api/sources/:id/file` doesn't exist, search `apps/api/src/routes/sources.ts` (or similar) for the file retrieval endpoint and use whatever it exposes. Same principle as other viewers: don't invent new API routes in this plan unless explicitly called out.

- [ ] **Step 11.3: Commit**

```bash
git add apps/web/src/components/tab-shell/viewers/source-viewer.tsx \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): pdf source viewer using react-pdf"
```

---

## Task 12: Data viewer (JSON tree)

**Files:**
- Create: `apps/web/src/components/tab-shell/viewers/data-viewer.tsx`
- Modify: `apps/web/package.json` — add `react-json-view-lite`

- [ ] **Step 12.1: Install + implement**

```bash
pnpm --filter @opencairn/web add react-json-view-lite
```

```tsx
"use client";
import { JsonView, darkStyles, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import type { Tab } from "@/stores/tabs-store";
import { useQuery } from "@tanstack/react-query";

export function DataViewer({ tab }: { tab: Tab }) {
  const { data } = useQuery({
    queryKey: ["note-data", tab.targetId],
    queryFn: async () => {
      if (!tab.targetId) return null;
      const r = await fetch(`/api/notes/${tab.targetId}/data`);
      if (!r.ok) return null;
      return r.json();
    },
  });
  return (
    <div data-testid="data-viewer" className="h-full overflow-auto p-4 text-sm">
      {data ? <JsonView data={data} style={defaultStyles} /> : <p className="text-muted-foreground">데이터 없음</p>}
    </div>
  );
}
```

- [ ] **Step 12.2: Commit**

```bash
git add apps/web/src/components/tab-shell/viewers/data-viewer.tsx \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): data mode viewer using react-json-view-lite"
```

---

## Task 13: `TabShell` assembly + swap placeholder

**Files:**
- Create: `apps/web/src/components/tab-shell/tab-shell.tsx`
- Modify: `apps/web/src/components/shell/app-shell.tsx`

- [ ] **Step 13.1: Implement**

```tsx
// apps/web/src/components/tab-shell/tab-shell.tsx
"use client";
import { useTabsStore } from "@/stores/tabs-store";
import { TabBar } from "./tab-bar";
import { TabModeRouter } from "./tab-mode-router";

export function TabShell({ children }: { children: React.ReactNode }) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId);

  return (
    <main data-testid="app-shell-main" className="flex min-h-0 flex-1 flex-col bg-background">
      <TabBar />
      <div className="flex-1 overflow-auto">
        {active ? <TabModeRouter tab={active} /> : children}
      </div>
    </main>
  );
}
```

Note: `children` is kept as a fallback so route-level pages (e.g., dashboard) still render when no tab is active or for kinds that have their own page-level content outside the `TabModeRouter` matrix (dashboard/project/research_hub — those use route pages, not mode viewers).

- [ ] **Step 13.2: Swap in AppShell**

Replace `PlaceholderTabShell` import/usage with `TabShell`.

- [ ] **Step 13.3: Commit**

```bash
git add apps/web/src/components/tab-shell/tab-shell.tsx \
        apps/web/src/components/shell/app-shell.tsx
git commit -m "feat(web): assemble TabShell and swap into AppShell"
```

---

## Task 14: E2E tab system coverage

**Files:**
- Create: `apps/web/tests/e2e/tab-system.spec.ts`

- [ ] **Step 14.1: Spec**

```ts
import { test, expect } from "@playwright/test";
import { loginAsTestUser, seedWorkspaceWithNotes } from "./helpers";

test.describe("Tab System", () => {
  test.beforeEach(async ({ page }) => loginAsTestUser(page));

  test("sidebar single click opens preview tab, double click promotes", async ({ page }) => {
    const { slug, noteIds } = await seedWorkspaceWithNotes({ count: 3 });
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByRole("treeitem", { name: new RegExp("노트 1") }).click();
    const preview = page.locator('[data-testid^="tab-"]').first();
    await expect(preview).toHaveClass(/italic/);
    await page.getByRole("treeitem", { name: new RegExp("노트 1") }).dblclick();
    await expect(preview).not.toHaveClass(/italic/);
  });

  test("preview is replaced by next single click", async ({ page }) => {
    const { slug } = await seedWorkspaceWithNotes({ count: 3 });
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByRole("treeitem", { name: /노트 1/ }).click();
    await page.getByRole("treeitem", { name: /노트 2/ }).click();
    const tabs = page.locator('[data-testid^="tab-"]');
    await expect(tabs).toHaveCount(1);
  });

  test("Cmd+W closes active tab", async ({ page }) => {
    const { slug } = await seedWorkspaceWithNotes({ count: 3 });
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByRole("treeitem", { name: /노트 1/ }).dblclick();
    await page.keyboard.press("Control+w");
    await expect(page.locator('[data-testid^="tab-"]')).toHaveCount(0);
  });

  test("Cmd+T opens new blank tab", async ({ page }) => {
    const { slug } = await seedWorkspaceWithNotes({ count: 0 });
    await page.goto(`/ko/app/w/${slug}/`);
    await page.keyboard.press("Control+t");
    await expect(page.locator('[data-testid^="tab-"]')).toHaveCount(1);
  });

  test("drag reorders tabs", async ({ page }) => {
    const { slug } = await seedWorkspaceWithNotes({ count: 3 });
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByRole("treeitem", { name: /노트 1/ }).dblclick();
    await page.getByRole("treeitem", { name: /노트 2/ }).dblclick();
    const first = page.locator('[data-testid^="tab-"]').nth(0);
    const second = page.locator('[data-testid^="tab-"]').nth(1);
    await first.dragTo(second);
    const names = await page.locator('[data-testid^="tab-"] span').allInnerTexts();
    expect(names[0]).toMatch(/노트 2/);
  });

  test("pin hides close button, Cmd+W no-op on pinned", async ({ page }) => {
    const { slug } = await seedWorkspaceWithNotes({ count: 1 });
    await page.goto(`/ko/app/w/${slug}/`);
    await page.getByRole("treeitem", { name: /노트 1/ }).dblclick();
    await page.locator('[data-testid^="tab-"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: "고정" }).click();
    await expect(page.getByLabel("닫기")).toHaveCount(0);
    await page.keyboard.press("Control+w");
    await expect(page.locator('[data-testid^="tab-"]')).toHaveCount(1);
  });
});
```

- [ ] **Step 14.2: Commit**

```bash
git add apps/web/tests/e2e/tab-system.spec.ts
git commit -m "test(web): e2e tab system (preview, keyboard, drag, pin)"
```

---

## Task 15: Post-feature check

- [ ] **Step 15.1: Run checks**

```bash
pnpm --filter @opencairn/web typecheck
pnpm --filter @opencairn/web lint
pnpm --filter @opencairn/web test
pnpm --filter @opencairn/web test:e2e -g "Tab System"
pnpm --filter @opencairn/web i18n:parity
```

- [ ] **Step 15.2: Plans-status + memory**

Update `docs/contributing/plans-status.md` and write `project_plan_app_shell_phase_3_complete.md`.

- [ ] **Step 15.3: Commit**

```bash
git add docs/contributing/plans-status.md
git commit -m "docs(docs): mark app shell phase 3 complete"
```

---

## Completion Criteria

- [ ] Tab bar renders, drag reorders, overflow menu lists hidden tabs
- [ ] Preview mode works: sidebar single click → replace current preview / double click → promote / edit → promote
- [ ] `⌘T/⌘W/⌘⇧T/⌘1-9/⌘←→/⌘⌥←→` all wired
- [ ] Context menu: Pin/Duplicate/Close/Close Others/Close Right/Copy Link
- [ ] `TabModeRouter` dispatches; 4 core viewers render (plate, reading, source, data); other modes show "준비 중" stub
- [ ] E2E tab-system spec passes
- [ ] Manual smoke: click note → preview tab italic → type in editor → italic removes → right-click → Pin → Close button gone → `⌘W` no-op

## What's NOT in this plan

| Item | Phase |
|------|-------|
| Split pane (`⌘⇧\`) | dedicated follow-up; drop in Phase 5 or separate plan |
| `artifact`, `presentation`, `spreadsheet`, `whiteboard`, `canvas`, `mindmap`, `flashcard` viewers | Plan 10 (Document Studio), Plan 5/6/7, Plan 10B |
| `diff` viewer | depends on AI pipeline (Plan 4 SSE) |
| Agent panel, threads, composer | Phase 4 |
| Dashboard/project/research hubs, palette, notifications | Phase 5 |
