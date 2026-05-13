"use client";
import { Check, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { useTabActions } from "@/hooks/use-tab-actions";
import { useResolvedTabTitle } from "@/lib/resolve-tab-title";
import { cn } from "@/lib/utils";

// Companion to TabBar: renders a `⋯` trigger that lists every currently
// open tab so the user can jump to tabs that have scrolled off-screen.
// Deliberately separate from TabBar so the tab list scrolls horizontally
// on its own axis while this button stays pinned to the right edge.

// Extracted row component so each item can call `useResolvedTabTitle`
// individually — hooks can't be called inside a `.map()` body.
function TabOverflowItem({
  tab,
  active,
  onSelect,
}: {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
}) {
  const title = useResolvedTabTitle(tab);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={`flex min-h-9 w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none ${
        active
          ? "bg-foreground/10 text-popover-foreground"
          : "text-popover-foreground hover:bg-foreground/10 focus-visible:bg-foreground/10"
      }`}
    >
      <span
        className={cn(
          "block min-w-0 flex-1 truncate",
          tab.preview && "italic text-muted-foreground",
        )}
        title={title}
      >
        {title}
      </span>
      {active ? (
        <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
}

export function TabOverflowMenu({
  initialOpen = false,
}: {
  initialOpen?: boolean;
}) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const tabActions = useTabActions();
  const t = useTranslations("appShell.tabs.bar");
  const menuWidth = useMemo(() => {
    const longestTitle = Math.max(
      t("overflowTitle").length,
      ...tabs.map((tab) => (tab.title || "").length),
    );
    return `clamp(14rem, ${Math.min(Math.max(longestTitle + 4, 18), 36)}ch, calc(100vw - 16px))`;
  }, [tabs, t]);

  if (tabs.length === 0) return null;

  return (
    <DropdownMenu defaultOpen={initialOpen}>
      <DropdownMenuTrigger
        aria-label={t("overflowTrigger")}
        data-testid="tab-overflow-trigger"
        className="flex h-10 w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={2}
        className="max-w-[calc(100vw-16px)] overflow-hidden rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        style={{ width: menuWidth }}
      >
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("overflowTitle")}
          </p>
        </div>
        <div
          role="listbox"
          aria-label={t("overflowTitle")}
          className="grid gap-1 p-2"
        >
          {tabs.map((tab) => (
            <TabOverflowItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onSelect={() => tabActions.activateTab(tab)}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
