"use client";

import { useTranslations } from "next-intl";

export function BillingView() {
  const t = useTranslations("account.billing");
  return (
    <section>
      <h1 className="mb-3 text-xl font-semibold">{t("heading")}</h1>
      <p className="text-sm text-muted-foreground">{t("stub")}</p>
    </section>
  );
}
