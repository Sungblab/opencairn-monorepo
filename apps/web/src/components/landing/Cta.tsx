"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";
import { useCountUp } from "@/lib/landing/hooks/useCountUp";

export function Cta() {
  const t = useTranslations("landing.cta");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const counterRef = useRef<HTMLHeadingElement>(null);
  const minutes = useCountUp(counterRef, 5);

  return (
    <section
      id="cta"
      ref={ref}
      className="reveal border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-stone-50)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2
          ref={counterRef}
          className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-6xl"
        >
          {t("heading", { minutes })}
        </h2>
        <p className="mt-6 text-[color:var(--brand-stone-600)]">{t("sub")}</p>
        <div className="mt-10 flex justify-center gap-4">
          <a
            href="/dashboard"
            className="rounded-full bg-[color:var(--brand-stone-900)] px-6 py-3 text-sm font-medium text-[color:var(--brand-paper)]"
          >
            {t("primary")}
          </a>
          <a
            href="https://github.com/Sungblab/opencairn-monorepo"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[color:var(--brand-stone-300)] px-6 py-3 text-sm font-medium text-[color:var(--brand-stone-700)]"
          >
            {t("secondary")}
          </a>
        </div>
      </div>
    </section>
  );
}
