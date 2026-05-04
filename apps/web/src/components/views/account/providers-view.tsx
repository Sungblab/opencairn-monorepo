"use client";

import { useTranslations } from "next-intl";
import { ByokKeyCard } from "@/components/settings/ByokKeyCard";

// Account-shell BYOK tab. Wraps the same ByokKeyCard the standalone
// /settings/ai page renders so that the account nav (where users
// expect to find provider keys) actually leads to a working surface
// instead of the original stub. The /settings/ai route stays for
// inbound links from research run failures (see ResearchRunView).
export function ProvidersView() {
  const t = useTranslations("account.providers");
  return (
    <section className="max-w-3xl">
      <h1 className="mb-3 text-xl font-semibold">{t("heading")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("description")}</p>
      <ByokKeyCard />
    </section>
  );
}
