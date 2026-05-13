"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export function SecurityView() {
  const t = useTranslations("account.security");
  const locale = useLocale();
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState<"verify" | "reset" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const email = session?.user.email ?? "";

  async function postAuth(path: string, body: unknown) {
    const res = await fetch(`/api/auth/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`auth ${path} ${res.status}`);
  }

  async function sendVerification() {
    if (!email) return;
    setBusy("verify");
    setMessage(null);
    try {
      await postAuth("send-verification-email", {
        email,
        callbackURL: `${window.location.origin}/${locale}/auth/verify-email`,
      });
      setMessage(t("verificationSent"));
    } catch {
      setMessage(t("actionFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function sendReset() {
    if (!email) return;
    setBusy("reset");
    setMessage(null);
    try {
      await postAuth("forget-password", {
        email,
        redirectTo: `${window.location.origin}/${locale}/auth/reset-password`,
      });
      setMessage(t("resetSent"));
    } catch {
      setMessage(t("actionFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{t("heading")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-[var(--radius-card)] border border-border bg-background shadow-sm">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h2 className="text-sm font-semibold">{t("session.heading")}</h2>
        </div>
        {isPending ? (
          <p className="px-4 py-5 text-sm text-muted-foreground sm:px-5">
            {t("loading")}
          </p>
        ) : (
          <dl className="grid gap-3 px-4 py-5 text-sm sm:px-5">
            <div className="flex min-w-0 justify-between gap-4">
              <dt className="text-muted-foreground">{t("session.email")}</dt>
              <dd className="truncate">{email || "-"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("session.verified")}</dt>
              <dd className="font-medium">
                {session?.user.emailVerified
                  ? t("session.yes")
                  : t("session.no")}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="rounded-[var(--radius-card)] border border-border bg-background shadow-sm">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h2 className="text-sm font-semibold">{t("actions.heading")}</h2>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-5 sm:px-5">
          <button
            type="button"
            onClick={sendVerification}
            disabled={!email || busy !== null || session?.user.emailVerified}
            className="app-btn-primary min-h-10 rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy === "verify" ? t("actions.sending") : t("actions.verify")}
          </button>
          <button
            type="button"
            onClick={sendReset}
            disabled={!email || busy !== null}
            className="app-btn-ghost min-h-10 rounded-[var(--radius-control)] border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy === "reset" ? t("actions.sending") : t("actions.reset")}
          </button>
          {message && (
            <p className="basis-full text-sm text-muted-foreground">{message}</p>
          )}
        </div>
      </div>
      </div>
    </section>
  );
}
