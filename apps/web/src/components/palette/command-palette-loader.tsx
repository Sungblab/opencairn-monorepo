"use client";

import dynamic from "next/dynamic";
import { useIdleReady } from "@/lib/performance/use-idle-ready";

const CommandPalette = dynamic(
  () => import("./command-palette").then((mod) => mod.CommandPalette),
  { ssr: false },
);

export function CommandPaletteLoader() {
  const ready = useIdleReady({ timeout: 2000, fallbackMs: 1000 });

  return ready ? <CommandPalette /> : null;
}
