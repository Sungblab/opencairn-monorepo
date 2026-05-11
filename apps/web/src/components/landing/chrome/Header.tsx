import { useTranslations, useLocale } from "next-intl";
import { LandingLocaleLink } from "./LandingLocaleLink";

export function LandingHeader() {
  const t = useTranslations("landing.nav");
  const locale = useLocale();
  const nextLocale = locale === "ko" ? "en" : "ko";

  const navItems = [
    { href: "#how", k: "pipeline" },
    { href: "#agents", k: "agents" },
    { href: "#workspace", k: "workspace" },
    { href: "#vs", k: "why" },
    { href: "#pricing", k: "pricing" },
    { href: "#docs", k: "docs" },
  ] as const;

  return (
    <nav className="sticky top-0 z-40 bg-stone-50/90 backdrop-blur-md border-b-2 border-stone-900">
      <div className="relative max-w-[1280px] mx-auto px-6 lg:px-10 py-4">
        <div className="flex items-center">
          <a
            href="#"
            className="inline-flex items-baseline text-stone-900 hover:bg-stone-900 hover:text-stone-50 px-2 py-1 rounded-md transition-colors"
            title={t("logoTitle")}
          >
            <span className="font-serif text-2xl font-bold">OpenCairn</span>
          </a>

          <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center gap-1 font-sans text-[12px] tracking-wider text-stone-700">
            {navItems.map(({ href, k }) => (
              <a
                key={k}
                href={href}
                className="px-3 py-1.5 rounded-md font-medium hover:bg-stone-900 hover:text-stone-50 transition-colors"
              >
                {t(k)}
              </a>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <LandingLocaleLink
              locale={nextLocale}
              ariaLabel={t("languageSwitch")}
              className="inline-flex items-center rounded-full border-2 border-stone-400 bg-transparent px-3 py-1.5 font-sans text-[11px] font-semibold tracking-widest uppercase text-stone-800 transition-colors hover:border-stone-900 hover:bg-stone-900 hover:text-stone-50"
            >
              {nextLocale}
            </LandingLocaleLink>
            <a
              href={`/${locale}/auth/login`}
              className="hidden sm:inline-flex items-center text-sm text-stone-900 hover:bg-stone-900 hover:text-stone-50 font-semibold kr px-3 py-1.5 rounded-md border-2 border-transparent hover:border-stone-900 transition-colors"
            >
              {t("signIn")}
            </a>
            <a
              href={`/${locale}/auth/login`}
              className="bg-stone-900 hover:bg-stone-50 hover:text-stone-900 text-stone-50 text-sm font-semibold px-4 py-2 rounded-md border-2 border-stone-900 transition-colors kr"
            >
              {t("signUp")}
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
