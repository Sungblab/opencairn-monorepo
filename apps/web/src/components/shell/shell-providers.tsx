"use client";
import { useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "./app-shell";
import { CommandPalette } from "@/components/palette/command-palette";
import { useUrlTabSync } from "@/hooks/use-url-tab-sync";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useTabKeyboard } from "@/hooks/use-tab-keyboard";
import { useTabModeShortcut } from "@/hooks/use-tab-mode-shortcut";
import { usePanelStore } from "@/stores/panel-store";
import { useThreadsStore } from "@/stores/threads-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useTabsStore } from "@/stores/tabs-store";
import { newTab } from "@/lib/tab-factory";

// One mount point that wires every cross-cutting concern the shell needs:
// URL ↔ tabs reconciliation, the two global shortcuts, and per-workspace
// hydration of the sibling stores (threads + sidebar) — kept in lockstep
// with the workspace key tabs-store derives in useUrlTabSync so all three
// stores agree on which workspace is active.
export function ShellProviders({
  wsSlug,
  deepResearchEnabled,
  children,
}: {
  wsSlug: string;
  deepResearchEnabled: boolean;
  children: React.ReactNode;
}) {
  useUrlTabSync();
  useTabKeyboard();
  useTabModeShortcut();

  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const toggleAgentPanel = usePanelStore((s) => s.toggleAgentPanel);
  const tabBarT = useTranslations("appShell.tabs.bar");

  const onSidebarShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      toggleSidebar();
    },
    [toggleSidebar],
  );
  const onAgentPanelShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      toggleAgentPanel();
    },
    [toggleAgentPanel],
  );
  // mod+T and mod+shift+T are generally captured by the browser chrome,
  // so these handlers are effectively best-effort on the web target — they
  // matter for the desktop build and for browsers / kiosk modes that
  // surface the key to the page.
  const onNewTabShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      useTabsStore.getState().addTab(
        newTab({
          kind: "note",
          targetId: null,
          title: tabBarT("newTabTitle"),
          preview: false,
        }),
      );
    },
    [tabBarT],
  );
  const onRestoreClosedShortcut = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    useTabsStore.getState().restoreClosed();
  }, []);

  useKeyboardShortcut("mod+\\", onSidebarShortcut);
  useKeyboardShortcut("mod+j", onAgentPanelShortcut);
  useKeyboardShortcut("mod+t", onNewTabShortcut);
  useKeyboardShortcut("mod+shift+t", onRestoreClosedShortcut);

  const setThreadsWs = useThreadsStore((s) => s.setWorkspace);
  const setSidebarWs = useSidebarStore((s) => s.setWorkspace);

  useEffect(() => {
    const key = `ws_slug:${wsSlug}`;
    setThreadsWs(key);
    setSidebarWs(key);
  }, [wsSlug, setThreadsWs, setSidebarWs]);

  // Toaster lives at the [locale]/layout.tsx boundary (Phase 5 lift) so
  // /onboarding, /auth, /settings — anything outside the (shell) route
  // group — also gets toast notifications.
  //
  // CommandPalette is shell-only — it depends on a workspace context for
  // its scoped note search and most of its actions; outside-of-shell pages
  // don't have a wsSlug to bind to.
  return (
    <>
      <AppShell deepResearchEnabled={deepResearchEnabled}>{children}</AppShell>
      <CommandPalette wsSlug={wsSlug} />
    </>
  );
}
