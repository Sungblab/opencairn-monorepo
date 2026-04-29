"use client";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { externalSiteUrls } from "@/lib/site-config";

type Link = { label: string; href: string };

function resolveExternalHref(href: string): string {
  switch (href) {
    case "/privacy":
      return externalSiteUrls.privacy;
    case "/terms":
      return externalSiteUrls.terms;
    case "/refund":
      return externalSiteUrls.refund;
    case "/blog":
      return externalSiteUrls.blog;
    default:
      return href;
  }
}

export function LandingFooter() {
  const t = useTranslations("landing.footer");
  const productLinks = t.raw("productLinks") as Link[];
  const devLinks = t.raw("devLinks") as Link[];
  const communityLinks = t.raw("communityLinks") as Link[];
  const legalLinks = t.raw("legalLinks") as Link[];
  const badges = t.raw("badges") as string[];

  return (
    <footer className="bg-stone-900 text-stone-50 py-16 lg:py-20">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        {/* ─── TOP ─── brand + link columns */}
        <div className="grid grid-cols-12 gap-8 lg:gap-6 mb-14">
          <div className="col-span-12 md:col-span-4">
            <div className="mb-5">
              <span className="font-serif text-3xl tracking-tight text-stone-50">
                OpenCairn
              </span>
            </div>
            <p className="kr text-[14px] leading-relaxed text-stone-300 max-w-[340px]">
              {t("tagline")}
            </p>
            <p className="mt-3 font-mono text-[11px] tracking-wider text-stone-500 max-w-[340px]">
              {t("taglineMono")}
            </p>

            {/* stack badges */}
            <div className="mt-6 flex flex-wrap gap-2">
              {badges.map((b) => (
                <span
                  key={b}
                  className="font-sans text-[10px] tracking-[0.16em] uppercase text-stone-200 border border-stone-700 rounded-full px-2.5 py-1"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>

          {[
            { h: t("colProduct"), links: productLinks },
            { h: t("colDev"), links: devLinks },
            { h: t("colCommunity"), links: communityLinks },
            { h: t("colLegal"), links: legalLinks },
          ].map((col, i) => (
            <div key={i} className="col-span-6 md:col-span-2">
              <h4 className="font-sans text-[11px] font-semibold tracking-[0.18em] uppercase text-stone-400 mb-5">
                {col.h}
              </h4>
              <ul className="space-y-2.5 font-sans text-[13px]">
                {col.links.map((l, j) => (
                  <li key={j}>
                    <a
                      href={resolveExternalHref(l.href)}
                      className="inline-flex items-center text-stone-200 hover:bg-stone-50 hover:text-stone-900 px-2 py-1 -mx-2 rounded-md transition-colors"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* ─── DIVIDER ─── */}
        <div className="h-px bg-gradient-to-r from-transparent via-stone-700 to-transparent" />

        {/* ─── BOTTOM ─── copyright + language */}
        <div className="pt-8 flex flex-wrap items-center justify-between gap-6">
          <div className="font-sans text-[11px] tracking-[0.16em] uppercase text-stone-400">
            {t.rich("copyright", {
              author: (chunks) => (
                <a
                  href="https://sungblab.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-100 underline decoration-stone-600 underline-offset-2 hover:bg-stone-50 hover:text-stone-900 hover:no-underline px-1.5 py-0.5 rounded-md transition-colors"
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
