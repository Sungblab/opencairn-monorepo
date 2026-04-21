"use client";
import { useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";

export function LandingHeader() {
  const t = useTranslations("landing.nav");
  const locale = useLocale();
  const otherLocale = locale === "ko" ? "en" : "ko";
  const nameRef = useRef<HTMLSpanElement>(null);
  const [clicks, setClicks] = useState(0);

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

  return (
    <nav className="sticky top-0 z-40 bg-stone-50/85 backdrop-blur-md border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-4 flex items-center justify-between">
        <a
          href="#"
          onClick={onLogoClick}
          className="flex items-baseline"
          title={t("logoTitle")}
        >
          <span ref={nameRef} className="font-serif text-2xl text-stone-900">
            OpenCairn
          </span>
        </a>
        <div className="hidden md:flex items-center gap-7 font-mono text-[12px] tracking-wider text-stone-600">
          <a href="#how" className="hover:text-stone-900 transition-colors">{t("pipeline")}</a>
          <a href="#agents" className="hover:text-stone-900 transition-colors">{t("agents")}</a>
          <a href="#workspace" className="hover:text-stone-900 transition-colors">{t("workspace")}</a>
          <a href="#vs" className="hover:text-stone-900 transition-colors">{t("why")}</a>
          <a href="#pricing" className="hover:text-stone-900 transition-colors">{t("pricing")}</a>
          <a href="#docs" className="hover:text-stone-900 transition-colors">{t("docs")}</a>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={`/${otherLocale}`}
            aria-label={t("switchToLabel")}
            className="font-mono text-[11px] tracking-widest text-stone-500 hover:text-stone-900 transition-colors"
          >
            {t("switchTo")}
          </a>
          <a href="#login" className="hidden sm:inline-block text-sm text-stone-700 hover:text-stone-900 font-medium kr">
            {t("signIn")}
          </a>
          <a
            href="#pricing"
            className="bg-stone-900 hover:bg-stone-800 text-stone-50 text-sm font-medium px-4 py-2 rounded-md transition-colors kr"
          >
            {t("signUp")}
          </a>
        </div>
      </div>
    </nav>
  );
}
