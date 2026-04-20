"use client";
import { useTranslations, useLocale } from "next-intl";

type Link = { label: string; href: string };

export function LandingFooter() {
  const t = useTranslations("landing.footer");
  const locale = useLocale();
  const productLinks = t.raw("productLinks") as Link[];
  const devLinks = t.raw("devLinks") as Link[];
  const communityLinks = t.raw("communityLinks") as Link[];
  const legalLinks = t.raw("legalLinks") as Link[];
  const badges = t.raw("badges") as string[];

  return (
    <footer className="py-16" style={{ backgroundColor: "#1C1917", color: "#D6D3D1" }}>
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-6 mb-12">
          <div className="col-span-12 md:col-span-4">
            <div className="flex items-baseline gap-3 mb-4">
              <svg className="w-7 h-7 self-center" viewBox="0 0 32 32" fill="none">
                <path d="M8 24 L16 8 L24 24 Z" stroke="#D3CCBE" strokeWidth={1.5} fill="none" />
                <path d="M10 20 L16 12 L22 20 Z" stroke="#F5F3EE" strokeWidth={1.5} fill="#2A2823" />
                <circle cx={16} cy={20} r={1.5} fill="#D3CCBE" />
              </svg>
              <span className="font-serif text-2xl" style={{ color: "#F5F3EE" }}>
                OpenCairn
              </span>
              <span className="font-mono text-[11px] tracking-widest" style={{ color: "#A8A29E" }}>
                .v0.1
              </span>
            </div>
            <p className="kr text-[13px] leading-relaxed max-w-[340px]" style={{ color: "#D6D3D1" }}>
              {t("tagline")}
              <br />
              <span className="font-mono text-[11px] tracking-wider" style={{ color: "#A8A29E" }}>
                {t("taglineMono")}
              </span>
            </p>
          </div>
          {[
            { h: t("colProduct"), links: productLinks },
            { h: t("colDev"), links: devLinks },
            { h: t("colCommunity"), links: communityLinks },
            { h: t("colLegal"), links: legalLinks },
          ].map((col, i) => (
            <div key={i} className="col-span-6 md:col-span-2">
              <h4 className="font-mono text-[11px] tracking-widest uppercase mb-4" style={{ color: "#F5F3EE" }}>
                {col.h}
              </h4>
              <ul className="space-y-2 font-mono text-[11.5px] tracking-wider">
                {col.links.map((l, j) => (
                  <li key={j}>
                    <a href={l.href} className="hover:text-stone-50 transition-colors">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div
          className="pt-8 flex flex-wrap items-center justify-between gap-4 font-mono text-[10.5px] tracking-widest uppercase"
          style={{ borderTop: "1px solid #57534E", color: "#A8A29E" }}
        >
          <div>{t("copyright")}</div>
          <div className="flex items-center gap-5 flex-wrap">
            <span aria-label={t("langLabel")} className="flex items-center gap-2">
              <span style={{ color: "#78716C" }}>{t("langLabel")}</span>
              <a
                href="/ko"
                className={`transition-colors ${locale === "ko" ? "" : "hover:text-stone-50"}`}
                style={{ color: locale === "ko" ? "#F5F3EE" : "#A8A29E" }}
              >
                {t("langKo")}
              </a>
              <span style={{ color: "#57534E" }}>·</span>
              <a
                href="/en"
                className={`transition-colors ${locale === "en" ? "" : "hover:text-stone-50"}`}
                style={{ color: locale === "en" ? "#F5F3EE" : "#A8A29E" }}
              >
                {t("langEn")}
              </a>
            </span>
            <span style={{ color: "#57534E" }}>·</span>
            {badges.map((b, i) => (
              <span key={i}>
                {i > 0 && <span className="mr-5">·</span>}
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div
        className="pt-6 mt-6 text-center font-mono text-[10px] tracking-widest uppercase"
        style={{ color: "#78716C" }}
      >
        {t("endline")}
      </div>
    </footer>
  );
}
