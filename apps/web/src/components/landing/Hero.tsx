"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";

type ActivityItem = { agent: string; text: string };

const ACTIVE_ORDER = [0, 2, 1, 7, 3, 4, 5, 9, 10, 11, 6, 8];

// 펀치라인(line3)만 타이핑. SSR/no-JS는 풀텍스트가 보이고, 클라이언트는 마운트 직후
// 비워서 `.reveal` opacity 페이드 뒤에서 자연스럽게 시작됨. bfcache 복원 시는
// 즉시 풀텍스트로 점프해 재생을 막는다.
function TypewriterText({
  text,
  startDelay = 400,
  charDelay = 55,
}: {
  text: string;
  startDelay?: number;
  charDelay?: number;
}) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(text);
      return;
    }

    setShown("");
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      i += 1;
      setShown(text.slice(0, i));
      if (i < text.length) {
        timer = setTimeout(tick, charDelay);
      }
    };
    timer = setTimeout(tick, startDelay);

    const onPageshow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      cancelled = true;
      if (timer) clearTimeout(timer);
      setShown(text);
    };
    window.addEventListener("pageshow", onPageshow);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("pageshow", onPageshow);
    };
  }, [text, startDelay, charDelay]);

  return <>{shown}</>;
}

const AGENT_ROWS: Array<{ idx: number; x: number; y: number; text: number; fill: string; label: string }> = [
  { idx: 0, x: 20, y: 26, text: 30, fill: "#FAFAFA", label: "Compiler" },
  { idx: 1, x: 20, y: 48, text: 52, fill: "#FAFAFA", label: "Research" },
  { idx: 2, x: 20, y: 70, text: 74, fill: "#FAFAFA", label: "Librarian" },
  { idx: 3, x: 20, y: 92, text: 96, fill: "#FAFAFA", label: "Synthesis" },
  { idx: 4, x: 20, y: 114, text: 118, fill: "#FAFAFA", label: "Socratic" },
  { idx: 5, x: 20, y: 136, text: 140, fill: "#FAFAFA", label: "Narrator" },
  { idx: 6, x: 104, y: 26, text: 30, fill: "#A3A3A3", label: "Curator" },
  { idx: 7, x: 104, y: 48, text: 52, fill: "#A3A3A3", label: "Connector" },
  { idx: 8, x: 104, y: 70, text: 74, fill: "#A3A3A3", label: "Temporal" },
  { idx: 9, x: 104, y: 92, text: 96, fill: "#A3A3A3", label: "Deep R." },
  { idx: 10, x: 104, y: 114, text: 118, fill: "#A3A3A3", label: "Code" },
  { idx: 11, x: 104, y: 136, text: 140, fill: "#A3A3A3", label: "Visual." },
];

// 80ms initial pause + 110ms stagger = 의도적 호흡감.
// 모든 reveal-intro 요소의 delay를 한 곳에서 관리해 JSX와 디자인 의도를 일치시킴.
const HERO_INTRO_DELAYS = {
  badge: 80,
  title: 190,
  sub: 300,
  ctas: 410,
  noCard: 520,
  aside: 630,
  livePanel: 740,
} as const;

// CSS custom property는 React의 CSSProperties에 명시되지 않으므로 cast 필요.
const introStyle = (delayMs: number): CSSProperties =>
  ({ "--reveal-delay": `${delayMs}ms` }) as CSSProperties;

