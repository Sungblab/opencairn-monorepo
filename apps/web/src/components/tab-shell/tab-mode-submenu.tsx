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
import { useTabNavigate } from "@/hooks/use-tab-navigate";

// The four modes a user can explicitly pick from the tab's context menu.
// Other modes (diff, artifact, presentation, spreadsheet, whiteboard,
// canvas, mindmap, flashcard) are entered via their dedicated feature
// flows — exposing them here would be confusing because most of them
// aren't valid for every tab kind.
const MODES: TabMode[] = ["plate", "reading", "source", "data", "canvas"];

export function TabModeSubmenu({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.tabs.menu.mode");
  const updateTab = useTabsStore((s) => s.updateTab);
  const navigateToTab = useTabNavigate();
  if (tab.kind !== "note") return null;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{t("trigger")}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup
          value={tab.mode}
          onValueChange={(v) => {
            const mode = v as TabMode;
            updateTab(tab.id, { mode });
            navigateToTab(
              { kind: "note", targetId: tab.targetId, mode },
              { mode: "replace" },
            );
          }}
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
