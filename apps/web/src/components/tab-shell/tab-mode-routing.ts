import type { Tab } from "@/stores/tabs-store";
import { isValidTabMode } from "@/lib/tab-mode-rules";

/**
 * Predicate used by TabShell to decide the top-level branch: plate renders
 * route children, every other valid mode uses the client-only viewer router.
 */
export function isRoutedByTabModeRouter(tab: Tab): boolean {
  return tab.mode !== "plate" && isValidTabMode(tab);
}
