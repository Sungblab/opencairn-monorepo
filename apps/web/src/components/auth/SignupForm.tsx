"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleButton } from "./GoogleButton";

interface SignupFormProps {
  onSuccess?: () => void;
}

export function SignupForm({ onSuccess }: SignupFormProps) {
  const t = useTranslations("auth");
  const locale = useLocale();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: `/${locale}/auth/verify-email`,
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

    setEmailSent(true);
    onSuccess?.();
  };

  if (emailSent) {
    return (
      <div className="flex flex-col gap-3 text-center py-4">
        <p className="font-serif text-xl text-stone-900">{t("signup.emailSent")}</p>
        <p className="text-sm text-stone-500">{t("signup.emailSentDesc")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="font-serif text-xl text-stone-900">{t("signup.title")}</h2>

      <GoogleButton />

      <div className="flex items-center gap-3 text-xs text-stone-400">
        <hr className="flex-1 border-stone-200" />
        <span>{t("signup.orContinueWith")}</span>
        <hr className="flex-1 border-stone-200" />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("signup.name")}</label>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("signup.email")}</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("signup.password")}</label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : t("signup.submit")}
      </Button>

      <p className="text-center text-sm text-stone-500">
        {t("signup.hasAccount")}{" "}
        <a
          href={`/${locale}/auth/login`}
          className="font-medium text-stone-900 hover:underline"
        >
          {t("signup.signIn")}
        </a>
      </p>
    </form>
  );
}
