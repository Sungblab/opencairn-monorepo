"use client";

import { useTranslations } from "next-intl";

export function BillingView() {
  const t = useTranslations("account.billing");
  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">
          {t("heading")}
        </h1>
      </div>
      <div className="rounded-[var(--radius-card)] border border-border bg-background px-4 py-5 shadow-sm sm:px-5">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("stub")}</p>
      </div>
    </section>
  );
}
