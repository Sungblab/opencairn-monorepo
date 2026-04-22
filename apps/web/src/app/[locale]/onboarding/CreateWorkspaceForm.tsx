"use client";
import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-sans text-xl text-stone-900">{t("title")}</h2>
        <p className="text-sm text-stone-500">{t("desc")}</p>
      </div>

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md"
        >
          {tErr(error)}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700" htmlFor="ws-name">
          {t("nameLabel")}
        </label>
        <Input
          id="ws-name"
          data-testid="ws-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="organization"
          autoFocus
          required
          maxLength={120}
        />
        <p className="text-xs text-stone-400">{t("autoSlugHint")}</p>
      </div>

      <Button
        type="submit"
        disabled={loading}
        data-testid="ws-submit"
        className="w-full"
      >
        {loading ? "…" : t("submit")}
      </Button>
    </form>
  );
}
