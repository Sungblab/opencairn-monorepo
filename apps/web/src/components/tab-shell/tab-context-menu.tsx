"use client";
import { useTranslations } from "next-intl";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { newTab } from "@/lib/tab-factory";
import { tabToUrl } from "@/lib/tab-url";
import { TabModeSubmenu } from "./tab-mode-submenu";

export interface TabContextMenuItemsProps {
  tab: Tab;
  wsSlug: string;
}

// Items-only fragment — caller wraps with
// <ContextMenu><ContextMenuTrigger asChild>…</…>. Matches the pattern used
// by sidebar tree-context-menu so callers don't have to hoist a refs chain
// for the trigger.
export function TabContextMenuItems({ tab, wsSlug }: TabContextMenuItemsProps) {
  const t = useTranslations("appShell.tabs.menu");
  const togglePin = useTabsStore((s) => s.togglePin);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeOthers = useTabsStore((s) => s.closeOthers);
  const closeRight = useTabsStore((s) => s.closeRight);
  const addTab = useTabsStore((s) => s.addTab);

  const duplicate = () =>
    addTab(
      newTab({
        kind: tab.kind,
        targetId: tab.targetId,
        title: tab.title,
        preview: false,
      }),
    );

  const copyLink = () => {
    if (typeof navigator === "undefined") return;
    if (!navigator.clipboard) return;
    const path = tabToUrl(wsSlug, {
      kind: tab.kind,
      targetId: tab.targetId,
    });
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    void navigator.clipboard.writeText(`${origin}${path}`);
  };

  return (
    <>
      <ContextMenuItem onClick={() => togglePin(tab.id)}>
        {tab.pinned ? t("unpin") : t("pin")}
      </ContextMenuItem>
      <ContextMenuItem onClick={duplicate}>{t("duplicate")}</ContextMenuItem>
      <ContextMenuSeparator />
      <TabModeSubmenu tab={tab} />
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => closeTab(tab.id)} disabled={tab.pinned}>
        {t("close")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => closeOthers(tab.id)}>
        {t("closeOthers")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => closeRight(tab.id)}>
        {t("closeRight")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={copyLink}>{t("copyLink")}</ContextMenuItem>
    </>
  );
}
