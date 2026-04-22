"use client";

// Plan 2B Task 17 — banner shown when the server-resolved role for the
// current user is viewer/commenter. The caller (NoteEditor) gates rendering
// via the `readOnly` prop, so this component is presentational-only.

import { useTranslations } from "next-intl";

export function ReadOnlyBanner() {
  const t = useTranslations("collab.collab");
  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      {t("readonly_banner")}
    </div>
  );
}
