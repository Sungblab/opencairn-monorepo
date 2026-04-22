import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";
import { AuthEyebrow } from "@/components/auth/AuthEyebrow";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthCairn } from "@/components/auth/AuthCairn";

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
      className="min-h-screen bg-stone-100 flex"
    >
      {/* Left panel — brand / editorial */}
      <div className="hidden lg:flex flex-col flex-1 bg-stone-900 text-stone-50 p-12 xl:p-16 relative overflow-hidden">
        {/* TOP — logo */}
        <a
          href={`/${locale}`}
          className="self-start font-serif text-2xl text-stone-50 hover:bg-stone-50 hover:text-stone-900 px-3 py-1 rounded-md transition-colors relative z-10 auth-rise-1"
        >
          OpenCairn
        </a>

        {/* MIDDLE — eyebrow + headline + bullets, vertically centered */}
        <div className="flex-1 flex flex-col justify-center gap-8 relative z-10">
          <div className="auth-rise-2">
            <AuthEyebrow label={t("eyebrow")} tone="light" />
          </div>
          <p className="font-sans text-4xl xl:text-5xl leading-[1.1] text-stone-50 kr max-w-xl auth-rise-3">
            {t("headline")}
          </p>
          <ul className="flex flex-col gap-3 max-w-md">
            {(["point1", "point2", "point3"] as const).map((key, i) => (
              <li
                key={key}
                className={`flex items-start gap-3 text-sm text-stone-300 leading-relaxed kr auth-rise-${4 + i}`}
              >
                <span className="mt-2 shrink-0 w-3 h-px bg-stone-500" aria-hidden />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>

        {/* BOTTOM — ambient cairn stack */}
        <div className="self-start relative z-10 auth-rise-7">
          <AuthCairn />
        </div>

        {/* subtle grid overlay to match landing rhythm */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px)",
            backgroundSize: "calc(100% / 12) 100%",
          }}
          aria-hidden
        />
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Mobile-only logo */}
        <a
          href={`/${locale}`}
          className="lg:hidden mb-8 font-serif text-2xl text-stone-900 hover:bg-stone-900 hover:text-stone-50 px-3 py-1 rounded-md transition-colors"
        >
          OpenCairn
        </a>
        <div className="w-full max-w-md">
          <AuthCard>{children}</AuthCard>
        </div>
      </div>
    </div>
  );
}
