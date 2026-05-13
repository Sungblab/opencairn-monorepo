"use client";

// Expanded-by-default "thinking" pill rendered above an agent's body. The token count
// is a rough heuristic for elapsed seconds (Gemini streams thoughts at roughly
// 60 tok/s) — we surface it as a fuzzy duration so users get scale without
// claiming wall-clock accuracy. Localised because both the label and the
// "Ns" suffix differ across ko/en (생각 / Thinking).

import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function ThoughtBubble({
  summary,
  tokens,
}: {
  summary: string;
  tokens?: number;
}) {
  const t = useTranslations("agentPanel.bubble");
  const [open, setOpen] = useState(true);
  const seconds = tokens ? Math.round(tokens / 60) : null;

  return (
    <div className="rounded border border-border bg-muted/20 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span>
          {t("thought_label")}
          {seconds !== null ? ` ${t("thought_seconds", { seconds })}` : ""}
        </span>
      </button>
      {open ? (
        <p className="border-t border-border px-2 py-1 text-muted-foreground">
          {summary}
        </p>
      ) : null}
    </div>
  );
}
