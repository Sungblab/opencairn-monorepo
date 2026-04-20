"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

export function LandingHeader() {
  const t = useTranslations("landing.nav");
  const logoRef = useRef<HTMLAnchorElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const extraRef = useRef<SVGEllipseElement>(null);
  const [clicks, setClicks] = useState(0);

  const onLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const next = clicks + 1;
    setClicks(next);
    if (next === 1) {
      extraRef.current?.classList.add("shown");
    }
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
          ref={logoRef}
          onClick={onLogoClick}
          className="flex items-baseline gap-2.5 cairn-stacker"
          title={t("logoTitle")}
        >
          <svg className="w-7 h-7 self-center" viewBox="0 0 32 32" fill="none">
            <path d="M8 24 L16 8 L24 24 Z" stroke="#403C32" strokeWidth={1.5} fill="none" />
            <path d="M10 20 L16 12 L22 20 Z" stroke="#1C1917" strokeWidth={1.5} fill="#EDEAE2" />
            <circle cx={16} cy={20} r={1.5} fill="#403C32" />
            <ellipse ref={extraRef} className="cairn-extra" cx={16} cy={6.5} rx={3} ry={1.6} fill="#1C1917" opacity={0} />
          </svg>
          <span ref={nameRef} className="font-serif text-2xl text-stone-900">
            OpenCairn
          </span>
          <span className="font-mono text-[11px] tracking-widest text-stone-500">.v0.1</span>
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
            href="https://github.com/Sungblab/opencairn-monorepo"
            className="hidden lg:inline-block font-mono text-[11px] tracking-widest text-stone-600 hover:text-stone-900"
          >
            {t("github")}
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
