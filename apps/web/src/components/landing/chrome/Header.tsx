"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { AuthModal } from "@/components/auth/AuthModal";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { cn } from "@/lib/utils";

export function LandingHeader() {
  const t = useTranslations("landing.nav");
  const locale = useLocale();
  const nameRef = useRef<HTMLSpanElement>(null);
  const [clicks, setClicks] = useState(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const onLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const next = clicks + 1;
    setClicks(next);
    if (next === 3) {
      const span = nameRef.current;
      if (span) {
        const prev = span.textContent ?? "";
        span.textContent = t("easter");
        setTimeout(() => {
          span.textContent = prev;
        }, 1600);
      }
    }
  };

  const navItems = [
    { href: "#how", k: "pipeline" },
    { href: "#agents", k: "agents" },
    { href: "#workspace", k: "workspace" },
    { href: "#vs", k: "why" },
    { href: "#pricing", k: "pricing" },
    { href: "#docs", k: "docs" },
  ] as const;

  return (
    <>
      <nav
        className={cn(
          "sticky top-0 z-40 bg-stone-50/90 backdrop-blur-md border-b-2 border-stone-900 transition-shadow duration-200",
          scrolled && "shadow-[0_2px_0_0_#171717]",
        )}
      >
        <div className="relative max-w-[1280px] mx-auto px-6 lg:px-10 py-4">
          <div className="flex items-center">
            {/* LOGO — left */}
            <a
              href="#"
              onClick={onLogoClick}
              className="inline-flex items-baseline text-stone-900 hover:bg-stone-900 hover:text-stone-50 px-2 py-1 rounded-md transition-colors"
              title={t("logoTitle")}
            >
              <span ref={nameRef} className="font-serif text-2xl">
                OpenCairn
              </span>
            </a>

            {/* CENTER NAV — absolute-centered relative to the nav container
             * so it's the true viewport center, unaffected by logo/actions width. */}
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

            {/* RIGHT ACTIONS */}
            <div className="ml-auto flex items-center gap-2">
              <LanguageSwitcher />
              <button
                onClick={() => setAuthOpen(true)}
                className="hidden sm:inline-flex items-center text-sm text-stone-900 hover:bg-stone-900 hover:text-stone-50 font-semibold kr px-3 py-1.5 rounded-md border-2 border-transparent hover:border-stone-900 transition-colors"
              >
                {t("signIn")}
              </button>
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
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}
