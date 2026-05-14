"use client";

// Compact dropdown that picks the agent's response profile for the next turn.
// The enum stays internal; labels explain the user-facing tradeoff.

import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ChatMode = "auto" | "fast" | "balanced" | "accurate" | "research";

const RESPONSE_MODES: Exclude<ChatMode, "research">[] = [
  "auto",
  "fast",
  "balanced",
  "accurate",
];

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
        className="inline-flex min-h-7 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:border-foreground hover:bg-muted focus-visible:border-foreground focus-visible:bg-muted focus-visible:outline-none"
      >
        <span className="text-muted-foreground">{t("trigger_label")}</span>
        <span>{t(`${value}_short`)}</span>
        <ChevronDown aria-hidden className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-72 rounded-[var(--radius-control)] border border-border bg-background p-1 shadow-sm ring-0"
      >
        {RESPONSE_MODES.map((m) => (
          <DropdownMenuItem
            key={m}
            onClick={() => onChange(m)}
            className={`flex min-h-10 items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs transition-colors hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground ${
              value === m
                ? "bg-muted/60 text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {value === m ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{t(m)}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                {t(`${m}_description`)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
