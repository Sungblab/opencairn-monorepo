"use client";
import { useCallback, useEffect, useRef } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTabsStore, type TabKind } from "@/stores/tabs-store";
import { tabToUrl, urlToTabTarget, type TabRoute } from "@/lib/tab-url";
import { newTab } from "@/lib/tab-factory";

// Map a (kind, targetId) pair to its persistent i18n key + interpolation
// params. Phase 3-B: tabs carry this alongside the cached `title` so the
// Tab bar / overflow menu relabel themselves when the user flips locale.
// Notes return `undefined` because their title comes from the DB and must
// not be translated as UI copy.
function tabTitleKey(
  kind: TabKind,
  targetId: string | null,
): { key: string | undefined; params: Record<string, string> | undefined } {
  switch (kind) {
    case "note":
      return { key: undefined, params: undefined };
    case "research_run":
      return {
        key: "appShell.tabTitles.research_run",
        params: { id: targetId ?? "" },
      };
    default:
      return { key: `appShell.tabTitles.${kind}`, params: undefined };
  }
}

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

// Seeds the cached `title` field at the user's current locale. Under Phase
// 3-B this is a fallback: TabItem / TabOverflowMenu render through
// `useResolvedTabTitle`, which prefers `titleKey` → live translation. The
// cached value survives (a) persisted Phase 3-A tabs that have no titleKey,
// (b) note tabs where the title comes from the DB (no i18n key), and
// (c) missing-message fallback at render time.
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
    case "ingest":
    case "lit_search":
    case "agent_file":
      // Both kinds always set `titleKey` at construction time
      // (ingest.tab.title / literature.tab.title), so this branch is
      // unreachable at runtime — kept here purely for switch exhaustiveness.
      return "";
  }
}

export function useUrlTabSync() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const locale = useLocale();
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
    const { key, params } = tabTitleKey(route.kind, route.targetId);
    const tab = newTab({
      kind: route.kind,
      targetId: route.targetId,
      title: resolveDefaultTitle(tabTitle, route.kind, route.targetId),
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
  }, [pathname, slug, activeId, setActive, tabTitle]);

  const navigateToTab = useCallback(
    (
      route: TabRoute,
      opts: { mode: "push" | "replace" } = { mode: "push" },
    ) => {
      if (!slug) return;
      const url = tabToUrl(slug, route, locale);
      if (opts.mode === "replace") router.replace(url);
      else router.push(url);
    },
    [router, slug, locale],
  );

  return { tabs, activeId, navigateToTab };
}
