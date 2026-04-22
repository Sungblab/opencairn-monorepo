import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations({ locale, namespace: "auth.layout" });

  return (
    <div
      data-brand="auth"
      data-theme="cairn-light"
      className="min-h-screen bg-stone-50 flex"
    >
      {/* Left panel — brand / editorial */}
      <div className="hidden lg:flex flex-col justify-between flex-1 bg-stone-900 text-stone-50 p-12 xl:p-16">
        <a
          href={`/${locale}`}
          className="font-serif text-2xl text-stone-50 hover:text-stone-300 transition-colors"
        >
          OpenCairn
        </a>

        <div className="flex flex-col gap-8">
          <p className="font-sans text-4xl xl:text-5xl leading-tight text-stone-50">
            {t("headline")}
          </p>
          <ul className="flex flex-col gap-3">
            {(["point1", "point2", "point3"] as const).map((key) => (
              <li key={key} className="flex items-start gap-3 text-sm text-stone-400">
                <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full border border-stone-600 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-stone-600 font-sans tracking-wider">
          {t("footnote")}
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Mobile-only logo */}
        <a
          href={`/${locale}`}
          className="lg:hidden mb-10 font-serif text-2xl text-stone-900 hover:text-stone-700 transition-colors"
        >
          OpenCairn
        </a>
        <div className="w-full max-w-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
