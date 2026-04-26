import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { locales, type Locale } from "@/i18n";
import { Toaster } from "@/components/ui/toaster";

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

  // Toaster lives at the locale boundary (lifted from ShellProviders in
  // Phase 5) so onboarding / auth / settings — anything outside the (shell)
  // route group — also gets toast notifications. The Toaster itself reads
  // the theme from the root layout's `data-theme`, so colours track palette
  // changes without re-mounting.
  return (
    <NextIntlClientProvider messages={messages}>
      {children}
      <Toaster />
    </NextIntlClientProvider>
  );
}
