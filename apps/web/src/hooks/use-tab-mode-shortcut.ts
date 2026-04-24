"use client";
import { useCallback } from "react";
import { useKeyboardShortcut } from "./use-keyboard-shortcut";
import { useTabsStore } from "@/stores/tabs-store";

// ⌘⇧R toggles the active tab between plate and reading mode.
// Other modes (source/data/diff/…) intentionally ignore the shortcut so
// users don't get silently thrown out of a non-text viewer — those modes
// are reached via the "모드 변경" context-menu submenu, which is the only
// way to enter them explicitly.
export function useTabModeShortcut() {
  const handler = useCallback((e: KeyboardEvent) => {
    const s = useTabsStore.getState();
    const active = s.tabs.find((t) => t.id === s.activeId);
    if (!active) return;
    if (active.mode === "plate") {
      e.preventDefault();
      s.updateTab(active.id, { mode: "reading" });
    } else if (active.mode === "reading") {
      e.preventDefault();
      s.updateTab(active.id, { mode: "plate" });
    }
  }, []);
  useKeyboardShortcut("mod+shift+r", handler);
}
