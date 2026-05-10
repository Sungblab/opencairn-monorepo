"use client";
import { useEffect, useRef } from "react";
import { useParams, usePathname } from "next/navigation";
import { useTabsStore } from "@/stores/tabs-store";
import { urlToTabTarget, type TabRoute } from "@/lib/tab-url";
import { newTab } from "@/lib/tab-factory";
import { isValidTabMode } from "@/lib/tab-mode-rules";
import {
  resolveShellDefaultTabTitle,
  shellTabTitleKey,
  useShellLabels,
} from "@/components/shell/shell-labels";

// URL is the source of truth for the active tab. Two effects:
//   1) setWorkspace once per slug change so the right per-workspace stack is
//      hydrated from localStorage.
//   2) On every URL change, ensure a matching tab exists; if not, create one.
//
// This keeps Next's router API the single mutator, which means browser back/
// forward, deep-link paste, and command-palette navigation all flow through
// the same reconciliation path. Tabs cannot drift from the URL because they
// are derived from it.

// Seeds the cached `title` field at the user's current locale. This is a
// fallback now: rendered shell tabs resolve static keys through ShellLabels.
function findReusableRouteTab(route: TabRoute) {
  const store = useTabsStore.getState();
  if (route.kind === "ws_settings") {
    return store.tabs.find((tab) => tab.kind === "ws_settings");
  }
  return store.findTabByTarget(route.kind, route.targetId);
}

export function useUrlTabSync() {
  const pathname = usePathname() ?? "/";
  const labels = useShellLabels();
  const params = useParams<{ wsSlug?: string }>();
  const slug = params?.wsSlug ?? "";

  // Phase 1 doesn't have the workspace UUID yet — slug is the only stable
  // identifier we have at the URL layer. Prefix it so the eventual switch
  // to UUIDs in Phase 2 doesn't collide on the same localStorage key.
  const workspaceKey = slug ? `ws_slug:${slug}` : null;
  const setWorkspace = useTabsStore((s) => s.setWorkspace);
  const setActive = useTabsStore((s) => s.setActive);
  const updateTab = useTabsStore((s) => s.updateTab);

  const initialized = useRef<string | null>(null);
  const lastSyncedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceKey) return;
    if (initialized.current !== workspaceKey) {
      setWorkspace(workspaceKey);
      initialized.current = workspaceKey;
    }
  }, [workspaceKey, setWorkspace]);

  useEffect(() => {
    if (!slug) return;
    const parsed = urlToTabTarget(pathname);
    if (!parsed || parsed.slug !== slug) return;
    const { route } = parsed;
    const pathChanged = lastSyncedPath.current !== pathname;
    lastSyncedPath.current = pathname;
    const store = useTabsStore.getState();
    const existing = findReusableRouteTab(route);
    if (existing) {
      if (route.kind === "ws_settings") {
        store.dedupeTabsByKind("ws_settings", existing.id);
      }
      const shouldPatchTarget = existing.targetId !== route.targetId;
      const shouldPatchMode = Boolean(route.mode && existing.mode !== route.mode);
      const shouldResetInvalidMode = !route.mode && !isValidTabMode(existing);
      if (shouldPatchTarget || shouldPatchMode) {
        const { key, params } = shellTabTitleKey(
          route.kind,
          route.targetId,
          route.mode,
        );
        updateTab(existing.id, {
          targetId: route.targetId,
          ...(route.mode
            ? { mode: route.mode }
            : shouldResetInvalidMode
              ? { mode: "plate" as const }
              : {}),
          title: resolveShellDefaultTabTitle(
            labels,
            route.kind,
            route.targetId,
            route.mode,
          ),
          titleKey: key,
          titleParams: params,
        });
      } else if (shouldResetInvalidMode) {
        updateTab(existing.id, { mode: "plate" });
      }
      if ((pathChanged || !store.activeId) && store.activeId !== existing.id) {
        setActive(existing.id);
      }
      return;
    }
    const { key, params } = shellTabTitleKey(
      route.kind,
      route.targetId,
      route.mode,
    );
    const tab = newTab({
      kind: route.kind,
      targetId: route.targetId,
      mode: route.mode,
      title: resolveShellDefaultTabTitle(
        labels,
        route.kind,
        route.targetId,
        route.mode,
      ),
      titleKey: key,
      titleParams: params,
    });
    // Notes opened via sidebar single-click arrive as preview tabs. To avoid
    // stacking one preview per click (which is how you end up with 20 tabs
    // after a morning of browsing), we replace any existing preview tab
    // instead of appending. Non-note kinds have preview=false from the
    // factory default, so addTab just appends.
    if (tab.preview) {
      store.addOrReplacePreview(tab);
    } else {
      store.addTab(tab);
    }
  }, [pathname, slug, labels, setActive, updateTab]);
}
