"use client";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { useTabNavigate } from "@/hooks/use-tab-navigate";
import { newTab } from "@/lib/tab-factory";
import { TabItem } from "./tab-item";
import { TabContextMenuItems } from "./tab-context-menu";
import { TabOverflowMenu } from "./tab-overflow-menu";

// Each sortable row is a thin wrapper that binds @dnd-kit's transform
// so drag-to-reorder moves the row visually while the drop handler in
// `TabBar` updates the store. `attributes` + `listeners` are applied to
// the row wrapper (not TabItem itself) so PointerSensor activation won't
// compete with the middle-click close handler inside TabItem.
function SortableTab({
  tab,
  active,
  wsSlug,
}: {
  tab: Tab;
  active: boolean;
  wsSlug: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });
  const navigateToTab = useTabNavigate();
  const closeTab = useTabsStore((s) => s.closeTab);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={(props) => (
          <div
            {...props}
            ref={setNodeRef}
            style={{
              transform: CSS.Transform.toString(transform),
              transition,
              opacity: isDragging ? 0.6 : 1,
            }}
            {...attributes}
            {...listeners}
          >
            <TabItem
              tab={tab}
              active={active}
              onClick={() =>
                navigateToTab(
                  { kind: tab.kind, targetId: tab.targetId, mode: tab.mode },
                  { mode: "replace" },
                )
              }
              onClose={() => closeTab(tab.id)}
            />
          </div>
        )}
      />
      <ContextMenuContent>
        <TabContextMenuItems tab={tab} wsSlug={wsSlug} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const reorderTab = useTabsStore((s) => s.reorderTab);
  const addTab = useTabsStore((s) => s.addTab);
  const t = useTranslations("appShell.tabs.bar");
  const params = useParams<{ wsSlug?: string }>();
  const wsSlug = params?.wsSlug ?? "";

  // distance=4 means a 4px drag is required before sort activates — lets a
  // simple click pass through to TabItem.onClick without starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = tabs.findIndex((x) => x.id === active.id);
    const to = tabs.findIndex((x) => x.id === over.id);
    if (from < 0 || to < 0) return;
    reorderTab(from, to);
  };

  return (
    <div
      role="tablist"
      data-testid="tab-bar"
      className="flex h-10 shrink-0 items-stretch border-b border-border bg-surface"
    >
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={tabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                active={tab.id === activeId}
                wsSlug={wsSlug}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <button
        type="button"
        aria-label={t("newTab")}
        data-testid="tab-bar-new"
        onClick={() =>
          addTab(
            newTab({
              kind: "note",
              targetId: null,
              title: t("newTabTitle"),
              preview: false,
            }),
          )
        }
        className="app-btn-ghost flex h-10 w-10 shrink-0 items-center justify-center border-l border-border text-muted-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
      <TabOverflowMenu />
    </div>
  );
}
