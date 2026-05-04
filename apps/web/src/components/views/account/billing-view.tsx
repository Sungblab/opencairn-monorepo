"use client";

import { useTranslations } from "next-intl";

export function BillingView() {
  const t = useTranslations("account.billing");
  return (
    <section className="max-w-2xl rounded-[var(--radius-card)] border border-border bg-background p-4">
      <h1 className="mb-3 text-xl font-semibold">{t("heading")}</h1>
      <p className="text-sm text-muted-foreground">{t("stub")}</p>
    </section>
  );
}
