"use client";
import { useCallback, useEffect, useRef } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  useTabsStore,
  type Tab,
  type TabKind,
  type TabMode,
} from "@/stores/tabs-store";
import { tabToUrl, urlToTabTarget, type TabRoute } from "@/lib/tab-url";

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
function defaultModeFor(_kind: TabKind): TabMode {
  return "plate";
}

function defaultTitleFor(kind: TabKind, targetId: string | null): string {
  // Placeholder labels — Phase 2/4 will swap in real fetched titles. Korean
  // strings are deliberate (default locale per CLAUDE.md); the planned i18n
  // refactor in Task 14 moves these to messages/{ko,en}/app-shell.json once
  // the placeholder UI is wired up.
  switch (kind) {
    case "dashboard":
      return "대시보드";
    case "note":
      return "노트";
    case "project":
      return "프로젝트";
    case "research_hub":
      return "Deep Research";
    case "research_run":
      return `Research ${targetId ?? ""}`;
    case "import":
      return "가져오기";
    case "ws_settings":
      return "설정";
  }
}

function newId() {
  // `t_` prefix is retained for debuggability (tab IDs stand out in devtools
  // / logs). Uniqueness comes from crypto.randomUUID — Date.now + 6-char
  // random has meaningful collision risk under rapid tab opens (duplicate
  // hotkey, deep-link prefetch) which would corrupt the tabs map keyed on id.
  return `t_${crypto.randomUUID()}`;
}

export function useUrlTabSync() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useParams<{ wsSlug?: string }>();
  const slug = params?.wsSlug ?? "";

  // Phase 1 doesn't have the workspace UUID yet — slug is the only stable
  // identifier we have at the URL layer. Prefix it so the eventual switch
  // to UUIDs in Phase 2 doesn't collide on the same localStorage key.
  const workspaceKey = slug ? `ws_slug:${slug}` : null;
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setWorkspace = useTabsStore((s) => s.setWorkspace);
  const addTab = useTabsStore((s) => s.addTab);
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
    const existing = useTabsStore
      .getState()
      .findTabByTarget(route.kind, route.targetId);
    if (existing) {
      if (activeId !== existing.id) setActive(existing.id);
      return;
    }
    const tab: Tab = {
      id: newId(),
      kind: route.kind,
      targetId: route.targetId,
      mode: defaultModeFor(route.kind),
      title: defaultTitleFor(route.kind, route.targetId),
      pinned: false,
      // Notes opened by URL navigation default to preview mode (italic in
      // Phase 3); promotion to a permanent tab happens on second click.
      preview: route.kind === "note",
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    };
    addTab(tab);
  }, [pathname, slug, activeId, setActive, addTab]);

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
