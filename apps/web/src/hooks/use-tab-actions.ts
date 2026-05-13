"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { useTabNavigate } from "@/hooks/use-tab-navigate";
import { urlToTabTarget } from "@/lib/tab-url";

const transientKinds = new Set<Tab["kind"]>([
  "ingest",
  "lit_search",
]);

export function isTransientTab(tab: Pick<Tab, "kind">): boolean {
  return transientKinds.has(tab.kind);
}

function routeMatchesTab(pathname: string | null, tab: Tab | undefined): boolean {
  if (!pathname || !tab || isTransientTab(tab)) return false;
  const parsed = urlToTabTarget(pathname);
  if (!parsed) return false;
  const route = parsed.route;
  if (route.kind !== tab.kind || route.targetId !== tab.targetId) return false;
  return route.mode ? route.mode === tab.mode : tab.mode === "plate";
}

export function useTabActions() {
  const navigateToTab = useTabNavigate();
  const pathname = usePathname();

  const activateTab = useCallback(
    (tab: Tab) => {
      useTabsStore.getState().setActive(tab.id);
      if (isTransientTab(tab)) {
        return;
      }
      navigateToTab(
        { kind: tab.kind, targetId: tab.targetId, mode: tab.mode },
        { mode: "replace" },
      );
    },
    [navigateToTab],
  );

  const activateCurrent = useCallback(() => {
    const state = useTabsStore.getState();
    const tab = state.tabs.find((candidate) => candidate.id === state.activeId);
    if (tab) {
      activateTab(tab);
      return;
    }
    navigateToTab({ kind: "dashboard", targetId: null }, { mode: "replace" });
  }, [activateTab, navigateToTab]);

  const closeTab = useCallback(
    (id: string) => {
      const before = useTabsStore.getState();
      const wasActive = before.activeId === id;
      const closedTab = before.tabs.find((tab) => tab.id === id);
      const ownedCurrentRoute = routeMatchesTab(pathname, closedTab);
      before.closeTab(id);
      if (wasActive || ownedCurrentRoute) activateCurrent();
    },
    [activateCurrent, pathname],
  );

  const closeOthers = useCallback(
    (keepId: string) => {
      useTabsStore.getState().closeOthers(keepId);
      activateCurrent();
    },
    [activateCurrent],
  );

  const closeRight = useCallback(
    (id: string) => {
      const before = useTabsStore.getState();
      const activeBefore = before.activeId;
      const pivotIdx = before.tabs.findIndex((tab) => tab.id === id);
      const ownedCurrentRoute =
        pivotIdx >= 0 &&
        before.tabs
          .slice(pivotIdx + 1)
          .some((tab) => !tab.pinned && routeMatchesTab(pathname, tab));
      useTabsStore.getState().closeRight(id);
      if (useTabsStore.getState().activeId !== activeBefore || ownedCurrentRoute) {
        activateCurrent();
      }
    },
    [activateCurrent, pathname],
  );

  const restoreClosed = useCallback(() => {
    const before = useTabsStore.getState().activeId;
    useTabsStore.getState().restoreClosed();
    if (useTabsStore.getState().activeId !== before) activateCurrent();
  }, [activateCurrent]);

  const closeActiveSplitPane = useCallback(() => {
    const before = useTabsStore.getState().activeId;
    useTabsStore.getState().closeActiveSplitPane();
    if (useTabsStore.getState().activeId !== before) activateCurrent();
  }, [activateCurrent]);

  return {
    activateTab,
    closeTab,
    closeOthers,
    closeRight,
    restoreClosed,
    closeActiveSplitPane,
  };
}
