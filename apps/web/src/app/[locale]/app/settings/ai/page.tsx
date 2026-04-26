import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";
import { ByokKeyCard } from "@/components/settings/ByokKeyCard";

export default async function SettingsAiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const cookieHeader = (await cookies()).toString();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  // Auth guard — mirror onboarding/page.tsx pattern.
  const meRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!meRes.ok) {
    redirect(
      `/${locale}/auth/login?return_to=${encodeURIComponent(
        `/${locale}/app/settings/ai`,
      )}`,
    );
  }

  const t = await getTranslations({ locale: locale as Locale, namespace: "settings.ai" });

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <ByokKeyCard />
    </main>
  );
}
