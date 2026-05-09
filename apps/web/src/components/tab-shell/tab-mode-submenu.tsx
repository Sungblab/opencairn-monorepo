"use client";
import { useTranslations } from "next-intl";
import {
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
} from "@/components/ui/context-menu";
import { useTabsStore, type Tab, type TabMode } from "@/stores/tabs-store";

// The four modes a user can explicitly pick from the tab's context menu.
// Other modes (diff, artifact, presentation, spreadsheet, whiteboard,
// canvas, mindmap, flashcard) are entered via their dedicated feature
// flows — exposing them here would be confusing because most of them
// aren't valid for every tab kind.
const MODES: TabMode[] = ["plate", "reading", "source", "data", "canvas"];

export function TabModeSubmenu({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.tabs.menu.mode");
  const updateTab = useTabsStore((s) => s.updateTab);
  if (tab.kind !== "note") return null;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{t("trigger")}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup
          value={tab.mode}
          onValueChange={(v) => updateTab(tab.id, { mode: v as TabMode })}
        >
          {MODES.map((m) => (
            <ContextMenuRadioItem key={m} value={m}>
              {t(`options.${m}`)}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
