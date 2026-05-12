"use client";
import { Check, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { useTabNavigate } from "@/hooks/use-tab-navigate";
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
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn(
        "h-9 cursor-pointer gap-2 px-2.5 text-[13px] hover:bg-accent hover:text-accent-foreground",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          tab.preview && "italic text-muted-foreground",
        )}
        title={title}
      >
        {title}
      </span>
      {active ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0" /> : null}
    </DropdownMenuItem>
  );
}

export function TabOverflowMenu({
  initialOpen = false,
}: {
  initialOpen?: boolean;
}) {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const navigateToTab = useTabNavigate();
  const t = useTranslations("appShell.tabs.bar");

  if (tabs.length === 0) return null;

  return (
    <DropdownMenu defaultOpen={initialOpen}>
      <DropdownMenuTrigger
        aria-label={t("overflowTrigger")}
        data-testid="tab-overflow-trigger"
        className="flex h-10 w-10 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="max-h-80 w-64 max-w-[calc(100vw-24px)] overflow-auto rounded-[var(--radius-control)] p-1.5 shadow-lg ring-1 ring-foreground/10"
      >
        {tabs.map((tab) => (
          <TabOverflowItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onSelect={() =>
              navigateToTab(
                { kind: tab.kind, targetId: tab.targetId, mode: tab.mode },
                { mode: "replace" },
              )
            }
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
