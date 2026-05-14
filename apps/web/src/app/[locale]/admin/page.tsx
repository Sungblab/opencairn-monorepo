import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import type { Locale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { AdminUsersClientLoader } from "./AdminUsersClientLoader";
import { IntlClientProvider } from "@/components/providers/intl-client-provider";

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
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-8">
        <header className="border-b border-border pb-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t("title")}
          </h1>
        </header>
        <IntlClientProvider namespaces={["admin"]}>
          <AdminUsersClientLoader returnHref={`/${locale}/dashboard`} />
        </IntlClientProvider>
      </div>
    </main>
  );
}
