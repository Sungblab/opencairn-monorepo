"use client";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { usePaletteStore } from "@/stores/palette-store";

// Sidebar quick-access button for the command palette. Phase 5 wires the
// palette UI itself; right now the button just flips the shared store open
// so ⌘K and this entry route through the same state machine.
export function ScopedSearch() {
  const open = usePaletteStore((s) => s.open);
  const t = useTranslations("sidebar.search");

  return (
    <button
      type="button"
      onClick={open}
      className="mx-3 my-2 flex items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <Search aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("placeholder")}</span>
      <kbd className="shrink-0 rounded border border-border px-1 text-[10px] font-normal text-muted-foreground">
        {t("shortcut_hint")}
      </kbd>
    </button>
  );
}
