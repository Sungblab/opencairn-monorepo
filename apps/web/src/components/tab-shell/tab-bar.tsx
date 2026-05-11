"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { useTabsStore } from "@/stores/tabs-store";
import { newTab } from "@/lib/tab-factory";
import { useShellLabels } from "@/components/shell/shell-labels";
import { StaticTabListLoader } from "./static-tab-list-loader";
import { SortableTabListLoader } from "./sortable-tab-list-loader";
import { TabOverflowMenuLoader } from "./tab-overflow-menu-loader";

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const addTab = useTabsStore((s) => s.addTab);
  const { tabs: labels } = useShellLabels();
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
      <button
        type="button"
        aria-label={labels.bar.newTab}
        data-testid="tab-bar-new"
        onClick={() =>
          addTab(
            newTab({
              kind: "note",
              targetId: null,
              title: labels.bar.newTabTitle,
              preview: false,
            }),
          )
        }
        className="app-btn-ghost flex h-10 w-10 shrink-0 items-center justify-center border-l border-border text-muted-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
      <TabOverflowMenuLoader />
    </div>
  );
}
