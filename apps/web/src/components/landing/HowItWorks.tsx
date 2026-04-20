"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function HowItWorks() {
  const t = useTranslations("landing.how");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const steps = t.raw("steps") as { n: string; title: string; body: string }[];

  return (
    <section
      id="how"
      ref={ref}
      className="reveal bg-[color:var(--brand-stone-900)] py-24 text-[color:var(--brand-stone-50)] md:py-28"
    >
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl md:text-5xl">{t("heading")}</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="rounded-xl border border-[color:var(--brand-stone-700)] bg-[color:var(--brand-stone-800)] p-6">
              <p className="font-mono text-xs text-[color:var(--brand-stone-400)]">{s.n}</p>
              <h3 className="mt-3 font-serif text-2xl">{s.title}</h3>
              <p className="mt-3 text-sm text-[color:var(--brand-stone-300)]">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
