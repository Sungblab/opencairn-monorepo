import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  return (
    <div
      data-brand="auth"
      data-theme="cairn-light"
      className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-4"
    >
      <a
        href={`/${locale}`}
        className="mb-10 font-serif text-2xl text-stone-900 hover:text-stone-700 transition-colors"
      >
        OpenCairn
      </a>
      <div className="w-full max-w-sm bg-white rounded-xl border border-stone-200 p-8 shadow-sm">
        {children}
      </div>
    </div>
  );
}
