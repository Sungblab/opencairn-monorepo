"use client";
import { useEffect } from "react";
import { useTabsStore } from "@/stores/tabs-store";

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform);
}

// One listener covers every tab-scoped chord so we avoid registering nine
// separate keydown handlers for ⌘1…⌘9. Non-mod presses fall through to the
// editor so typing "w" inside Plate stays responsive.
export function useTabKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const s = useTabsStore.getState();

      // ⌘1..⌘9 → activate tab at index N-1. ⌘0 / ⌘+shift / ⌘+alt fall
      // through to browser defaults (e.g. macOS zoom).
      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const target = s.tabs[idx];
        if (target) {
          e.preventDefault();
          s.setActive(target.id);
        }
        return;
      }

      // ⌘W → close active tab. closeTab already no-ops on pinned.
      if (!e.shiftKey && !e.altKey && e.key.toLowerCase() === "w") {
        if (s.activeId) {
          e.preventDefault();
          s.closeTab(s.activeId);
        }
        return;
      }

      // ⌘Alt+Arrow → reorder active tab within the bar (shift comes later
      // when we add pinned-zone separator logic).
      if (!e.shiftKey && e.altKey && e.key === "ArrowRight") {
        const idx = s.tabs.findIndex((t) => t.id === s.activeId);
        if (idx >= 0 && idx < s.tabs.length - 1) {
          e.preventDefault();
          s.reorderTab(idx, idx + 1);
        }
        return;
      }
      if (!e.shiftKey && e.altKey && e.key === "ArrowLeft") {
        const idx = s.tabs.findIndex((t) => t.id === s.activeId);
        if (idx > 0) {
          e.preventDefault();
          s.reorderTab(idx, idx - 1);
        }
        return;
      }

      // ⌘Arrow → prev / next tab. Wraps around; matches the browser tab
      // cycling convention and means ⌘→ on the last tab moves to the
      // first rather than doing nothing (which feels broken).
      if (!e.shiftKey && !e.altKey && e.key === "ArrowRight") {
        if (s.tabs.length === 0) return;
        const idx = s.tabs.findIndex((t) => t.id === s.activeId);
        const next = s.tabs[(idx + 1) % s.tabs.length];
        if (next) {
          e.preventDefault();
          s.setActive(next.id);
        }
        return;
      }
      if (!e.shiftKey && !e.altKey && e.key === "ArrowLeft") {
        if (s.tabs.length === 0) return;
        const idx = s.tabs.findIndex((t) => t.id === s.activeId);
        const prev = s.tabs[(idx - 1 + s.tabs.length) % s.tabs.length];
        if (prev) {
          e.preventDefault();
          s.setActive(prev.id);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
