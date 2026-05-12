"use client";

// Compact dropdown that picks the agent's response mode for the next turn.
// Modes are intentionally rendered ALL CAPS in both locales — they're enum
// tokens (auto/fast/balanced/accurate/research), not translatable prose —
// but they still go through next-intl so a future locale can swap glyphs
// or add a hint without forking the component. The trigger label and each
// option label live under `agentPanel.composer.modes.*`.

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";

const MODES: ChatMode[] = ["auto", "fast", "balanced", "accurate", "research"];

interface Props {
  value: ChatMode;
  onChange(v: ChatMode): void;
}

export function ModeSelector({ value, onChange }: Props) {
  const t = useTranslations("agentPanel.composer.modes");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={t("trigger_aria")}
        className="inline-flex min-h-7 items-center rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-1 text-xs uppercase transition-colors hover:border-foreground hover:bg-muted focus-visible:border-foreground focus-visible:bg-muted focus-visible:outline-none"
      >
        {t(value)}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-60 rounded-[var(--radius-control)] border border-border bg-background p-1 shadow-sm ring-0"
      >
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m}
            onSelect={() => onChange(m)}
            className={`flex min-h-10 items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs transition-colors hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground ${
              value === m ? "bg-muted/60 text-foreground" : "text-muted-foreground"
            }`}
          >
            {value === m ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="min-w-0">
              <span className="block font-medium uppercase text-foreground">
                {t(m)}
              </span>
              <span className="mt-0.5 block text-[11px] normal-case leading-4 text-muted-foreground">
                {t(`${m}_description`)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
