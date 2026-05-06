"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { authClient, googleOAuthEnabled } from "@/lib/auth-client";
import { GoogleButton } from "./GoogleButton";
import { AuthLegalNotice } from "./AuthLegalNotice";
import { PasswordField } from "./PasswordField";
import { isSafeReturnTo } from "@/lib/return-to";
import { urls } from "@/lib/urls";

type Step = 1 | 2;

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();

  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("return_to");
    if (r && isSafeReturnTo(r)) setReturnTo(r);
  }, []);

  const goBack = () => {
    setError(null);
    setPassword("");
    setStep(1);
  };

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setStep(2);
  };

  const handleStep2 = async (e: React.FormEvent) => {
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
      const dest = returnTo.startsWith(`/${locale}`)
        ? returnTo
        : `/${locale}${returnTo}`;
      window.location.href = dest;
      return;
    }

    router.push(urls.dashboard(locale));
  };

  const Progress = () => (
    <div className="flex gap-2">
      {([1, 2] as const).map((s) => (
        <div
          key={s}
          className={`h-1 flex-1 rounded-full border-2 border-stone-900 transition-colors duration-300 ${
            s <= step ? "bg-stone-900" : "bg-white"
          }`}
        />
      ))}
    </div>
  );

  if (step === 2) {
    return (
      <form onSubmit={handleStep2} className="flex flex-col gap-6">
        <Progress />

        <div className="flex flex-col gap-2.5">
          <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
            {t("login.step2Title")}
          </h2>
          <button
            type="button"
            onClick={goBack}
            className="self-start inline-flex items-center gap-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-900 hover:text-stone-50 border-2 border-transparent hover:border-stone-900 rounded-md px-2 py-1 transition-colors"
          >
            <span>{email}</span>
            <span aria-hidden>↩</span>
          </button>
        </div>

        {error && (
          <p role="alert" aria-live="polite" className="auth-alert kr">
            {error}
          </p>
        )}

        <PasswordField
          id="auth-password"
          label={t("login.password")}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          autoFocus
          showLabel={t("passwordToggle.show")}
          hideLabel={t("passwordToggle.hide")}
          labelAction={
            <a
              href={`/${locale}/auth/forgot-password`}
              className="text-xs font-semibold text-stone-700 hover:bg-stone-900 hover:text-stone-50 underline underline-offset-2 decoration-2 decoration-stone-400 hover:decoration-stone-50 hover:no-underline px-1.5 py-0.5 rounded transition-colors"
            >
              {t("login.forgotPassword")}
            </a>
          }
        />

        <div className="flex gap-3">
          <button
            type="button"
            onClick={goBack}
            className="auth-btn auth-btn-secondary flex-1 kr"
          >
            {t("login.back")}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="auth-btn auth-btn-primary flex-1 kr"
          >
            {loading ? "…" : t("login.submit")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleStep1} className="flex flex-col gap-6">
      <Progress />

      <div className="flex flex-col gap-2.5">
        <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
          {t("login.title")}
        </h2>
        <p className="text-sm text-stone-600 kr">{t("login.subtitle")}</p>
      </div>

      {googleOAuthEnabled && (
        <div className="flex flex-col gap-3">
          <GoogleButton />
          <AuthLegalNotice />
          <div className="auth-divider">
            <span>{t("login.orContinueWith")}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="auth-email" className="auth-label">
          {t("login.email")}
        </label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
          className="auth-input"
        />
      </div>

      <button type="submit" className="auth-btn auth-btn-primary w-full kr">
        {t("login.next")}
      </button>

      <p className="text-center text-sm text-stone-600 kr">
        {t("login.noAccount")}{" "}
        <a
          href={`/${locale}/auth/signup`}
          className="font-bold text-stone-900 underline underline-offset-2 decoration-2 hover:bg-stone-900 hover:text-stone-50 hover:no-underline px-1.5 py-0.5 rounded transition-colors"
        >
          {t("login.signUp")}
        </a>
      </p>
    </form>
  );
}
