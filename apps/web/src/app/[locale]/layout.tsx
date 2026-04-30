import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { locales, type Locale } from "@/i18n";
import { Toaster } from "@/components/ui/toaster";
import { ReactQueryProvider } from "@/lib/react-query";
import { CommandPalette } from "@/components/palette/command-palette";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale as Locale);
  const messages = await getMessages();

  // Toaster, ReactQueryProvider, and CommandPalette all live at the locale
  // boundary so non-(shell) routes (/settings, /onboarding, /auth, /s/<token>)
  // get toasts, can use react-query, and can open the global palette.
  // Theme tokens come from the root layout's `data-theme`, so colours track
  // palette changes without re-mounting either provider.
  return (
    <NextIntlClientProvider messages={messages}>
      <ReactQueryProvider>
        {children}
        <Toaster />
        <CommandPalette />
      </ReactQueryProvider>
    </NextIntlClientProvider>
  );
}
