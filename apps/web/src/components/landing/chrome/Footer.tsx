"use client";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { externalSiteUrls, publicLinks, siteConfig } from "@/lib/site-config";

type Link = { label: string; href: string };

function resolveExternalHref(href: string): string | undefined {
  switch (href) {
    case "/privacy":
    case "privacy":
      return externalSiteUrls.privacy;
    case "/terms":
    case "terms":
      return externalSiteUrls.terms;
    case "/blog":
    case "blog":
      return externalSiteUrls.blog;
    case "repo":
      return publicLinks.repository;
    case "license":
      return publicLinks.license;
    case "contactEmail":
      return publicLinks.contactEmail;
    default:
      return href;
  }
}

export function LandingFooter() {
  const t = useTranslations("landing.footer");
  const links = t.raw("links") as Link[];

  return (
    <footer className="bg-stone-900 text-stone-50 py-12 lg:py-14">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-[520px]">
            <div className="font-serif text-[30px] leading-none tracking-tight text-stone-50">
              OpenCairn
            </div>
            <p className="kr mt-5 text-[15px] leading-relaxed text-stone-300">
              {t("tagline")}
            </p>
          </div>

          <nav
            aria-label={t("navLabel")}
            className="flex max-w-[620px] flex-wrap gap-x-5 gap-y-3 pt-1 font-sans text-[14px] leading-none text-stone-200 lg:justify-end"
          >
            {links.map((l) => {
              const href = resolveExternalHref(l.href);
              if (!href || href === "#") return null;
              return (
                <a
                  key={`${l.href}-${l.label}`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md py-1.5 text-stone-200 underline-offset-4 transition-colors hover:text-white hover:underline"
                >
                  {l.label}
                </a>
              );
            })}
          </nav>
        </div>

        <div className="mt-10 h-px bg-stone-800" />

        <div className="pt-6 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="max-w-full font-sans text-[12px] leading-relaxed text-stone-400">
            {t.rich("copyright", {
              author: (chunks) => (
                publicLinks.author ? (
                  <a
                    href={publicLinks.author}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-stone-200 underline decoration-stone-600 underline-offset-4 transition-colors hover:text-white"
                  >
                    {chunks}
                  </a>
                ) : (
                  <span>{chunks}</span>
                )
              ),
              authorName: siteConfig.authorName,
            })}
          </div>
          <LanguageSwitcher
            tone="dark"
            className="w-full justify-center sm:w-auto"
            contentClassName="!w-[min(16rem,calc(100vw-2rem))] sm:!w-56"
          />
        </div>
      </div>
    </footer>
  );
}
