"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type Agent = { n: string; cat: string; name: string; body: string };

export function AgentsGrid() {
  const t = useTranslations("landing.agents");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const items = t.raw("items") as Agent[];

  return (
    <section ref={ref} id="agents" className="py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="mb-16 reveal">
          <h2 className="kr text-3xl md:text-5xl text-stone-900 leading-[1.05] tracking-tight font-semibold mb-5">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="kr text-[15px] text-stone-600 leading-relaxed max-w-[560px]">
            {t("sub")}
          </p>
        </div>

        <div className="grid grid-cols-12 border border-stone-900 rounded-2xl overflow-hidden reveal-stagger">
          {items.map((a, i) => (
            <div key={i} className="col-span-6 md:col-span-3 agent-cell tilt">
              <div className="flex items-baseline justify-between mb-3">
                <span className="font-sans text-[11px] tracking-widest text-stone-900">{a.n}</span>
                <span className="font-sans text-[10px] tracking-widest text-stone-500 uppercase">{a.cat}</span>
              </div>
              <h3 className="font-sans text-xl text-stone-900 mb-2">{a.name}</h3>
              <p className="kr text-[14px] text-stone-600 leading-relaxed">{a.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
