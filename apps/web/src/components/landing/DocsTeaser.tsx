"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function DocsTeaser() {
  const t = useTranslations("landing.docs");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  return (
    <section
      ref={ref}
      className="reveal border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-stone-50)] py-20 md:py-24"
    >
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="font-serif text-3xl text-[color:var(--brand-stone-900)] md:text-4xl">
          {t("heading")}
        </h2>
        <p className="mt-4 text-[color:var(--brand-stone-600)]">{t("sub")}</p>
        <a
          href="https://github.com/Sungblab/opencairn-monorepo#readme"
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-block text-sm font-medium text-[color:var(--brand-stone-900)] underline underline-offset-4"
        >
          {t("cta")}
        </a>
      </div>
    </section>
  );
}
