"use client";
import { useEffect } from "react";

// Match `Cmd` on macOS and `Ctrl` everywhere else. The shell wires a
// handful of these (Ctrl+\ for sidebar, Ctrl+J for agent panel,
// Ctrl+K for palette in Phase 5) and every component would otherwise
// duplicate this same `metaKey || ctrlKey` reconciliation.
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform);
}

interface Chord {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

function parse(chord: string): Chord {
  const parts = chord.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  return {
    key,
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
}

export function useKeyboardShortcut(
  chord: string,
  handler: (e: KeyboardEvent) => void,
) {
  useEffect(() => {
    const parsed = parse(chord);
    const onKey = (e: KeyboardEvent) => {
      // Mod required ⇒ on mac that's meta, elsewhere ctrl. Mod NOT required
      // ⇒ neither key may be held, so a stray `Cmd+J` from the OS doesn't
      // accidentally trigger a no-modifier shortcut bound to plain `j`.
      const modOk = parsed.mod
        ? isMac()
          ? e.metaKey
          : e.ctrlKey
        : !e.metaKey && !e.ctrlKey;
      const shiftOk = parsed.shift ? e.shiftKey : !e.shiftKey;
      const altOk = parsed.alt ? e.altKey : !e.altKey;
      if (modOk && shiftOk && altOk && e.key.toLowerCase() === parsed.key) {
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chord, handler]);
}
