"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function WorkspaceShowcase() {
  const t = useTranslations("landing.workspace");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const points = t.raw("points") as { title: string; body: string }[];

  return (
    <section
      ref={ref}
      className="reveal border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] py-24 md:py-28"
    >
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">
          {t("heading")}
        </h2>
        <p className="mt-4 max-w-2xl text-[color:var(--brand-stone-600)]">{t("sub")}</p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {points.map((p, i) => (
            <div
              key={i}
              className="rounded-xl border border-[color:var(--brand-stone-200)] bg-[color:var(--brand-stone-50)] p-6"
            >
              <h3 className="font-serif text-xl text-[color:var(--brand-stone-900)]">{p.title}</h3>
              <p className="mt-3 text-sm text-[color:var(--brand-stone-600)]">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
