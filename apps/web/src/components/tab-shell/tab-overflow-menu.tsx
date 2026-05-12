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
        "h-8 cursor-pointer gap-2 px-2 text-sm leading-none hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
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
        className="flex h-10 w-9 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={2}
        className="max-h-72 overflow-auto rounded-md border border-border bg-popover p-1 shadow-md ring-0"
        style={{ width: 240, maxWidth: "calc(100vw - 16px)" }}
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
