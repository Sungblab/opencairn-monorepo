"use client";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTabsStore } from "@/stores/tabs-store";
import { useTabNavigate } from "@/hooks/use-tab-navigate";

// Companion to TabBar: renders a `⋯` trigger that lists every currently
// open tab so the user can jump to tabs that have scrolled off-screen.
// Deliberately separate from TabBar so the tab list scrolls horizontally
// on its own axis while this button stays pinned to the right edge.
export function TabOverflowMenu() {
  const tabs = useTabsStore((s) => s.tabs);
  const navigateToTab = useTabNavigate();
  const t = useTranslations("appShell.tabs.bar");

  if (tabs.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("overflowTrigger")}
        data-testid="tab-overflow-trigger"
        className="flex h-10 w-10 shrink-0 items-center justify-center border-l border-border text-muted-foreground hover:bg-accent"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-56 overflow-auto"
      >
        {tabs.map((tab) => (
          <DropdownMenuItem
            key={tab.id}
            onSelect={() =>
              navigateToTab(
                { kind: tab.kind, targetId: tab.targetId },
                { mode: "replace" },
              )
            }
          >
            <span
              className={`truncate ${tab.preview ? "italic" : ""}`}
              title={tab.title}
            >
              {tab.title}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
