"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const locale = useLocale();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/${locale}/auth/reset-password`,
    });

    setLoading(false);

    if (authError) {
      setError(t("errors.generic"));
      return;
    }

    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
            {t("forgot.sent")}
          </h2>
          <p className="text-sm text-stone-600 kr">{t("forgot.sentDesc")}</p>
        </div>
        <a
          href={`/${locale}/auth/login`}
          className="auth-btn auth-btn-secondary w-full kr"
        >
          {t("forgot.backToLogin")}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
          {t("forgot.title")}
        </h2>
        <p className="text-sm text-stone-600 kr">{t("forgot.desc")}</p>
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="auth-alert kr">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="forgot-email" className="auth-label">
          {t("forgot.email")}
        </label>
        <input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="auth-input"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="auth-btn auth-btn-primary w-full kr"
      >
        {loading ? "…" : t("forgot.submit")}
      </button>

      <a
        href={`/${locale}/auth/login`}
        className="text-center text-sm font-semibold text-stone-700 hover:bg-stone-900 hover:text-stone-50 py-2 rounded-md border-2 border-transparent hover:border-stone-900 transition-colors"
      >
        {t("forgot.backToLogin")}
      </a>
    </form>
  );
}
