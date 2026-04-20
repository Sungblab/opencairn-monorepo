"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";
import { useTypewriter } from "@/lib/landing/hooks/useTypewriter";

export function Hero() {
  const t = useTranslations("landing.hero");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  const rotatingWords = t.raw("rotatingWords") as string[];
  const typed = useTypewriter(rotatingWords);

  return (
    <section
      ref={ref}
      className="reveal relative overflow-hidden bg-[color:var(--brand-paper)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[color:var(--brand-stone-500)]">
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 font-serif text-5xl leading-tight text-[color:var(--brand-stone-900)] md:text-7xl">
          <span>{typed}</span>
          <span
            className="ml-[0.08em] inline-block h-[0.95em] w-[0.08em] animate-pulse bg-[color:var(--brand-ember-cta)] align-baseline"
            aria-hidden
          />
          <br />
          <em className="font-serif not-italic">{t("titleEm")}</em>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-[color:var(--brand-stone-600)]">
          {t("sub")}
        </p>
        <div className="mt-10 flex items-center gap-4">
          <a
            href="/dashboard"
            className="rounded-full bg-[color:var(--brand-stone-900)] px-6 py-3 text-sm font-medium text-[color:var(--brand-paper)] hover:opacity-90"
          >
            {t("cta")}
          </a>
          <a
            href="#how"
            className="text-sm font-medium text-[color:var(--brand-stone-600)] hover:text-[color:var(--brand-stone-900)]"
          >
            {t("ctaGhost")}
          </a>
        </div>
      </div>
    </section>
  );
}
