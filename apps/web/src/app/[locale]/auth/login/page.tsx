import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { LoginForm } from "@/components/auth/LoginForm";
import { GoogleOneTap } from "@/components/auth/GoogleOneTap";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return (
    <>
      <GoogleOneTap />
      <LoginForm />
    </>
  );
}
