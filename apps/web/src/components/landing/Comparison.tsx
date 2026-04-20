"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function Comparison() {
  const t = useTranslations("landing.vs");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const rows = t.raw("rows") as { dimension: string; others: string; opencairn: string }[];

  return (
    <section
      id="vs"
      ref={ref}
      className="reveal border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-stone-50)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">
          {t("heading")}
        </h2>
        <table className="mt-10 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--brand-stone-300)] text-sm">
              <th className="py-3 font-medium">{t("colDimension")}</th>
              <th className="py-3 font-medium text-[color:var(--brand-stone-500)]">{t("colOthers")}</th>
              <th className="py-3 font-serif text-base">OpenCairn</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[color:var(--brand-stone-200)] text-sm">
                <td className="py-4 text-[color:var(--brand-stone-700)]">{r.dimension}</td>
                <td className="py-4 text-[color:var(--brand-stone-500)]">{r.others}</td>
                <td className="py-4 text-[color:var(--brand-stone-900)]">{r.opencairn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