export function Hero() {
  const t = useTranslations("landing.hero");

  const activityItems = t.raw("activity.items") as ActivityItem[];
  const timeLabels = t.raw("activity.timeLabels") as string[];
  const inputItems = t.raw("livePanel.inputItems") as string[];
  const rotating = t.raw("livePanel.rotating") as string[];

  const SHOW = 4;
  const [head, setHead] = useState(0);
  const [acIn, setAcIn] = useState(true);
  const [activeAgent, setActiveAgent] = useState<number>(ACTIVE_ORDER[0]);
  const [liveMsg, setLiveMsg] = useState(rotating[0] ?? "");
  const [wikiN, setWikiN] = useState(17);
  const [linksN, setLinksN] = useState(42);
  const [cardsN, setCardsN] = useState(23);
  const livePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let tickI = 0;
    const id = setInterval(() => {
      setActiveAgent(ACTIVE_ORDER[tickI % ACTIVE_ORDER.length]);
      setLiveMsg(rotating[(tickI + 1) % rotating.length]);
      if (tickI % 2 === 0) {
        setWikiN((n) => n + (Math.random() < 0.5 ? 1 : 0));
        setLinksN((n) => n + 1 + Math.floor(Math.random() * 3));
        setCardsN((n) => n + (Math.random() < 0.5 ? 1 : 0));
      }
      tickI++;
    }, 2200);
    return () => clearInterval(id);
  }, [rotating]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => {
      setAcIn(false);
      setTimeout(() => {
        setHead((h) => (h + 1) % activityItems.length);
        setAcIn(true);
      }, 380);
    }, 4200);
    return () => clearInterval(id);
  }, [activityItems.length]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = livePanelRef.current;
    if (reduce || !el) return;
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight || r.bottom < 0) return;
      const progress = 1 - r.top / window.innerHeight;
      el.style.transform = `translateY(${Math.min(0, (1 - progress) * 12)}px)`;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const shown: ActivityItem[] = [];
  for (let i = 0; i < SHOW; i++) shown.push(activityItems[(head + i) % activityItems.length]);

  return (
    <section className="relative overflow-hidden">
      <div className="max-w-[1280px] 2xl:max-w-[1480px] mx-auto px-6 lg:px-10 pt-4 pb-20 md:pt-6 md:pb-28 lg:pt-8 xl:pt-10 2xl:pb-36 relative">
        <div className="grid md:grid-cols-12 gap-12 2xl:gap-16 items-center">
          <div className="md:col-span-7">
            <div
              className="flex items-center gap-3 mb-4 lg:mb-6 2xl:mb-10 reveal-intro"
              style={introStyle(HERO_INTRO_DELAYS.badge)}
            >
              <span className="w-2 h-2 bg-stone-900 rounded-full pulse-dot" aria-hidden />
              <span className="sec-label">
                <span className="n">{t("label")}</span>
              </span>
            </div>
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
              <TypewriterText text={t("titleLine3")} />
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
                href="#pricing"
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

          <aside
            className="md:col-span-5 reveal-intro"
            style={introStyle(HERO_INTRO_DELAYS.aside)}
          >
            <div className="activity-card" aria-live="polite">
              <div className="ac-header">
                <span className="ac-dot" aria-hidden />
                <span className="ac-title">{t("activity.title")}</span>
                <span className="ac-meta">{t("activity.meta")}</span>
              </div>
              <ul className="ac-list">
                {shown.map((it, i) => (
                  <li
                    key={`${head}-${i}`}
                    className={`ac-item${acIn ? " in" : ""}`}
                    style={{ transitionDelay: `${i * 60}ms` }}
                  >
                    <span className="ac-agent">{it.agent}</span>
                    <span className="ac-text" dangerouslySetInnerHTML={{ __html: it.text }} />
                    <span className="ac-time">{timeLabels[i] ?? ""}</span>
                  </li>
                ))}
              </ul>
              <div className="ac-footer">
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}>
                  <path d="M2 8l4 4 8-8" />
                </svg>
                <span className="kr">{t("activity.footer")}</span>
              </div>
            </div>
          </aside>
        </div>

        <div
          ref={livePanelRef}
          className="mt-12 relative live-panel reveal-intro"
          style={introStyle(HERO_INTRO_DELAYS.livePanel)}
        >
          <div className="bar">
            <span className="dot r" />
            <span className="dot y" />
            <span className="dot g" />
            <span className="title">{t("livePanel.title")}</span>
            <span style={{ marginLeft: "auto", color: "#28C840" }}>{t("livePanel.compiling")}</span>
          </div>
          <div className="px-6 py-8 md:px-10 md:py-10 relative" style={{ zIndex: 2 }}>
            <svg viewBox="0 0 900 360" className="w-full h-auto" fill="none">
              <g transform="translate(20, 40)">
                <text x={0} y={0} className="font-sans" fontSize={11} fill="#525252">
                  {t("livePanel.input")}
                </text>
                {inputItems.map((label, i) => (
                  <g key={i}>
                    <rect x={0} y={20 + i * 56} width={140} height={44} rx={4} fill="white" stroke="#A3A3A3" />
                    <text x={16} y={48 + i * 56} fontSize={13} fill="#171717">
                      {label}
                    </text>
                  </g>
                ))}
              </g>
              <g stroke="#171717" strokeWidth={1.5}>
                <path className="flow-line" d="M 160 62 Q 260 62 340 100" />
                <path className="flow-line" d="M 160 118 Q 260 118 340 140" />
                <path className="flow-line" d="M 160 174 Q 260 174 340 180" />
                <path className="flow-line" d="M 160 230 Q 260 230 340 220" />
                <path className="flow-line" d="M 160 286 Q 260 286 340 260" />
              </g>
              <g transform="translate(340, 60)">
                <text x={50} y={-20} className="font-sans" fontSize={11} fill="#525252">
                  {t("livePanel.agentsHeader")}
                </text>
                <rect x={0} y={0} width={180} height={240} rx={8} fill="#2A2823" />
                <g className="font-sans" fontSize={11}>
                  {AGENT_ROWS.map((r) => {
                    const isActive = r.idx === activeAgent;
                    return (
                      <g key={r.idx}>
                        <circle
                          cx={r.x}
                          cy={r.y}
                          r={3}
                          fill={r.fill}
                          className={isActive ? "hero-agent-active" : undefined}
                        />
                        <text x={r.x + 10} y={r.text} fill={r.fill}>
                          {r.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
                <rect x={16} y={170} width={148} height={50} rx={4} fill="#262626" stroke="#525252" strokeWidth={0.5} />
                <text x={28} y={190} className="font-sans" fontSize={10} fill="#737373">
                  {t("livePanel.orchestration")}
                </text>
                <text x={28} y={208} className="font-sans" fontSize={10} fill="#FAFAFA">
                  {t("livePanel.status")}
                </text>
              </g>
              <g stroke="#171717" strokeWidth={1.5}>
                <path className="flow-line" d="M 520 100 Q 620 100 700 80" />
                <path className="flow-line" d="M 520 180 Q 620 180 700 180" />
                <path className="flow-line" d="M 520 260 Q 620 260 700 280" />
              </g>
              <g transform="translate(700, 40)">
                <text x={0} y={0} className="font-sans" fontSize={11} fill="#525252">
                  {t("livePanel.output")}
                </text>
                <rect x={0} y={20} width={180} height={72} rx={4} fill="#F5F5F5" stroke="#E5E5E5" />
                <text x={16} y={42} fontSize={12} fontWeight={600} fill="#171717">
                  {t("livePanel.outWikiTitle")}
                </text>
                <text x={16} y={60} fontSize={11} fill="#171717">
                  {t("livePanel.outWikiDesc")}
                </text>
                <text x={16} y={78} className="font-sans" fontSize={10} fill="#525252">
                  <tspan>{wikiN}</tspan> {t("livePanel.outWikiMeta")} · <tspan>{linksN}</tspan> {t("livePanel.outWikiLinksMeta")}
                </text>

                <rect x={0} y={104} width={180} height={72} rx={4} fill="#F5F5F5" stroke="#E5E5E5" />
                <text x={16} y={126} fontSize={12} fontWeight={600} fill="#171717">
                  {t("livePanel.outLearnTitle")}
                </text>
                <text x={16} y={144} fontSize={11} fill="#171717">
                  {t("livePanel.outLearnDesc")}
                </text>
                <text x={16} y={162} className="font-sans" fontSize={10} fill="#525252">
                  <tspan>{cardsN}</tspan> {t("livePanel.outLearnMeta")}
                </text>

                <rect x={0} y={188} width={180} height={72} rx={4} fill="#F5F5F5" stroke="#E5E5E5" />
                <text x={16} y={210} fontSize={12} fontWeight={600} fill="#171717">
                  {t("livePanel.outGenTitle")}
                </text>
                <text x={16} y={228} fontSize={11} fill="#171717">
                  {t("livePanel.outGenDesc")}
                </text>
                <text x={16} y={246} className="font-sans" fontSize={10} fill="#525252">
                  {t("livePanel.outGenMeta")}
                </text>
              </g>
            </svg>
          </div>
          <div className="live-status">
            <span className="beat" aria-hidden />
            <span className="msg kr" style={{ fontFamily: "var(--font-sans)" }}>
              {liveMsg}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
