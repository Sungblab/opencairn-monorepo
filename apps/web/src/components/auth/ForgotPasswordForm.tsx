"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      redirectTo: `/${locale}/auth/reset-password`,
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
      <div className="flex flex-col gap-3 text-center py-4">
        <p className="font-sans text-xl text-stone-900">{t("forgot.sent")}</p>
        <p className="text-sm text-stone-500">{t("forgot.sentDesc")}</p>
        <a
          href={`/${locale}/auth/login`}
          className="mt-2 text-sm font-medium text-stone-900 hover:underline"
        >
          {t("forgot.backToLogin")}
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-xl text-stone-900">{t("forgot.title")}</h2>
        <p className="text-sm text-stone-500">{t("forgot.desc")}</p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("forgot.email")}</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : t("forgot.submit")}
      </Button>

      <a
        href={`/${locale}/auth/login`}
        className="text-center text-sm text-stone-500 hover:text-stone-900 transition-colors"
      >
        {t("forgot.backToLogin")}
      </a>
    </form>
  );
}
