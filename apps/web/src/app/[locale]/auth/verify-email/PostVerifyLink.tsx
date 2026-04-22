"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// Builds the "go to login" link on the verify-email page. If a pending
// invite is present (URL query OR sessionStorage from signup), the link
// carries return_to=/onboarding?invite=<token> so LoginForm can redirect
// the verified user straight into the accept card.
export function PostVerifyLink({ locale }: { locale: string }) {
  const t = useTranslations("auth.verify");
  const [href, setHref] = useState(`/${locale}/auth/login`);

  useEffect(() => {
    const urlToken = new URLSearchParams(window.location.search).get("invite");
    let token: string | null = urlToken;
    if (!token) {
      try {
        token = sessionStorage.getItem("opencairn:pending_invite");
      } catch {
        // ignore
      }
    }
    if (token) {
      const returnTo = `/onboarding?invite=${encodeURIComponent(token)}`;
      setHref(
        `/${locale}/auth/login?return_to=${encodeURIComponent(returnTo)}`,
      );
    }
  }, [locale]);

  return (
    <a href={href} className="auth-btn auth-btn-primary w-full">
      {t("goLogin")}
    </a>
  );
}
