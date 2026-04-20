"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function ProblemBand() {
  const t = useTranslations("landing.problem");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  return (
    <section
      ref={ref}
      className="reveal border-y border-[color:var(--brand-stone-200)] bg-[color:var(--brand-ember-50)] py-16 md:py-20"
    >
      <div className="mx-auto max-w-4xl px-6">
        <h2 className="font-serif text-3xl text-[color:var(--brand-stone-700)] md:text-4xl">
          {t("heading")}{" "}
          <em className="font-serif not-italic text-[color:var(--brand-stone-900)]">
            {t("headingEm")}
          </em>
        </h2>
        <p className="mt-6 text-base text-[color:var(--brand-stone-600)] md:text-lg">
          {t("sub")}
        </p>
      </div>
    </section>
  );
}
