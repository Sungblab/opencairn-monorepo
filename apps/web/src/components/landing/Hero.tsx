import type { CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { HeroActivityCard, type ActivityItem } from "./HeroActivityCard";
import { HeroLivePanel, type HeroLivePanelCopy } from "./HeroLivePanel";
import { HeroTypewriterText } from "./HeroTypewriterText";

// 80ms initial pause + 110ms stagger = 의도적 호흡감.
// 모든 reveal-intro 요소의 delay를 한 곳에서 관리해 JSX와 디자인 의도를 일치시킴.
const HERO_INTRO_DELAYS = {
  title: 80,
  sub: 190,
  ctas: 300,
  noCard: 410,
  aside: 520,
  livePanel: 630,
} as const;

// CSS custom property는 React의 CSSProperties에 명시되지 않으므로 cast 필요.
const introStyle = (delayMs: number): CSSProperties =>
  ({ "--reveal-delay": `${delayMs}ms` }) as CSSProperties;

export function Hero() {
  const t = useTranslations("landing.hero");
  const locale = useLocale();

  const activityItems = t.raw("activity.items") as ActivityItem[];
  const timeLabels = t.raw("activity.timeLabels") as string[];
  const inputItems = t.raw("livePanel.inputItems") as string[];
  const rotating = t.raw("livePanel.rotating") as string[];
  const livePanelCopy: HeroLivePanelCopy = {
    title: t("livePanel.title"),
    compiling: t("livePanel.compiling"),
    input: t("livePanel.input"),
    agentsHeader: t("livePanel.agentsHeader"),
    orchestration: t("livePanel.orchestration"),
    status: t("livePanel.status"),
    output: t("livePanel.output"),
    outWikiTitle: t("livePanel.outWikiTitle"),
    outWikiDesc: t("livePanel.outWikiDesc"),
    outWikiMeta: t("livePanel.outWikiMeta"),
    outWikiLinksMeta: t("livePanel.outWikiLinksMeta"),
    outLearnTitle: t("livePanel.outLearnTitle"),
    outLearnDesc: t("livePanel.outLearnDesc"),
    outLearnMeta: t("livePanel.outLearnMeta"),
    outGenTitle: t("livePanel.outGenTitle"),
    outGenDesc: t("livePanel.outGenDesc"),
    outGenMeta: t("livePanel.outGenMeta"),
  };

  return (
    <section className="relative overflow-hidden">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-10 pb-20 md:pt-6 md:pb-28 lg:pt-8 xl:pt-10 2xl:pb-36 relative">
        <div className="grid md:grid-cols-12 gap-12 2xl:gap-16 items-center">
          <div className="min-w-0 md:col-span-7">
            <h1
              className="kr font-sans text-4xl sm:text-5xl md:text-5xl lg:text-6xl leading-[1.05] text-stone-900 mb-4 lg:mb-6 2xl:mb-8 reveal-intro"
              style={introStyle(HERO_INTRO_DELAYS.title)}
            >
              {t("titleLine1")}{" "}
              <br />
              {t("titleLine2")}{" "}
              <br />
              <em className="font-extrabold tracking-tight not-italic">{t("titleBrand")}</em>{" "}
              <br />
              <HeroTypewriterText text={t("titleLine3")} />
              <span className="caret" aria-hidden />
            </h1>
            <p
              className="kr text-lg text-stone-600 leading-relaxed mb-5 lg:mb-8 2xl:mb-10 reveal-intro"
              style={introStyle(HERO_INTRO_DELAYS.sub)}
              dangerouslySetInnerHTML={{ __html: t.raw("sub") as string }}
            />
            <div
              className="flex flex-wrap items-center gap-4 reveal-intro"
              style={introStyle(HERO_INTRO_DELAYS.ctas)}
            >
              <a
                href={`/${locale}/auth/login`}
                className="bg-stone-900 hover:bg-stone-50 hover:text-stone-900 text-stone-50 border border-stone-900 font-medium px-6 py-3 rounded-md transition-colors kr inline-flex items-center gap-2"
              >
                {t("ctaPrimary")}
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </a>
              <a
                href="#pricing"
                className="bg-stone-50 border border-stone-300 text-stone-800 hover:bg-stone-900 hover:text-stone-50 hover:border-stone-900 font-medium px-6 py-3 rounded-md transition-colors kr"
              >
                {t("ctaSecondary")}
              </a>
            </div>
            <p
              className="kr text-sm text-stone-500 mt-3 lg:mt-5 2xl:mt-8 reveal-intro"
              style={introStyle(HERO_INTRO_DELAYS.noCard)}
            >
              {t("noCard")}
              <span className="mx-2 text-stone-300">·</span>
              <a href="#docs" className="text-stone-600 hover:text-stone-900 underline decoration-dotted underline-offset-2">
                {t("selfhostLink")}
              </a>
            </p>
          </div>

          <HeroActivityCard
            title={t("activity.title")}
            meta={t("activity.meta")}
            footer={t("activity.footer")}
            items={activityItems}
            timeLabels={timeLabels}
            introDelayMs={HERO_INTRO_DELAYS.aside}
          />
        </div>

        <HeroLivePanel
          copy={livePanelCopy}
          inputItems={inputItems}
          rotating={rotating}
          introDelayMs={HERO_INTRO_DELAYS.livePanel}
        />
      </div>
    </section>
  );
}
