import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { SignupForm } from "@/components/auth/SignupForm";
import { GoogleOneTap } from "@/components/auth/GoogleOneTap";

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return (
    <>
      <GoogleOneTap />
      <SignupForm />
    </>
  );
}
