"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function Personas() {
  const t = useTranslations("landing.who");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  return (
    <section
      ref={ref}
      className="reveal border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-stone-50)] py-24 md:py-28"
    >
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">
          {t("heading")}
        </h2>
      </div>
    </section>
  );
}
