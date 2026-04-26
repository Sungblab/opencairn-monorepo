"use client";

import { useTranslations } from "next-intl";

// Stubbed pending the shared-links API (Plan 2C). Layout reserves the slot
// so users discover it exists; copy explains why it's empty.
export function SharedLinksTab() {
  const t = useTranslations("workspaceSettings.sharedLinks");
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{t("heading")}</h2>
      <p className="text-sm text-muted-foreground">{t("stub")}</p>
    </section>
  );
}
