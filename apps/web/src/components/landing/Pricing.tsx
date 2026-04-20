"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type Plan = {
  key: "free" | "byok" | "pro" | "selfhost";
  featured?: boolean;
};

const PLANS: Plan[] = [
  { key: "free" },
  { key: "byok" },
  { key: "pro", featured: true },
  { key: "selfhost" },
];

export function Pricing() {
  const t = useTranslations("landing.pricing");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  return (
    <section
      id="pricing"
      ref={ref}
      className="reveal bg-[color:var(--brand-stone-900)] py-24 text-[color:var(--brand-stone-50)] md:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl md:text-5xl">{t("heading")}</h2>
        <p className="mt-3 text-[color:var(--brand-stone-400)]">{t("sub")}</p>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map(({ key, featured }) => (
            <div
              key={key}
              className={
                featured
                  ? "rounded-xl border border-[color:var(--brand-ember-cta)] bg-[color:var(--brand-stone-800)] p-6"
                  : "rounded-xl border border-[color:var(--brand-stone-700)] bg-transparent p-6"
              }
            >
              <h3 className="font-serif text-2xl">{t(`${key}.name`)}</h3>
              <p className="mt-2 text-sm text-[color:var(--brand-stone-400)]">{t(`${key}.tagline`)}</p>
              <p className="mt-6">
                <span className="font-serif text-3xl">{t(`${key}.price`)}</span>
                <span className="ml-1 text-sm text-[color:var(--brand-stone-400)]">{t(`${key}.unit`)}</span>
              </p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-xs text-[color:var(--brand-stone-500)]">{t("vat")}</p>
      </div>
    </section>
  );
}
