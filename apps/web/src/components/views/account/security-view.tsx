"use client";

import { useTranslations } from "next-intl";

export function SecurityView() {
  const t = useTranslations("account.security");
  return (
    <section>
      <h1 className="mb-3 text-xl font-semibold">{t("heading")}</h1>
      <p className="text-sm text-muted-foreground">{t("stub")}</p>
    </section>
  );
}
