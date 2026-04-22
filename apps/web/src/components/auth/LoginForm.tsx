"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleButton } from "./GoogleButton";
import { isSafeReturnTo } from "@/lib/return-to";

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("return_to");
    if (r && isSafeReturnTo(r)) setReturnTo(r);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await authClient.signIn.email({ email, password });

    setLoading(false);

    if (authError) {
      if (authError.status === 401) {
        setError(t("errors.invalidCredentials"));
      } else if (authError.message?.toLowerCase().includes("verified")) {
        setError(t("errors.emailNotVerified"));
      } else {
        setError(t("errors.generic"));
      }
      return;
    }

    if (onSuccess) {
      onSuccess();
      return;
    }

    if (returnTo) {
      // return_to has already passed isSafeReturnTo; prepend locale when
      // caller sent the path without one.
      const dest = returnTo.startsWith(`/${locale}`)
        ? returnTo
        : `/${locale}${returnTo}`;
      // Full navigation — some post-login pages (like /onboarding) run
      // server guards that read fresh cookies.
      window.location.href = dest;
      return;
    }

    router.push(`/${locale}/app`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="font-sans text-xl text-stone-900">{t("login.title")}</h2>

      <GoogleButton />

      <div className="flex items-center gap-3 text-xs text-stone-400">
        <hr className="flex-1 border-stone-200" />
        <span>{t("login.orContinueWith")}</span>
        <hr className="flex-1 border-stone-200" />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("login.email")}</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-stone-700">{t("login.password")}</label>
          <a
            href={`/${locale}/auth/forgot-password`}
            className="text-xs text-stone-500 hover:text-stone-900 transition-colors"
          >
            {t("login.forgotPassword")}
          </a>
        </div>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : t("login.submit")}
      </Button>

      <p className="text-center text-sm text-stone-500">
        {t("login.noAccount")}{" "}
        <a
          href={`/${locale}/auth/signup`}
          className="font-medium text-stone-900 hover:underline"
        >
          {t("login.signUp")}
        </a>
      </p>
    </form>
  );
}
