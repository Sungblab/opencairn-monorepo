import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";
import { instrumentSerif } from "@/lib/landing/fonts";
import { IntlClientProvider } from "@/components/providers/intl-client-provider";

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
    <IntlClientProvider namespaces={["onboarding"]}>
      <div
        data-brand="onboarding"
        data-theme="cairn-light"
        className={`${instrumentSerif.variable} min-h-screen bg-stone-100 flex flex-col items-center justify-center p-6`}
      >
        <div className="w-full max-w-md flex flex-col gap-6">
          <header className="flex flex-col items-center gap-3 text-center">
            <a
              href={`/${locale}`}
              className="font-serif text-xl text-stone-900 hover:bg-stone-900 hover:text-stone-50 px-3 py-1 rounded-md transition-colors"
            >
              {t("brand")}
            </a>
            <p className="font-sans text-sm text-stone-600 kr">
              {t("headline")}
            </p>
          </header>
          {children}
          <p className="text-[11px] text-stone-400 font-sans tracking-[0.18em] uppercase text-center">
            {t("footnote")}
          </p>
        </div>
      </div>
    </IntlClientProvider>
  );
}
