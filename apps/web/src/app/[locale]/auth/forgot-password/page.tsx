import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <ForgotPasswordForm />;
}
