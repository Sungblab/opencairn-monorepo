"use client";
import {
  resolveShellTabTitle,
  useShellLabels,
} from "@/components/shell/shell-labels";
import type { Tab } from "@/stores/tabs-store";

// Render-time tab title resolver. Phase 3-A persisted `tab.title` as a
// concrete string in the user's locale at creation time; flipping ko↔en
// left already-open tabs frozen in the old language. Phase 3-B adds
// `titleKey` + `titleParams` to Tab and resolves them through the shell label
// context on every render so locale swaps relabel every tab with a static key.
//
// Note tabs (DB-sourced titles) keep `titleKey` undefined and render
// `tab.title` verbatim — we deliberately do NOT translate user content.

/**
 * Returns the display title for a tab, resolving `titleKey` through the
 * server-resolved shell labels and falling back to the cached `tab.title`
 * otherwise (including when the key is missing in the message catalog).
 */
export function useResolvedTabTitle(tab: Tab): string {
  const labels = useShellLabels();
  return resolveShellTabTitle(labels, tab);
}
