"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { usePaletteStore } from "@/stores/palette-store";

// Mounted by authenticated app layouts only; public pages keep this host out
// of their initial client surface.
const CommandPaletteDialog = dynamic(
  () => import("./command-palette-dialog").then((mod) => mod.CommandPaletteDialog),
  { ssr: false },
);

export function CommandPalette() {
  const isOpen = usePaletteStore((s) => s.isOpen);
  const open = usePaletteStore((s) => s.open);
  const onShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      open();
    },
    [open],
  );
  useKeyboardShortcut("mod+k", onShortcut);

  return isOpen ? <CommandPaletteDialog /> : null;
}
