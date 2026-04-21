"use client";
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleButton } from "./GoogleButton";

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

    setStep(3);
  };

  const Progress = () => (
    <div className="flex gap-1.5">
      {([1, 2, 3] as const).map((s) => (
        <div
          key={s}
          className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
            s <= step ? "bg-stone-900" : "bg-stone-200"
          }`}
        />
      ))}
    </div>
  );

  if (step === 3) {
    return (
      <div className="flex flex-col gap-5">
        <Progress />
        <div className="flex flex-col gap-3 py-2">
          <p className="font-sans text-xl text-stone-900">{t("signup.emailSent")}</p>
          <p className="text-sm text-stone-500">{t("signup.emailSentDesc")}</p>
          <p className="text-xs text-stone-400 font-sans mt-1">{email}</p>
        </div>
        <a
          href={`/${locale}/auth/login`}
          className="text-center text-sm font-medium text-stone-900 hover:underline"
        >
          {t("signup.goLogin")}
        </a>
      </div>
    );
  }

  if (step === 2) {
    return (
      <form onSubmit={handleStep2} className="flex flex-col gap-5">
        <Progress />

        <div className="flex flex-col gap-0.5">
          <h2 className="font-sans text-xl text-stone-900">{t("signup.step2Title")}</h2>
          <button
            type="button"
            onClick={goBack}
            className="text-left text-sm text-stone-400 hover:text-stone-600 transition-colors font-sans"
          >
            {email} ↩
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-stone-700">{t("signup.name")}</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              autoFocus
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
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={goBack} className="flex-1">
            {t("signup.back")}
          </Button>
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? "..." : t("signup.submit")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleStep1} className="flex flex-col gap-5">
      <Progress />

      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-xl text-stone-900">{t("signup.title")}</h2>
        <p className="text-sm text-stone-500">{t("signup.step1Desc")}</p>
      </div>

      <GoogleButton />

      <div className="flex items-center gap-3 text-xs text-stone-400">
        <hr className="flex-1 border-stone-200" />
        <span>{t("signup.orContinueWith")}</span>
        <hr className="flex-1 border-stone-200" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">{t("signup.email")}</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="name@example.com"
          required
        />
      </div>

      <Button type="submit" className="w-full">{t("signup.next")}</Button>

      <p className="text-center text-sm text-stone-500">
        {t("signup.hasAccount")}{" "}
        <a href={`/${locale}/auth/login`} className="font-medium text-stone-900 hover:underline">
          {t("signup.signIn")}
        </a>
      </p>
    </form>
  );
}
