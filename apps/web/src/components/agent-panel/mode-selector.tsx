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
        className="inline-flex min-h-7 items-center rounded border border-border px-2.5 py-1 text-xs uppercase tracking-wide hover:bg-accent"
      >
        {t(value)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m}
            onSelect={() => onChange(m)}
            className="flex items-center gap-2"
          >
            {value === m ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="w-3" />
            )}
            <span className="uppercase tracking-wide">{t(m)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
