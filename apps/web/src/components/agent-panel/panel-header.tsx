"use client";

// Top bar of the agent panel. Three actions live here: spawn a new thread,
// browse existing threads via a dropdown, and collapse the whole panel.
// Collapse goes through usePanelStore (user-global) — width and openness are
// persisted there so other shell pieces can react without a parent prop drill.
// Every visible string and icon-only button label routes through next-intl
// because eslint-plugin-i18next blocks raw literals in JSX text plus the
// aria-label/title/placeholder/alt attributes.

import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePanelStore } from "@/stores/panel-store";

import { ThreadList } from "./thread-list";

export function PanelHeader({ onNewThread }: { onNewThread(): void }) {
  const t = useTranslations("agentPanel.header");
  const togglePanel = usePanelStore((s) => s.toggleAgentPanel);

  return (
    <div className="flex h-10 items-center justify-between border-b border-border px-3">
      <span className="text-sm font-semibold">{t("title")}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t("new_thread_aria")}
          onClick={onNewThread}
          className="rounded p-1 hover:bg-accent"
        >
          <Plus className="h-4 w-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("thread_list_aria")}
            className="rounded p-1 hover:bg-accent"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 p-0">
            <ThreadList />
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={t("collapse_aria")}
          onClick={togglePanel}
          className="rounded p-1 hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
