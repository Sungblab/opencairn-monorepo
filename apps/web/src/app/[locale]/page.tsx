import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";

export default async function Landing({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingInner />;
}

function LandingInner() {
  const t = useTranslations("landing.hero");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="font-serif text-6xl">{t("title")}</h1>
      <p className="mt-4 text-lg text-fg-muted">{t("sub")}</p>
      <a
        href="/dashboard"
        className="mt-8 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-fg"
      >
        {t("cta")}
      </a>
    </main>
  );
}
