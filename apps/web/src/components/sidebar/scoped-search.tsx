"use client";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { usePaletteStore } from "@/stores/palette-store";
import { useModKeyLabel } from "@/hooks/use-mod-key-label";

// Sidebar quick-access button for the command palette. Phase 5 wires the
// palette UI itself; right now the button just flips the shared store open
// so Cmd/Ctrl+K and this entry route through the same state machine.
export function ScopedSearch() {
  const open = usePaletteStore((s) => s.open);
  const t = useTranslations("sidebar.search");
  const modKeyLabel = useModKeyLabel();
  const shortcutLabel = `${modKeyLabel}+K`;

  return (
    <button
      type="button"
      onClick={open}
      className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] border border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{t("placeholder")}</span>
      <kbd className="shrink-0 border border-border px-1 text-[10px] font-normal text-muted-foreground">
        {shortcutLabel}
      </kbd>
    </button>
  );
}
