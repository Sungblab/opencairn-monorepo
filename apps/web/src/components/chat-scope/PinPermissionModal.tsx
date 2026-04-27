"use client";

import { useTranslations } from "next-intl";
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
}): JSX.Element {
  const t = useTranslations("chatScope.pin");
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-md rounded-md bg-white p-4">
        <h2 className="mb-2 font-semibold text-stone-900">⚠ {t("modal_title")}</h2>
        <p className="mb-3 text-sm text-stone-700">
          {t("modal_body", {
            sources: warning.hiddenSources.length,
            users: warning.hiddenUsers.length,
          })}
        </p>
        <p className="mb-4 text-sm text-stone-700">{t("modal_note")}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-stone-300 px-3 py-1.5"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="rounded bg-stone-900 px-3 py-1.5 text-white"
            onClick={onConfirm}
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
