"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type Step = { n: string; title: string; body: string };

export function HowItWorks() {
  const t = useTranslations("landing.pipeline");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const steps = t.raw("steps") as Step[];

  return (
    <section ref={ref} id="how" className="bg-stone-900 text-stone-50 py-24 md:py-28 border-y border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="mb-16 reveal">
          <h2 className="kr text-3xl md:text-5xl leading-[1.05] tracking-tight font-semibold mb-5">
            {t("title1")}
            <br />
            <span className="text-stone-500">{t("title2")}</span> {t("title3")}
          </h2>
          <p className="kr text-[15px] text-stone-400 leading-relaxed max-w-[540px]">
            {t("sub")}
          </p>
        </div>

        <div className="grid grid-cols-12 border border-stone-700 rounded-2xl overflow-hidden reveal-stagger">
          {steps.map((s, i) => (
            <div key={i} className="col-span-12 md:col-span-2 pipe-step">
              <div
                className={`text-[11px] tracking-widest uppercase mb-6 ${
                  i < 3 ? "text-stone-500" : "text-stone-300"
                }`}
              >
                {s.n}
              </div>
              <div className="font-sans text-2xl mb-3">{s.title}</div>
              <p className="text-[14px] text-stone-400 leading-relaxed kr">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-14 font-mono text-[12.5px] text-stone-400 leading-relaxed reveal">
          <span className="text-stone-50">{t("terminal.prompt")}</span> {t("terminal.cmd")}
          <span className="mx-3 text-stone-600">→</span>
          {t("terminal.result")}
          <span className="mx-3 text-stone-600">→</span>
          <span className="text-stone-50">{t("terminal.tail")}</span>
        </div>

        <div className="mt-20 pt-12 border-t border-stone-700 reveal">
          <h3 className="kr font-sans text-2xl md:text-3xl leading-[1.15] mb-4">
            {t("citation.title")}
          </h3>
          <p className="kr text-[14px] text-stone-400 leading-relaxed max-w-[560px] mb-5">
            {t("citation.body")}
          </p>
          <div className="inline-flex flex-wrap items-center gap-2 font-mono text-[12px] text-stone-400 border border-stone-700 px-4 py-3 bg-stone-800 rounded-lg">
            <span className="text-stone-50">↪</span>
            <span>{t("citation.pillKey")}</span>
            <span className="text-stone-500">: [</span>
            <span className="text-stone-300">{t("citation.pillA")}</span>
            <span className="text-stone-500">,</span>
            <span className="text-stone-300">{t("citation.pillB")}</span>
            <span className="text-stone-500">]</span>
          </div>
        </div>
      </div>
    </section>
  );
}
