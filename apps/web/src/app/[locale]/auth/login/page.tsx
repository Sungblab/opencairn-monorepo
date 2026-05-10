import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { GoogleOneTapLoader } from "@/components/auth/GoogleOneTapLoader";
import { LoginFormLoader } from "@/components/auth/LoginFormLoader";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  return (
    <>
      <GoogleOneTapLoader />
      <LoginFormLoader />
    </>
  );
}
