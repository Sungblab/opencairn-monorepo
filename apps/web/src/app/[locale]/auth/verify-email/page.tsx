import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale as Locale);

  const t = await getTranslations({ locale: locale as Locale, namespace: "auth" });
  const hasError = !!error;

  return (
    <div className="flex flex-col gap-4 text-center py-2">
      {hasError ? (
        <>
          <p className="font-sans text-xl text-stone-900">{t("verify.error")}</p>
          <p className="text-sm text-stone-500">{t("verify.errorDesc")}</p>
          <a
            href={`/${locale}/auth/signup`}
            className="mt-2 inline-block bg-stone-900 text-stone-50 text-sm font-medium px-4 py-2 rounded-md hover:bg-stone-800 transition-colors"
          >
            {t("verify.retry")}
          </a>
        </>
      ) : (
        <>
          <p className="font-sans text-xl text-stone-900">{t("verify.success")}</p>
          <p className="text-sm text-stone-500">{t("verify.successDesc")}</p>
          <a
            href={`/${locale}/auth/login`}
            className="mt-2 inline-block bg-stone-900 text-stone-50 text-sm font-medium px-4 py-2 rounded-md hover:bg-stone-800 transition-colors"
          >
            {t("verify.goLogin")}
          </a>
        </>
      )}
    </div>
  );
}
