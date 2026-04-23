"use client";
import { useCallback, useEffect, useRef } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTabsStore, type TabKind } from "@/stores/tabs-store";
import { tabToUrl, urlToTabTarget, type TabRoute } from "@/lib/tab-url";
import { newTab } from "@/lib/tab-factory";

// URL is the source of truth for the active tab. Two effects:
//   1) setWorkspace once per slug change so the right per-workspace stack is
//      hydrated from localStorage.
//   2) On every URL change, ensure a matching tab exists; if not, create one.
//      `navigateToTab` is the inverse — components calling it update the URL
//      and effect 2 reconciles the store.
//
// This keeps Next's router API the single mutator, which means browser back/
// forward, deep-link paste, and command-palette navigation all flow through
// the same reconciliation path. Tabs cannot drift from the URL because they
// are derived from it.

// Resolve a placeholder tab title at the user's current locale. Returns a
// concrete string (not a key) because the title is persisted to localStorage
// inside the Tab object — Phase 3 renders it directly. Caveat: a tab created
// in `ko` keeps its Korean title until closed and reopened even after the
// user switches locale to `en`. The proper fix is to persist `titleKey` and
// resolve at render time, but that's a later concern; for now this beats
// hardcoded strings for English-locale users.
function resolveDefaultTitle(
  t: ReturnType<typeof useTranslations>,
  kind: TabKind,
  targetId: string | null,
): string {
  switch (kind) {
    case "dashboard":
      return t("dashboard");
    case "note":
      return t("note");
    case "project":
      return t("project");
    case "research_hub":
      return t("research_hub");
    case "research_run":
      return t("research_run", { id: targetId ?? "" });
    case "import":
      return t("import");
    case "ws_settings":
      return t("ws_settings");
  }
}

export function useUrlTabSync() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const tabTitle = useTranslations("appShell.tabTitles");
  const params = useParams<{ wsSlug?: string }>();
  const slug = params?.wsSlug ?? "";

  // Phase 1 doesn't have the workspace UUID yet — slug is the only stable
  // identifier we have at the URL layer. Prefix it so the eventual switch
  // to UUIDs in Phase 2 doesn't collide on the same localStorage key.
  const workspaceKey = slug ? `ws_slug:${slug}` : null;
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setWorkspace = useTabsStore((s) => s.setWorkspace);
  const setActive = useTabsStore((s) => s.setActive);

  const initialized = useRef<string | null>(null);

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
    const store = useTabsStore.getState();
    const existing = store.findTabByTarget(route.kind, route.targetId);
    if (existing) {
      if (activeId !== existing.id) setActive(existing.id);
      return;
    }
    const tab = newTab({
      kind: route.kind,
      targetId: route.targetId,
      title: resolveDefaultTitle(tabTitle, route.kind, route.targetId),
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
  }, [pathname, slug, activeId, setActive, tabTitle]);

  const navigateToTab = useCallback(
    (
      route: TabRoute,
      opts: { mode: "push" | "replace" } = { mode: "push" },
    ) => {
      if (!slug) return;
      const url = tabToUrl(slug, route);
      if (opts.mode === "replace") router.replace(url);
      else router.push(url);
    },
    [router, slug],
  );

  return { tabs, activeId, navigateToTab };
}
