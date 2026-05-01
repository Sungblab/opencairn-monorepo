"use client";
import { useTranslations, useLocale } from "next-intl";
import { authClient, googleOAuthEnabled } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { urls } from "@/lib/urls";

interface GoogleButtonProps {
  className?: string;
}

export function GoogleButton({ className }: GoogleButtonProps) {
  const t = useTranslations("auth");
  const locale = useLocale();

  // Don't render a social-login affordance we can't honour.
  // [Tier 1 item 1-7]
  if (!googleOAuthEnabled) return null;

  const handleClick = async () => {
    // Better Auth resolves relative callbackURL against its own baseURL
    // (the API at :4000), which would 404. Anchor to the web origin.
    await authClient.signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}${urls.dashboard(locale)}`,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn("auth-btn auth-btn-secondary w-full", className)}
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      {t("google.button")}
    </button>
  );
}
