"use client";
import { useEffect } from "react";
import { AppShell } from "./app-shell";
import { ShellKeyboardShortcutsLoader } from "./shell-keyboard-shortcuts-loader";
import { ShellLabelsProvider, type ShellLabels } from "./shell-labels";
import { useUrlTabSync } from "@/hooks/use-url-tab-sync";
import { useThreadsStore } from "@/stores/threads-store";
import { useSidebarStore } from "@/stores/sidebar-store";

// One mount point that wires every cross-cutting concern the shell needs:
// URL ↔ tabs reconciliation and per-workspace hydration of the sibling
// stores (threads + sidebar) — kept in lockstep with the workspace key
// tabs-store derives in useUrlTabSync so all three stores agree on which
// workspace is active. Keyboard shortcut listeners are loaded separately
// because they are not needed for the initial shell paint.
export function ShellProviders({
  wsSlug,
  shellLabels,
  deepResearchEnabled,
  synthesisExportEnabled = false,
  children,
}: {
  wsSlug: string;
  shellLabels: ShellLabels;
  deepResearchEnabled: boolean;
  synthesisExportEnabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ShellLabelsProvider labels={shellLabels}>
      <ShellRuntimeProviders
        wsSlug={wsSlug}
        deepResearchEnabled={deepResearchEnabled}
        synthesisExportEnabled={synthesisExportEnabled}
      >
        {children}
      </ShellRuntimeProviders>
    </ShellLabelsProvider>
  );
}

function ShellRuntimeProviders({
  wsSlug,
  deepResearchEnabled,
  synthesisExportEnabled = false,
  children,
}: {
  wsSlug: string;
  deepResearchEnabled: boolean;
  synthesisExportEnabled?: boolean;
  children: React.ReactNode;
}) {
  useUrlTabSync();

  const setThreadsWs = useThreadsStore((s) => s.setWorkspace);
  const setSidebarWs = useSidebarStore((s) => s.setWorkspace);

  useEffect(() => {
    const key = `ws_slug:${wsSlug}`;
    setThreadsWs(key);
    setSidebarWs(key);
  }, [wsSlug, setThreadsWs, setSidebarWs]);

  // Toaster, ReactQueryProvider, and CommandPalette all live at the
  // [locale]/layout.tsx boundary so /settings, /onboarding, /auth —
  // anything outside the (shell) route group — also gets them. The palette
  // derives its workspace context from the URL (`extractWsSlug`) and falls
  // back to a profile-only action set when the path has no `/workspace/<slug>`
  // segment.
  return (
    <>
      <ShellKeyboardShortcutsLoader />
      <AppShell
        wsSlug={wsSlug}
        deepResearchEnabled={deepResearchEnabled}
        synthesisExportEnabled={synthesisExportEnabled}
      >
        {children}
      </AppShell>
    </>
  );
}
