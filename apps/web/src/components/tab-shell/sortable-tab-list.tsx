"use client";

import type { HTMLAttributes } from "react";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { TabListItem } from "./static-tab-list";
import type { TabListProps } from "./tab-list-types";
import { TabContextMenuItems } from "./tab-context-menu";

export type SortableTabListProps = TabListProps;

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

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={(props) => (
          <TabListItem
            tab={tab}
            active={active}
            containerRef={setNodeRef}
            containerStyle={{
              transform: CSS.Transform.toString(transform),
              transition,
              opacity: isDragging ? 0.6 : 1,
            }}
            containerProps={
              {
                ...props,
                ...attributes,
                ...listeners,
              } as HTMLAttributes<HTMLDivElement>
            }
          />
        )}
      />
      <ContextMenuContent>
        <TabContextMenuItems tab={tab} wsSlug={wsSlug} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SortableTabList({
  tabs,
  activeId,
  wsSlug,
}: SortableTabListProps) {
  const reorderTab = useTabsStore((s) => s.reorderTab);

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
  );
}
