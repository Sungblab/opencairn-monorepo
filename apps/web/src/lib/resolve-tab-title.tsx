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
  // Always call the hook — React rules-of-hooks require consistent order
  // across renders, and `titleKey` may toggle between undefined and a value
  // (e.g. a Phase 3-A persisted tab loaded alongside a Phase 3-B one).
  const t = useTranslations();
  if (!tab.titleKey) return tab.title;
  // `t.has` checks message existence without triggering the default `onError`
  // (which logs to the console). Works under any `getMessageFallback` config.
  if (!t.has(tab.titleKey)) return tab.title;
  return t(tab.titleKey, tab.titleParams);
}
