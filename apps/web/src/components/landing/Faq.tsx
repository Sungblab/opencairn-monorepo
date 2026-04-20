"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function Faq() {
  const t = useTranslations("landing.faq");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const items = t.raw("items") as { q: string; a: string }[];

  return (
    <section
      id="faq"
      ref={ref}
      className="reveal border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">
          {t("heading")}
        </h2>
        <div className="mt-10 divide-y divide-[color:var(--brand-stone-200)]">
          {items.map((it, i) => (
            <details key={i} className="group py-4">
              <summary className="flex cursor-pointer items-center justify-between text-left font-serif text-lg">
                {it.q}
                <span className="text-[color:var(--brand-stone-400)] transition-transform group-open:rotate-180">
                  ⌄
                </span>
              </summary>
              <p className="mt-3 text-sm text-[color:var(--brand-stone-600)]">{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
