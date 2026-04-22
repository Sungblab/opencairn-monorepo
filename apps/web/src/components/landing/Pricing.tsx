"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

function Html({ html, className }: { html: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Pricing() {
  const t = useTranslations("landing.pricing");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  const freeBullets = t.raw("free.bullets") as string[];
  const freeBulletsMuted = t.raw("free.bulletsMuted") as string[];
  const proBullets = t.raw("pro.bullets") as string[];
  const byokBullets = t.raw("byok.bullets") as string[];
  const byokMuted = t.raw("byok.bulletsMuted") as string[];

  return (
    <section
      ref={ref}
      id="pricing"
      className="bg-stone-900 text-stone-50 py-24 md:py-32"
      style={{ backgroundColor: "#171717" }}
    >
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-6 mb-16 reveal">
          <div className="col-span-12 md:col-span-3">
            <span className="sec-label" style={{ color: "#737373" }}>
              <span className="n" style={{ color: "#FAFAFA" }}>
                {t("label")}
              </span>
            </span>
          </div>
          <div className="col-span-12 md:col-span-9">
            <h2 className="kr text-3xl md:text-5xl leading-[1.05] tracking-tight font-semibold mb-5">
              {t("title1")}
              <br />
              {t("title2")}
            </h2>
            <p className="kr text-[15px] text-stone-400 leading-relaxed max-w-[560px]">{t("sub")}</p>
          </div>
        </div>

        <div className="grid grid-cols-12 border border-stone-700 rounded-2xl overflow-hidden reveal-stagger">
          {/* Free */}
          <div
            className="col-span-12 md:col-span-4 p-8 flex flex-col"
            style={{ borderRight: "1px solid #2A2823", borderBottom: "1px solid #2A2823" }}
          >
            <div className="flex items-baseline justify-between mb-5">
              <span className="font-sans text-[11px] tracking-widest text-stone-300 uppercase">{t("free.name")}</span>
              <span className="font-sans text-[10px] tracking-widest text-stone-500 uppercase">{t("free.cat")}</span>
            </div>
            <div className="font-sans text-5xl mb-2 text-stone-50">{t("free.price")}</div>
            <p className="font-sans text-[11px] tracking-wider text-stone-500 mb-6 uppercase">{t("free.tagline")}</p>
            <ul className="text-[13px] text-stone-300 space-y-2.5 mb-8 flex-1 kr">
              {freeBullets.map((b, i) => (
                <li key={i}>· {b}</li>
              ))}
              {freeBulletsMuted.map((b, i) => (
                <li key={`m-${i}`} className="text-stone-500">
                  · {b}
                </li>
              ))}
            </ul>
            <a
              href="#login"
              className="block text-center border border-stone-50 text-stone-50 hover:bg-stone-50 hover:text-stone-900 font-sans text-[12px] tracking-widest px-6 py-3 rounded-md transition-colors"
            >
              {t("free.cta")}
            </a>
          </div>

          {/* Pro (featured) */}
          <div
            className="col-span-12 md:col-span-4 p-8 flex flex-col relative"
            style={{
              background: "#FAFAFA",
              color: "#171717",
              borderRight: "1px solid #2A2823",
              borderBottom: "1px solid #2A2823",
            }}
          >
            <div className="absolute -top-px left-0 right-0 h-[3px]" style={{ background: "#171717" }} />
            <div className="flex items-baseline justify-between mb-5">
              <span className="font-sans text-[11px] tracking-widest uppercase" style={{ color: "#171717" }}>
                {t("pro.name")}
              </span>
              <span className="font-sans text-[10px] tracking-widest uppercase" style={{ color: "#525252" }}>
                {t("pro.cat")}
              </span>
            </div>
            <div className="font-sans text-5xl mb-1" style={{ color: "#171717" }}>
              {t("pro.price")}
              <span className="text-lg" style={{ color: "#525252" }}>
                {" "}
                {t("pro.unit")}
              </span>
            </div>
            <p className="font-sans text-[11px] tracking-wider uppercase mb-5" style={{ color: "#525252" }}>
              {t("pro.tagline")}
            </p>

            <div
              className="mb-6 px-4 py-3 font-sans text-[11.5px] leading-relaxed"
              style={{ background: "#E5E5E5", borderLeft: "2px solid #171717", color: "#171717" }}
            >
              <b className="tracking-widest uppercase text-[10px]" style={{ color: "#525252" }}>
                {t("pro.payg.label")}
              </b>
              <br />
              <span style={{ color: "#262626" }}>
                <Html html={t.raw("pro.payg.line1") as string} />
                <br />
                <Html
                  html={(t.raw("pro.payg.line2") as string)
                    .replace(/<m>/g, '<span style="color:#525252">')
                    .replace(/<\/m>/g, "</span>")}
                />
              </span>
            </div>

            <ul className="text-[13px] space-y-2.5 mb-8 flex-1 kr" style={{ color: "#262626" }}>
              {proBullets.map((b, i) => (
                <li key={i}>
                  · <Html html={b} />
                </li>
              ))}
            </ul>
            <a
              href="#login"
              className="block text-center font-sans text-[12px] tracking-widest px-6 py-3 rounded-md transition-colors border border-stone-900 hover:bg-stone-50 hover:text-stone-900"
              style={{ background: "#171717", color: "#FAFAFA" }}
            >
              {t("pro.cta")}
            </a>
            <p className="font-sans text-[10px] tracking-widest text-center mt-3 uppercase" style={{ color: "#525252" }}>
              {t("pro.guarantee")}
            </p>
          </div>

          {/* BYOK */}
          <div className="col-span-12 md:col-span-4 p-8 flex flex-col" style={{ borderBottom: "1px solid #2A2823" }}>
            <div className="flex items-baseline justify-between mb-5">
              <span className="font-sans text-[11px] tracking-widest text-stone-300 uppercase">{t("byok.name")}</span>
              <span className="font-sans text-[10px] tracking-widest text-stone-500 uppercase">{t("byok.cat")}</span>
            </div>
            <div className="font-sans text-5xl mb-1 text-stone-50">
              {t("byok.price")}
              <span className="text-lg text-stone-500"> {t("byok.unit")}</span>
            </div>
            <p className="font-sans text-[11px] tracking-wider text-stone-500 mb-6 uppercase">{t("byok.tagline")}</p>
            <ul className="text-[13px] text-stone-300 space-y-2.5 mb-8 flex-1 kr">
              {byokBullets.map((b, i) => (
                <li key={i}>
                  · <Html html={b} />
                </li>
              ))}
              {byokMuted.map((b, i) => (
                <li key={`m-${i}`} className="text-stone-500">
                  · {b}
                </li>
              ))}
            </ul>
            <a
              href="#login"
              className="block text-center border border-stone-50 text-stone-50 hover:bg-stone-50 hover:text-stone-900 font-sans text-[12px] tracking-widest px-6 py-3 rounded-md transition-colors"
            >
              {t("byok.cta")}
            </a>
          </div>
        </div>

        <p className="text-left md:pl-[25%] text-[11px] text-stone-500 mt-8 font-sans tracking-widest uppercase">
          {t("footnote")}
        </p>

        {/* Secondary row */}
        <div className="mt-20 pt-12 reveal" style={{ borderTop: "1px solid #262626" }}>
          <div className="grid grid-cols-12 gap-6 mb-8">
            <div className="col-span-12 md:col-span-3">
              <span className="sec-label" style={{ color: "#525252" }}>
                {t("secondary.label")}
              </span>
            </div>
            <div className="col-span-12 md:col-span-9">
              <h3 className="kr font-sans text-2xl md:text-3xl leading-[1.15] mb-2">{t("secondary.title")}</h3>
              <p className="kr text-[13px] text-stone-400 leading-relaxed max-w-[520px]">{t("secondary.sub")}</p>
            </div>
          </div>
          <div className="grid grid-cols-12 gap-0 rounded-xl overflow-hidden" style={{ border: "1px solid #262626" }}>
            <a
              href="#docs"
              className="group col-span-12 md:col-span-6 p-6 transition-colors hover:bg-stone-800"
              style={{ borderRight: "1px solid #262626", borderBottom: "1px solid #262626" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-sans text-[10.5px] tracking-widest text-stone-500 uppercase mb-2">
                    {t("secondary.selfHost.cat")}
                  </div>
                  <h4 className="font-sans text-xl text-stone-100 mb-2 kr">{t("secondary.selfHost.title")}</h4>
                  <p className="kr text-[13px] text-stone-400 leading-relaxed">{t("secondary.selfHost.body")}</p>
                </div>
                <svg
                  className="w-4 h-4 text-stone-500 group-hover:text-stone-50 mt-1 flex-shrink-0 transition-colors"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                >
                  <path d="M7 17L17 7M7 7h10v10" />
                </svg>
              </div>
              <div className="mt-4 font-mono text-[11px] tracking-wider text-stone-500">{t("secondary.selfHost.cmd")}</div>
            </a>
            <a
              href="#enterprise"
              className="group col-span-12 md:col-span-6 p-6 transition-colors hover:bg-stone-800"
              style={{ borderBottom: "1px solid #262626" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-sans text-[10.5px] tracking-widest text-stone-500 uppercase mb-2">
                    {t("secondary.enterprise.cat")}
                  </div>
                  <h4 className="font-sans text-xl text-stone-100 mb-2 kr">{t("secondary.enterprise.title")}</h4>
                  <p className="kr text-[13px] text-stone-400 leading-relaxed">{t("secondary.enterprise.body")}</p>
                </div>
                <svg
                  className="w-4 h-4 text-stone-500 group-hover:text-stone-50 mt-1 flex-shrink-0 transition-colors"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                >
                  <path d="M7 17L17 7M7 7h10v10" />
                </svg>
              </div>
              <div className="mt-4 font-sans text-[11px] tracking-wider text-stone-500 kr">
                {t("secondary.enterprise.cmd")}
              </div>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
