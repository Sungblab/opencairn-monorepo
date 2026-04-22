"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

export function Cta() {
  const t = useTranslations("landing.cta");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  return (
    <section ref={ref} id="cta" className="bg-stone-50 py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-3">
            <span className="sec-label">{t("label")}</span>
          </div>
          <div className="col-span-12 md:col-span-9">
            <h2 className="kr font-sans text-4xl md:text-6xl text-stone-900 leading-[1.02] mb-6">
              {t("titleA")}
              <br />
              <span className="font-extrabold tracking-tight">{t("titleB")}</span>
            </h2>
            <p className="kr text-[15px] text-stone-600 leading-relaxed mb-10 max-w-[560px]">{t("sub")}</p>
            <div className="flex flex-wrap items-center gap-4 mb-6">
              <a
                href="#login"
                className="bg-stone-900 hover:bg-stone-50 hover:text-stone-900 text-stone-50 border border-stone-900 font-sans text-[13px] tracking-widest px-8 py-4 rounded-md transition-colors kr inline-flex items-center gap-2.5"
              >
                {t("primary")}
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </a>
              <a
                href="#pricing"
                className="border border-stone-900 text-stone-900 hover:bg-stone-900 hover:text-stone-50 font-sans text-[13px] tracking-widest px-8 py-4 rounded-md transition-colors kr"
              >
                {t("secondary")}
              </a>
            </div>
            <p className="font-sans text-[13px] text-stone-600 tracking-wider">
              <a
                href="https://github.com/Sungblab/opencairn-monorepo"
                className="hover:text-stone-900 underline underline-offset-2 decoration-stone-400"
              >
                {t("bottomGithub")}
              </a>
              <span className="mx-3 text-stone-400">·</span>
              <a href="#docs" className="hover:text-stone-900 underline underline-offset-2 decoration-stone-400">
                {t("bottomSelfhost")}
              </a>
              <span className="mx-3 text-stone-400">·</span>
              <span>{t("bottomTonight")}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
