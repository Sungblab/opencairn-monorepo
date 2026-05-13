"use client";

import type { CSSProperties, HTMLAttributes, Ref } from "react";
import type { Tab } from "@/stores/tabs-store";
import { useTabActions } from "@/hooks/use-tab-actions";
import { TabItem } from "./tab-item";
import type { TabListProps } from "./tab-list-types";

interface TabListItemProps {
  tab: Tab;
  active: boolean;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  containerProps?: HTMLAttributes<HTMLDivElement>;
}

export function TabListItem({
  tab,
  active,
  containerRef,
  containerStyle,
  containerProps,
}: TabListItemProps) {
  const tabActions = useTabActions();

  return (
    <div {...containerProps} ref={containerRef} style={containerStyle}>
      <TabItem
        tab={tab}
        active={active}
        onClick={() => tabActions.activateTab(tab)}
        onClose={() => tabActions.closeTab(tab.id)}
      />
    </div>
  );
}

export function StaticTabList({ tabs, activeId }: TabListProps) {
  return (
    <>
      {tabs.map((tab) => (
        <TabListItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
        />
      ))}
    </>
  );
}
