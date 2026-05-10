"use client";

import type { CSSProperties, HTMLAttributes, Ref } from "react";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { useTabNavigate } from "@/hooks/use-tab-navigate";
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
  const navigateToTab = useTabNavigate();
  const closeTab = useTabsStore((s) => s.closeTab);
  const setActive = useTabsStore((s) => s.setActive);
  const isTransient =
    tab.kind === "ingest" ||
    tab.kind === "lit_search" ||
    tab.kind === "agent_file" ||
    tab.kind === "code_workspace";

  return (
    <div {...containerProps} ref={containerRef} style={containerStyle}>
      <TabItem
        tab={tab}
        active={active}
        onClick={() => {
          if (isTransient) {
            setActive(tab.id);
            return;
          }
          navigateToTab(
            { kind: tab.kind, targetId: tab.targetId, mode: tab.mode },
            { mode: "replace" },
          );
        }}
        onClose={() => closeTab(tab.id)}
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
