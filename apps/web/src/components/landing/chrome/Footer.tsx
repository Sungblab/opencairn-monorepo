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

  return (
    <footer className="py-16" style={{ backgroundColor: "#1C1917", color: "#FFFFFF" }}>
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-6 mb-12">
          <div className="col-span-12 md:col-span-4">
            <div className="mb-4">
              <span className="font-serif text-2xl" style={{ color: "#FFFFFF" }}>
                OpenCairn
              </span>
            </div>
            <p className="kr text-[13px] leading-relaxed max-w-[340px]" style={{ color: "#FFFFFF" }}>
              {t("tagline")}
              <br />
              <span className="font-mono text-[11px] tracking-wider" style={{ color: "#FFFFFF" }}>
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
              <h4 className="font-mono text-[11px] tracking-widest uppercase mb-4" style={{ color: "#FFFFFF" }}>
                {col.h}
              </h4>
              <ul className="space-y-2 font-mono text-[12.5px] tracking-wider" style={{ color: "#FFFFFF" }}>
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
          className="pt-8 flex flex-wrap items-center justify-between gap-6"
          style={{ borderTop: "1px solid #57534E" }}
        >
          <div className="font-mono text-[10.5px] tracking-widest uppercase" style={{ color: "#FFFFFF" }}>
            {t("copyright")}
          </div>
          <div
            className="inline-flex items-center rounded-md overflow-hidden font-mono text-[11px] tracking-widest uppercase"
            style={{ border: "1px solid #57534E" }}
            role="group"
            aria-label={t("langLabel")}
          >
            <a
              href="/ko"
              aria-current={locale === "ko" ? "page" : undefined}
              className="px-3.5 py-1.5 transition-colors"
              style={
                locale === "ko"
                  ? { backgroundColor: "#F5F3EE", color: "#1C1917" }
                  : { color: "#D3CCBE" }
              }
            >
              {t("langKo")}
            </a>
            <a
              href="/en"
              aria-current={locale === "en" ? "page" : undefined}
              className="px-3.5 py-1.5 transition-colors"
              style={
                locale === "en"
                  ? { backgroundColor: "#F5F3EE", color: "#1C1917" }
                  : { color: "#D3CCBE" }
              }
            >
              {t("langEn")}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
