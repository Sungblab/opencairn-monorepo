"use client";

// Per-message action row: copy, regenerate, thumbs up/down. Thumbs-down opens
// an inline reason flyout — we deliberately bypass Radix Popover here because
// the chips live on the same line and the trigger already manages its own
// visibility state, so the extra portal/positioning machinery is overkill.
// The reason keys are a typed const tuple so feedback callers get a narrowed
// string union instead of `string`.

import { Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

const REASONS = ["incorrect", "incomplete", "irrelevant", "other"] as const;
type Reason = (typeof REASONS)[number];

export function MessageActions({
  text,
  onRegenerate,
  onFeedback,
}: {
  text: string;
  onRegenerate(): void;
  onFeedback(s: "positive" | "negative", reason?: Reason): void;
}) {
  const t = useTranslations("agentPanel.bubble");
  const [reasonOpen, setReasonOpen] = useState(false);

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-muted-foreground">
      <button
        type="button"
        aria-label={t("actions.copy_aria")}
        onClick={() => navigator.clipboard.writeText(text)}
        className="app-btn-ghost rounded-[var(--radius-control)] p-1"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("actions.regenerate_aria")}
        onClick={onRegenerate}
        className="app-btn-ghost rounded-[var(--radius-control)] p-1"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("actions.thumbs_up_aria")}
        onClick={() => onFeedback("positive")}
        className="app-btn-ghost rounded-[var(--radius-control)] p-1"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("actions.thumbs_down_aria")}
        onClick={() => setReasonOpen((o) => !o)}
        className="app-btn-ghost rounded-[var(--radius-control)] p-1"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      {reasonOpen ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onFeedback("negative", r);
                setReasonOpen(false);
              }}
              className="rounded border border-border px-1.5 text-[10px]"
            >
              {t(`feedback_reasons.${r}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
