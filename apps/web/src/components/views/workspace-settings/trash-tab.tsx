"use client";

import { useTranslations } from "next-intl";

// Stubbed pending the trash/restore API (Plan 2C).
export function TrashTab() {
  const t = useTranslations("workspaceSettings.trash");
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{t("heading")}</h2>
      <p className="text-sm text-muted-foreground">{t("stub")}</p>
    </section>
  );
}
