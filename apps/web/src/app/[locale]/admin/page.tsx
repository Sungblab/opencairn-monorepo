import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import type { Locale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { AdminUsersClient } from "./AdminUsersClient";

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireSession();
  if (!session.isSiteAdmin) redirect(`/${locale}/dashboard`);

  const t = await getTranslations({ locale, namespace: "admin" });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-3 py-4 sm:px-5 lg:px-8">
        <header className="border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("eyebrow")}
          </p>
          <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {t("title")}
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {t("subtitle")}
              </p>
            </div>
            <div className="border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              {t("accessBadge")}
            </div>
          </div>
        </header>
        <AdminUsersClient />
      </div>
    </main>
  );
}
