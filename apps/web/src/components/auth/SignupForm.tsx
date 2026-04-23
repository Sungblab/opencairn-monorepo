"use client";
import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authClient, googleOAuthEnabled } from "@/lib/auth-client";
import { GoogleButton } from "./GoogleButton";
import { AuthEyebrow } from "./AuthEyebrow";

type Step = 1 | 2 | 3;

export function SignupForm() {
  const t = useTranslations("auth");
  const locale = useLocale();

  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inviteToken =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("invite")
      : null;

  useEffect(() => {
    if (inviteToken) {
      try {
        sessionStorage.setItem("opencairn:pending_invite", inviteToken);
      } catch {
        // ignore storage errors (private browsing, disabled storage)
      }
    }
  }, [inviteToken]);

  const goBack = () => {
    setError(null);
    setStep(1);
  };

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(2);
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const callbackBase = `/${locale}/auth/verify-email`;
    const callbackURL = inviteToken
      ? `${callbackBase}?invite=${encodeURIComponent(inviteToken)}`
      : callbackBase;

    const { error: authError } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL,
    });

    setLoading(false);

    if (authError) {
      if (authError.status === 422 || authError.message?.toLowerCase().includes("already")) {
        setError(t("errors.emailAlreadyExists"));
      } else {
        setError(t("errors.generic"));
      }
      return;
    }

    setStep(3);
  };

  const Progress = () => (
    <div className="flex gap-2">
      {([1, 2, 3] as const).map((s) => (
        <div
          key={s}
          className={`h-1 flex-1 rounded-full border-2 border-stone-900 transition-colors duration-300 ${
            s <= step ? "bg-stone-900" : "bg-white"
          }`}
        />
      ))}
    </div>
  );

  if (step === 3) {
    return (
      <div className="flex flex-col gap-6">
        <Progress />
        <div className="flex flex-col gap-3">
          <AuthEyebrow label={t("signup.eyebrow")} />
          <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
            {t("signup.emailSent")}
          </h2>
          <p className="text-sm text-stone-600 kr">{t("signup.emailSentDesc")}</p>
          <p className="text-xs text-stone-800 font-mono font-semibold mt-1 break-all bg-stone-100 border-2 border-stone-900 rounded-md px-2 py-1">
            {email}
          </p>
        </div>
        <a
          href={`/${locale}/auth/login`}
          className="auth-btn auth-btn-secondary w-full kr"
        >
          {t("signup.goLogin")}
        </a>
      </div>
    );
  }

  if (step === 2) {
    return (
      <form onSubmit={handleStep2} className="flex flex-col gap-6">
        <Progress />

        <div className="flex flex-col gap-2.5">
          <AuthEyebrow label={t("signup.eyebrow")} />
          <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
            {t("signup.step2Title")}
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

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="signup-name" className="auth-label">
              {t("signup.name")}
            </label>
            <input
              id="signup-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              autoFocus
              required
              className="auth-input"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="signup-password" className="auth-label">
              {t("signup.password")}
            </label>
            <input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              className="auth-input"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={goBack}
            className="auth-btn auth-btn-secondary flex-1 kr"
          >
            {t("signup.back")}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="auth-btn auth-btn-primary flex-1 kr"
          >
            {loading ? "…" : t("signup.submit")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleStep1} className="flex flex-col gap-6">
      <Progress />

      <div className="flex flex-col gap-2.5">
        <AuthEyebrow label={t("signup.eyebrow")} />
        <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
          {t("signup.title")}
        </h2>
        <p className="text-sm text-stone-600 kr">{t("signup.step1Desc")}</p>
      </div>

      {googleOAuthEnabled && (
        <div className="flex flex-col gap-3">
          <GoogleButton />
          <div className="auth-divider">
            <span>{t("signup.orContinueWith")}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-email" className="auth-label">
          {t("signup.email")}
        </label>
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="name@example.com"
          required
          className="auth-input"
        />
      </div>

      <button type="submit" className="auth-btn auth-btn-primary w-full kr">
        {t("signup.next")}
      </button>

      <p className="text-center text-sm text-stone-600 kr">
        {t("signup.hasAccount")}{" "}
        <a
          href={`/${locale}/auth/login`}
          className="font-bold text-stone-900 underline underline-offset-2 decoration-2 hover:bg-stone-900 hover:text-stone-50 hover:no-underline px-1.5 py-0.5 rounded transition-colors"
        >
          {t("signup.signIn")}
        </a>
      </p>
    </form>
  );
}
