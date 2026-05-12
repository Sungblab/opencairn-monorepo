"use client";

import { lazy, Suspense, useCallback, useState } from "react";
import type { PointerEvent } from "react";
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
  const [openOnLoad, setOpenOnLoad] = useState(false);
  const requestMenu = useCallback((openAfterLoad: boolean) => {
    setMenuRequested(true);
    if (openAfterLoad) setOpenOnLoad(true);
  }, []);

  if (tabsLength === 0) return null;

  return menuRequested ? (
    <Suspense fallback={<TabOverflowMenuFallback />}>
      <LazyTabOverflowMenu initialOpen={openOnLoad} />
    </Suspense>
  ) : (
    <TabOverflowMenuTrigger
      onPreload={() => requestMenu(false)}
      onOpenRequest={() => requestMenu(true)}
    />
  );
}

function TabOverflowMenuFallback() {
  return <TabOverflowMenuTrigger disabled />;
}

function TabOverflowMenuTrigger({
  disabled = false,
  onPreload,
  onOpenRequest,
}: {
  disabled?: boolean;
  onPreload?: () => void;
  onOpenRequest?: () => void;
}) {
  const { tabs: labels } = useShellLabels();
  const handlePointerEnter = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== "touch") onPreload?.();
    },
    [onPreload],
  );

  return (
    <button
      type="button"
      aria-label={labels.bar.overflowTrigger}
      data-testid="tab-overflow-trigger"
      disabled={disabled}
      onPointerEnter={handlePointerEnter}
      onFocus={onPreload}
      onClick={onOpenRequest}
      className={`flex h-10 w-10 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors ${
        disabled ? "opacity-70" : "hover:bg-accent hover:text-foreground"
      }`}
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
}
