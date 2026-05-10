"use client";

import { lazy, Suspense, useCallback, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useShellLabels } from "@/components/shell/shell-labels";
import { useTabsStore } from "@/stores/tabs-store";

const LazyTabOverflowMenu = lazy(() =>
  import("./tab-overflow-menu").then((mod) => ({
    default: mod.TabOverflowMenu,
  })),
);

export function TabOverflowMenuLoader() {
  const tabsLength = useTabsStore((s) => s.tabs.length);
  const [menuRequested, setMenuRequested] = useState(false);
  const requestMenu = useCallback(() => setMenuRequested(true), []);

  if (tabsLength === 0) return null;

  return menuRequested ? (
    <Suspense fallback={<TabOverflowMenuFallback />}>
      <LazyTabOverflowMenu />
    </Suspense>
  ) : (
    <TabOverflowMenuTrigger onRequest={requestMenu} />
  );
}

function TabOverflowMenuFallback() {
  return <TabOverflowMenuTrigger disabled />;
}

function TabOverflowMenuTrigger({
  disabled = false,
  onRequest,
}: {
  disabled?: boolean;
  onRequest?: () => void;
}) {
  const { tabs: labels } = useShellLabels();

  return (
    <button
      type="button"
      aria-label={labels.bar.overflowTrigger}
      data-testid="tab-overflow-trigger"
      disabled={disabled}
      onPointerEnter={onRequest}
      onFocus={onRequest}
      onClick={onRequest}
      className={`flex h-10 w-10 shrink-0 items-center justify-center border-l border-border text-muted-foreground ${
        disabled ? "opacity-70" : "hover:bg-accent"
      }`}
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
}
