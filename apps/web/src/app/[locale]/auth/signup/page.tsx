import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { SignupForm } from "@/components/auth/SignupForm";

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return <SignupForm />;
}
