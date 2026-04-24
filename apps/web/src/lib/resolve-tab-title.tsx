"use client";
import { useTranslations } from "next-intl";
import type { Tab } from "@/stores/tabs-store";

// Render-time tab title resolver. Phase 3-A persisted `tab.title` as a
// concrete string in the user's locale at creation time; flipping ko↔en
// left already-open tabs frozen in the old language. Phase 3-B adds
// `titleKey` + `titleParams` to Tab and resolves them through next-intl
// on every render so locale swaps relabel every tab with a static key.
//
// Note tabs (DB-sourced titles) keep `titleKey` undefined and render
// `tab.title` verbatim — we deliberately do NOT translate user content.

/**
 * Returns the display title for a tab, resolving `titleKey` through
 * next-intl when present and falling back to the cached `tab.title`
 * otherwise (including when the key is missing in the message catalog).
 */
export function useResolvedTabTitle(tab: Tab): string {
  // Always call the hook unconditionally at the root namespace so a tab
  // that drops its `titleKey` across renders doesn't trip the rules of
  // hooks. The full dotted path is passed to `t()` and resolved against
  // the root messages object.
  const t = useTranslations();
  if (!tab.titleKey) return tab.title;
  const resolved = t(tab.titleKey, tab.titleParams ?? {});
  // next-intl surfaces a missing key by returning the key path itself
  // (e.g. "appShell.tabTitles.nonexistent"). Treat that as a miss and
  // fall through to the cached title so we never render a raw dotted
  // path to the user.
  return resolved === tab.titleKey ? tab.title : resolved;
}

/**
 * Thin component wrapper around `useResolvedTabTitle` so callers that
 * need a title inside a `.map()` body (where hooks can't be called)
 * can render a child component that calls the hook per-tab.
 */
export function ResolveTabTitle({ tab }: { tab: Tab }) {
  return <>{useResolvedTabTitle(tab)}</>;
}
