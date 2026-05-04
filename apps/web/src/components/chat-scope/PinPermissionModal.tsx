"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { PinDelta } from "@opencairn/shared";

// Plan 11A — citation visibility warning. Surfaced when /pin returns 409
// with a non-empty hiddenSources / hiddenUsers payload. The body text
// counts both buckets so the user can tell whether the leak is "many
// sources hidden from one person" vs "one source hidden from many".
//
// Plain modal (no Radix dialog wrapper) keeps the dependency surface
// minimal; if app-shell-wide modals graduate to Radix later we'll port
// this in lockstep.
export function PinPermissionModal({
  warning,
  onCancel,
  onConfirm,
}: {
  warning: PinDelta;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("chatScope.pin");
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-background p-4">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
          <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          <span>{t("modal_title")}</span>
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("modal_body", {
            sources: warning.hiddenSources.length,
            users: warning.hiddenUsers.length,
          })}
        </p>
        <p className="mb-4 text-sm text-muted-foreground">{t("modal_note")}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="app-btn-ghost rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="app-btn-primary rounded-[var(--radius-control)] px-3 py-1.5 text-sm"
            onClick={onConfirm}
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
