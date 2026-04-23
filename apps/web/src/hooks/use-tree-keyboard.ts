"use client";
import { useEffect, type RefObject } from "react";

// Appends printable keys to a buffer that clears itself after `ttlMs` of
// idle time. Scope is the container ref's keydown events, so type-ahead
// doesn't hijack keystrokes the user is typing into an unrelated page
// (or into the inline-rename input inside a row). Returns nothing — the
// caller wires the buffer into a state setter and uses it however it wants
// (react-arborist's `searchTerm` prop is the obvious consumer).
export function useTypeAhead(
  containerRef: RefObject<HTMLElement | null>,
  update: (next: (prev: string) => string) => void,
  opts: { ttlMs?: number } = {},
) {
  const ttlMs = opts.ttlMs ?? 700;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let timer: number | null = null;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      update((prev) => prev + e.key.toLowerCase());
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => update(() => ""), ttlMs);
    };

    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [containerRef, update, ttlMs]);
}
