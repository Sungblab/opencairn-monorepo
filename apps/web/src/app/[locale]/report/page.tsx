import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { ReportIssueClient } from "./ReportIssueClient";

export default async function ReportIssuePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSession();
  const t = await getTranslations({ locale, namespace: "admin.reportForm" });

  return (
    <main className="min-h-screen bg-background px-3 py-4 text-foreground sm:px-5 lg:px-8">
      <div className="mx-auto grid max-w-3xl gap-4">
        <header className="border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </header>
        <ReportIssueClient />
      </div>
    </main>
  );
}
