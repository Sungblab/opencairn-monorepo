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
    <div className="mt-2 flex items-center gap-2 rounded border border-border p-2 text-xs">
      <span className="flex-1 truncate">
        {t("save_suggestion_prefix", { title })}
      </span>
      <button
        type="button"
        onClick={onSave}
        className="app-btn-primary rounded px-2 py-0.5"
      >
        {t("save_suggestion_save")}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("save_suggestion_dismiss_aria")}
        className="rounded px-2 py-0.5 hover:bg-accent"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
