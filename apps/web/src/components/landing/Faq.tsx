"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type Item = { q: string; a: string };

export function Faq() {
  const t = useTranslations("landing.faq");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const items = t.raw("items") as Item[];

  return (
    <section ref={ref} id="faq" className="py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-3 mb-6 md:mb-0">
            <span className="sec-label">
              <span className="n">{t("label")}</span>
            </span>
            <h2 className="kr text-3xl text-stone-900 tracking-tight font-semibold mt-4">{t("title")}</h2>
          </div>
          <div className="col-span-12 md:col-span-9 border-y border-stone-900 divide-y divide-stone-300">
            {items.map((it, i) => (
              <details key={i} className="py-6 group">
                <summary className="flex justify-between items-start gap-6 cursor-pointer kr font-serif text-xl md:text-2xl text-stone-900">
                  <span>{it.q}</span>
                  <span className="font-mono text-stone-500 group-open:rotate-45 transition-transform text-2xl leading-none pt-1">
                    +
                  </span>
                </summary>
                <p className="mt-4 text-[14px] text-stone-600 leading-relaxed kr max-w-[640px]">{it.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
