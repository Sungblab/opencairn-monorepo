"use client";

import { useTranslations } from "next-intl";

// BYOK key registration is owned by Deep Research Phase E. We render a
// labelled stub so the route exists for navigation tests + eventual cut-in.
export function ProvidersView() {
  const t = useTranslations("account.providers");
  return (
    <section>
      <h1 className="mb-3 text-xl font-semibold">{t("heading")}</h1>
      <p className="text-sm text-muted-foreground">{t("stub")}</p>
    </section>
  );
}
