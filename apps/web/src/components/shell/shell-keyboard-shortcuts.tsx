"use client";

import { useCallback } from "react";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useTabKeyboard } from "@/hooks/use-tab-keyboard";
import { useTabModeShortcut } from "@/hooks/use-tab-mode-shortcut";
import { useShellLabels } from "@/components/shell/shell-labels";
import { newTab } from "@/lib/tab-factory";
import { usePanelStore } from "@/stores/panel-store";
import { useTabsStore } from "@/stores/tabs-store";

export function ShellKeyboardShortcuts() {
  useTabKeyboard();
  useTabModeShortcut();

  const isCompact = useBreakpoint() !== "lg";
  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const toggleCompactSidebar = usePanelStore((s) => s.toggleCompactSidebar);
  const toggleAgentPanel = usePanelStore((s) => s.toggleAgentPanel);
  const toggleCompactAgentPanel = usePanelStore(
    (s) => s.toggleCompactAgentPanel,
  );
  const { tabs: labels } = useShellLabels();

  const onSidebarShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      if (isCompact) toggleCompactSidebar();
      else toggleSidebar();
    },
    [isCompact, toggleCompactSidebar, toggleSidebar],
  );
  const onAgentPanelShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      if (isCompact) toggleCompactAgentPanel();
      else toggleAgentPanel();
    },
    [isCompact, toggleAgentPanel, toggleCompactAgentPanel],
  );
  // mod+T and mod+shift+T are generally captured by the browser chrome,
  // so these handlers are best-effort on the web target.
  const onNewTabShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      useTabsStore.getState().addTab(
        newTab({
          kind: "note",
          targetId: null,
          title: labels.bar.newTabTitle,
          preview: false,
        }),
      );
    },
    [labels.bar.newTabTitle],
  );
  const onRestoreClosedShortcut = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    useTabsStore.getState().restoreClosed();
  }, []);

  useKeyboardShortcut("mod+\\", onSidebarShortcut);
  useKeyboardShortcut("mod+j", onAgentPanelShortcut);
  useKeyboardShortcut("mod+t", onNewTabShortcut);
  useKeyboardShortcut("mod+shift+t", onRestoreClosedShortcut);

  return null;
}
