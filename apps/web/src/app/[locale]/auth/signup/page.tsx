import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n";
import { SignupForm } from "@/components/auth/SignupForm";
import { GoogleOneTap } from "@/components/auth/GoogleOneTap";

export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const [{ locale }, { invite }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as Locale);

  // Already signed in? Skip signup entirely. With an invite in hand we go
  // to onboarding (which will resolve the token); otherwise /app.
  const cookieHeader = (await cookies()).toString();
  const apiBase = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const meRes = await fetch(`${apiBase}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (meRes.ok) {
    if (invite) {
      redirect(`/${locale}/onboarding?invite=${encodeURIComponent(invite)}`);
    }
    redirect(`/${locale}/app`);
  }

  return (
    <>
      <GoogleOneTap />
      <SignupForm />
    </>
  );
}
