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
        callbackURL: `/${locale}/auth/verify-email`,
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
        redirectTo: `/${locale}/auth/reset-password`,
      });
      setMessage(t("resetSent"));
    } catch {
      setMessage(t("actionFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <h1 className="mb-2 text-xl font-semibold">{t("heading")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="rounded border border-border p-4">
        <h2 className="text-sm font-semibold">{t("session.heading")}</h2>
        {isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("loading")}</p>
        ) : (
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("session.email")}</dt>
              <dd className="truncate">{email || "-"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("session.verified")}</dt>
              <dd>
                {session?.user.emailVerified
                  ? t("session.yes")
                  : t("session.no")}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="rounded border border-border p-4">
        <h2 className="text-sm font-semibold">{t("actions.heading")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={sendVerification}
            disabled={!email || busy !== null || session?.user.emailVerified}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {busy === "verify" ? t("actions.sending") : t("actions.verify")}
          </button>
          <button
            type="button"
            onClick={sendReset}
            disabled={!email || busy !== null}
            className="rounded border border-border px-3 py-1.5 text-sm transition hover:bg-accent disabled:opacity-50"
          >
            {busy === "reset" ? t("actions.sending") : t("actions.reset")}
          </button>
        </div>
        {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
      </div>
    </section>
  );
}
