"use client";

// Inline prompt asking whether to persist the current conversation as a note.
// The suggested title is interpolated into the localised prefix string so ko
// and en keep their natural punctuation ("...노트로 저장 제안" vs
// "Save \"...\" as a note?") without us concatenating fragments here.

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

export function SaveSuggestionCard({
  title,
  onSave,
  onDismiss,
}: {
  title: string;
  onSave(): void;
  onDismiss(): void;
}) {
  const t = useTranslations("agentPanel.bubble");

  return (
    <div
      className="mt-2 flex items-center gap-1.5 rounded-[var(--radius-control)] bg-background px-2.5 py-1.5 text-[11px]"
      style={{ border: "1px solid var(--theme-border)" }}
    >
      <span className="flex-1 truncate">
        {t("save_suggestion_prefix", { title })}
      </span>
      <button
        type="button"
        onClick={onSave}
        className="app-btn-primary rounded-[var(--radius-control)] px-2 py-0.5 text-[10px] font-medium"
      >
        {t("save_suggestion_save")}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("save_suggestion_dismiss_aria")}
        className="app-btn-ghost rounded-[var(--radius-control)] p-0.5"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
