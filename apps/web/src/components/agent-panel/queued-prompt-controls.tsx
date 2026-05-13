"use client";

import { useTranslations } from "next-intl";
import { SendHorizontal, Trash2 } from "lucide-react";

export function QueuedPromptControls({
  content,
  onChange,
  onDiscard,
  onInterrupt,
}: {
  content: string;
  onChange: (content: string) => void;
  onDiscard: () => void;
  onInterrupt?: () => void;
}) {
  const t = useTranslations("agentPanel.queuedPrompt");

  return (
    <div className="mx-3 mb-2 rounded-[var(--radius-control)] border border-border bg-muted/30 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("label")}
        </span>
        <span className="flex items-center gap-1">
          {onInterrupt ? (
            <button
              type="button"
              onClick={onInterrupt}
              aria-label={t("interrupt_aria")}
              title={t("interrupt_aria")}
              className="inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SendHorizontal aria-hidden className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDiscard}
            aria-label={t("delete_aria")}
            className="inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        </span>
      </div>
      <textarea
        aria-label={t("edit_aria")}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        className="max-h-24 min-h-14 w-full resize-none rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-sm leading-5 outline-none focus:border-foreground"
      />
    </div>
  );
}
