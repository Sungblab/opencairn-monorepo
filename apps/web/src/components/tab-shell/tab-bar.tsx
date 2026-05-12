"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { useTabsStore } from "@/stores/tabs-store";
import { StaticTabListLoader } from "./static-tab-list-loader";
import { SortableTabListLoader } from "./sortable-tab-list-loader";
import { TabOverflowMenuLoader } from "./tab-overflow-menu-loader";

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const params = useParams<{ wsSlug?: string }>();
  const wsSlug = params?.wsSlug ?? "";
  const [sortingReady, setSortingReady] = useState(false);

  const requestSorting = useCallback(() => {
    setSortingReady(true);
  }, []);

  return (
    <div
      role="tablist"
      data-testid="tab-bar"
      className="flex h-10 shrink-0 items-stretch border-b border-border bg-surface"
    >
      <div
        className="app-scrollbar-thin flex min-w-0 flex-1 overflow-x-auto"
        onPointerEnter={requestSorting}
        onFocusCapture={requestSorting}
      >
        {sortingReady ? (
          <SortableTabListLoader
            tabs={tabs}
            activeId={activeId}
            wsSlug={wsSlug}
          />
        ) : (
          <StaticTabListLoader
            tabs={tabs}
            activeId={activeId}
            wsSlug={wsSlug}
          />
        )}
      </div>
      <TabOverflowMenuLoader />
    </div>
  );
}
