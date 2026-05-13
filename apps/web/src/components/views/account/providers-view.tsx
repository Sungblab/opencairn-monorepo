"use client";

import { useTranslations } from "next-intl";
import { ByokKeyCardLoader } from "@/components/settings/ByokKeyCardLoader";

// Account-shell BYOK tab. Wraps the same ByokKeyCard the standalone
// /settings/ai page renders so that the account nav (where users
// expect to find provider keys) actually leads to a working surface
// instead of the original stub. The /settings/ai route stays for
// inbound links from research run failures (see ResearchRunView).
export function ProvidersView() {
  const t = useTranslations("account.providers");
  return (
    <section className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{t("heading")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>
      <ByokKeyCardLoader />
    </section>
  );
}
