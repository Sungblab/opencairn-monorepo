"use client";
import { useLocale, useTranslations } from "next-intl";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useTabsStore, type Tab } from "@/stores/tabs-store";
import { useTabActions } from "@/hooks/use-tab-actions";
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
  const locale = useLocale();
  const togglePin = useTabsStore((s) => s.togglePin);
  const duplicateTab = useTabsStore((s) => s.duplicateTab);
  const openTabToRight = useTabsStore((s) => s.openTabToRight);
  const openTabBelow = useTabsStore((s) => s.openTabBelow);
  const tabActions = useTabActions();

  const duplicate = () =>
    duplicateTab(
      newTab({
        kind: tab.kind,
        targetId: tab.targetId,
        title: tab.title,
        mode: tab.mode,
        preview: false,
      }),
    );

  const openToRight = () =>
    openTabToRight(
      newTab({
        kind: tab.kind,
        targetId: tab.targetId,
        title: tab.title,
        mode: tab.kind === "note" && tab.mode === "plate" ? "reading" : tab.mode,
        preview: false,
      }),
    );

  const openBelow = () =>
    openTabBelow(
      newTab({
        kind: tab.kind,
        targetId: tab.targetId,
        title: tab.title,
        mode: tab.kind === "note" && tab.mode === "plate" ? "reading" : tab.mode,
        preview: false,
      }),
    );

  const copyLink = () => {
    if (typeof navigator === "undefined") return;
    if (!navigator.clipboard) return;
    const path = tabToUrl(
      wsSlug,
      {
        kind: tab.kind,
        targetId: tab.targetId,
        mode: tab.mode,
      },
      locale,
    );
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
      <ContextMenuItem onClick={openToRight}>
        {t("openToRight")}
      </ContextMenuItem>
      <ContextMenuItem onClick={openBelow}>{t("openBelow")}</ContextMenuItem>
      <ContextMenuSeparator />
      <TabModeSubmenu tab={tab} />
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() => tabActions.closeTab(tab.id)}
        disabled={tab.pinned}
      >
        {t("close")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => tabActions.closeOthers(tab.id)}>
        {t("closeOthers")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => tabActions.closeRight(tab.id)}>
        {t("closeRight")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={copyLink}>{t("copyLink")}</ContextMenuItem>
    </>
  );
}
