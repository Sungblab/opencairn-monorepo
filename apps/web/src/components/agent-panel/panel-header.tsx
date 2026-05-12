"use client";

// Top bar of the agent panel. Three actions live here: spawn a new thread,
// browse existing threads via a dropdown, and collapse the whole panel.
// Collapse goes through usePanelStore (user-global) — width and openness are
// persisted there so other shell pieces can react without a parent prop drill.
// Every visible string and icon-only button label routes through next-intl
// because eslint-plugin-i18next blocks raw literals in JSX text plus the
// aria-label/title/placeholder/alt attributes.

import { ChevronRight, History, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePanelStore } from "@/stores/panel-store";

import { ThreadList } from "./thread-list";

export function PanelHeader({
  onNewThread,
  newThreadDisabled,
}: {
  onNewThread(): void;
  newThreadDisabled?: boolean;
}) {
  const t = useTranslations("agentPanel.header");
  const togglePanel = usePanelStore((s) => s.toggleAgentPanel);

  return (
    <div className="flex min-h-10 items-center justify-between border-b border-border bg-background/70 px-3">
      <div>
        <span className="text-sm font-semibold">{t("title")}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={t("new_thread_aria")}
          onClick={onNewThread}
          disabled={newThreadDisabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          {t("new_thread")}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("thread_list_aria")}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
          >
            <History aria-hidden className="h-3.5 w-3.5" />
            {t("history")}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="!w-72 max-w-[calc(100vw-16px)] overflow-hidden rounded-md border border-border bg-popover p-0 shadow-md ring-0"
          >
            <ThreadList />
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={t("collapse_aria")}
          onClick={togglePanel}
          className="app-btn-ghost inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
