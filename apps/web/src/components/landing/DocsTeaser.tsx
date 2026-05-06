"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function DocsTeaser() {
  const t = useTranslations("landing.install");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const bullets = t.raw("bullets") as string[];
  const lines = t.raw("terminalLines") as string[];
  const oks = t.raw("terminalOk") as string[];

  return (
    <section ref={ref} id="docs" className="py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="mb-14 reveal">
          <h2 className="kr text-3xl md:text-5xl text-stone-900 leading-[1.05] tracking-tight font-semibold mb-5">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="kr text-[15px] text-stone-600 leading-relaxed max-w-[560px]">{t("sub")}</p>
        </div>

        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 md:col-span-5">
            <ul className="space-y-3 text-[13.5px] text-stone-700 border-t border-stone-900 pt-6">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-[11px] text-stone-900 pt-0.5">→</span>
                  <span className="kr">{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="col-span-12 md:col-span-7">
            <div className="bg-stone-900 text-stone-50 p-6 font-mono text-[13px] border border-stone-900 rounded-xl shadow-lg">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-stone-700">
                <span className="w-3 h-3 bg-red-400 rounded-full" />
                <span className="w-3 h-3 bg-yellow-400 rounded-full" />
                <span className="w-3 h-3 bg-green-400 rounded-full" />
                <span className="ml-auto text-[11px] text-stone-500 tracking-widest">{t("terminalLabel")}</span>
              </div>
              <div className="space-y-2 text-stone-300">
                {lines.map((line, i) => (
                  <div key={i} className={line.startsWith("#") ? "text-stone-500" : undefined}>
                    {line}
                  </div>
                ))}
                <div className="pt-2 text-stone-400">{t("terminalResult")}</div>
                <div className="pt-4 border-t border-stone-800 text-[11.5px] text-stone-500">
                  {oks.map((ok, i) => (
                    <div key={i}>
                      <span className="text-green-400">✓</span> {ok}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 text-[11.5px] text-stone-500 tracking-wider">
              {t("terminalTail")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
