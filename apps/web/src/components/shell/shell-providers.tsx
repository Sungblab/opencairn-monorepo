"use client";
import { useCallback, useEffect } from "react";
import { AppShell } from "./app-shell";
import { Toaster } from "@/components/ui/toaster";
import { useUrlTabSync } from "@/hooks/use-url-tab-sync";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { usePanelStore } from "@/stores/panel-store";
import { useThreadsStore } from "@/stores/threads-store";
import { useSidebarStore } from "@/stores/sidebar-store";

// One mount point that wires every cross-cutting concern the shell needs:
// URL ↔ tabs reconciliation, the two global shortcuts, and per-workspace
// hydration of the sibling stores (threads + sidebar) — kept in lockstep
// with the workspace key tabs-store derives in useUrlTabSync so all three
// stores agree on which workspace is active.
export function ShellProviders({
  wsSlug,
  children,
}: {
  wsSlug: string;
  children: React.ReactNode;
}) {
  useUrlTabSync();

  const toggleSidebar = usePanelStore((s) => s.toggleSidebar);
  const toggleAgentPanel = usePanelStore((s) => s.toggleAgentPanel);

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

  useKeyboardShortcut("mod+\\", onSidebarShortcut);
  useKeyboardShortcut("mod+j", onAgentPanelShortcut);

  const setThreadsWs = useThreadsStore((s) => s.setWorkspace);
  const setSidebarWs = useSidebarStore((s) => s.setWorkspace);

  useEffect(() => {
    const key = `ws_slug:${wsSlug}`;
    setThreadsWs(key);
    setSidebarWs(key);
  }, [wsSlug, setThreadsWs, setSidebarWs]);

  return (
    <>
      <AppShell>{children}</AppShell>
      <Toaster />
    </>
  );
}
