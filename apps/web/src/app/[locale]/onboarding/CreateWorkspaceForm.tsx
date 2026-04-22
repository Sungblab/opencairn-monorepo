"use client";
import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthEyebrow } from "@/components/auth/AuthEyebrow";

type ErrorKind = "required" | "network" | "generic";

export function CreateWorkspaceForm({ locale }: { locale: string }) {
  const t = useTranslations("onboarding.create");
  const tErr = useTranslations("onboarding.create.errors");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("required");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
        signal: controller.signal,
      });
      if (res.status === 201) {
        const ws = (await res.json()) as { slug: string };
        window.location.href = `/${locale}/app/w/${ws.slug}`;
        return;
      }
      setError("generic");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError("network");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <AuthEyebrow label={t("eyebrow")} />
          <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
            {t("title")}
          </h2>
          <p className="text-sm text-stone-600 kr">{t("desc")}</p>
        </div>

        {error && (
          <p role="alert" aria-live="polite" className="auth-alert kr">
            {tErr(error)}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="auth-label" htmlFor="ws-name">
            {t("nameLabel")}
          </label>
          <input
            id="ws-name"
            data-testid="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="organization"
            autoFocus
            required
            maxLength={120}
            className="auth-input"
          />
          <p className="text-xs font-semibold text-stone-600 mt-1 kr">
            {t("autoSlugHint")}
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          data-testid="ws-submit"
          className="auth-btn auth-btn-primary w-full kr"
        >
          {loading ? "…" : t("submit")}
        </button>
      </form>
    </AuthCard>
  );
}
