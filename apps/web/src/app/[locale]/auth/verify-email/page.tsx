import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n";
import { PostVerifyLink } from "./PostVerifyLink";

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
          {hasError ? t("verify.error") : t("verify.success")}
        </h2>
        <p className="text-sm text-stone-600 kr">
          {hasError ? t("verify.errorDesc") : t("verify.successDesc")}
        </p>
      </div>
      {hasError ? (
        <a
          href={`/${locale}/auth/signup`}
          className="auth-btn auth-btn-primary w-full"
        >
          {t("verify.retry")}
        </a>
      ) : (
        <PostVerifyLink locale={locale} />
      )}
    </div>
  );
}
