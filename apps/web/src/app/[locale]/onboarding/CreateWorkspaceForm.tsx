"use client";
import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deriveSlug, isValidSlug } from "@/lib/slug";

type ErrorKind =
  | "required"
  | "slug_invalid"
  | "slug_reserved"
  | "slug_conflict"
  | "network"
  | "generic";

export function CreateWorkspaceForm({ locale }: { locale: string }) {
  const t = useTranslations("onboarding.create");
  const tErr = useTranslations("onboarding.create.errors");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-derive slug while user hasn't manually edited it.
  useEffect(() => {
    if (!slugTouched) setSlug(deriveSlug(name));
  }, [name, slugTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuggestions([]);

    if (!name.trim()) {
      setError("required");
      return;
    }
    if (!isValidSlug(slug)) {
      setError("slug_invalid");
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
        body: JSON.stringify({ name: name.trim(), slug }),
        signal: controller.signal,
      });
      if (res.status === 201) {
        const ws = (await res.json()) as { slug: string };
        window.location.href = `/${locale}/app/w/${ws.slug}`;
        return;
      }
      if (res.status === 409) {
        setError("slug_conflict");
        setSuggestions([`${slug}-2`, `${slug}-3`, `${slug}-4`]);
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          body.error === "reserved_slug" ? "slug_reserved" : "slug_invalid",
        );
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
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="text-stone-500">{t("suggest")}:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSlug(s);
                setSlugTouched(true);
              }}
              className="px-2 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-800 font-mono"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
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
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-stone-700" htmlFor="ws-slug">
            {t("slugLabel")}
          </label>
          <Input
            id="ws-slug"
            data-testid="ws-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase());
              setSlugTouched(true);
            }}
            pattern="[a-z0-9-]+"
            minLength={3}
            maxLength={40}
            required
          />
          <p className="text-xs text-stone-400 font-mono">
            {t("slugHintPrefix")}
            <span className="text-stone-700">
              {slug || t("slugHintPlaceholder")}
            </span>
          </p>
        </div>
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
