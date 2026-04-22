"use client";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

type Link = { label: string; href: string };

export function LandingFooter() {
  const t = useTranslations("landing.footer");
  const productLinks = t.raw("productLinks") as Link[];
  const devLinks = t.raw("devLinks") as Link[];
  const communityLinks = t.raw("communityLinks") as Link[];
  const legalLinks = t.raw("legalLinks") as Link[];

  return (
    <footer className="py-16" style={{ backgroundColor: "#171717", color: "#FFFFFF" }}>
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
              <span className="font-sans text-[11px] tracking-wider" style={{ color: "#FFFFFF" }}>
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
              <h4 className="font-sans text-[11px] tracking-widest uppercase mb-4" style={{ color: "#FFFFFF" }}>
                {col.h}
              </h4>
              <ul className="space-y-2 font-sans text-[12.5px] tracking-wider" style={{ color: "#FFFFFF" }}>
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
          style={{ borderTop: "1px solid #525252" }}
        >
          <div className="font-sans text-[10.5px] tracking-widest uppercase" style={{ color: "#FFFFFF" }}>
            {t.rich("copyright", {
              author: (chunks) => (
                <a
                  href="https://sungblab.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-stone-500 underline-offset-2 hover:decoration-stone-50 transition-colors"
                >
                  {chunks}
                </a>
              ),
            })}
          </div>
          <LanguageSwitcher tone="dark" />
        </div>
      </div>
    </footer>
  );
}
