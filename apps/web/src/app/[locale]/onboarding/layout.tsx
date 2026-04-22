import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";

export default async function OnboardingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations({ locale, namespace: "onboarding.layout" });

  return (
    <div
      data-brand="onboarding"
      data-theme="cairn-light"
      className="min-h-screen bg-stone-50 flex items-center justify-center p-6"
    >
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="flex flex-col gap-1">
          <p className="font-sans text-sm text-stone-400">{t("brand")}</p>
          <h1 className="font-sans text-2xl text-stone-900">{t("headline")}</h1>
        </header>
        {children}
        <p className="text-xs text-stone-400 font-sans text-center">
          {t("footnote")}
        </p>
      </div>
    </div>
  );
}
